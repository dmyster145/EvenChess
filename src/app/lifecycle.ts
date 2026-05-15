/**
 * lifecycle.ts — owns visibility, foreground/background, wearing, and exit signals.
 *
 * Replaces the v1 sprawl: `setupVisibilityListener`, `triggerForegroundEnterRecoveryRefresh`,
 * `handleSystemLifecycleSysEvent`, `resetDeviceStatusOnResume`, `handleDeviceStatus`,
 * `startHeartbeat`/`stopHeartbeat`, `suspendBulletTimerForBackground`/`resumeBulletTimerFromBackground`,
 * `armTransportOnlyHangProbe`/`armLightweightHangProbe`, `fireEarlyShutdown`/`attemptBridgeReinit`,
 * `teardownAppLevelResources`, `pageReloadCount` machinery.
 *
 * The v2 model trusts iOS WKWebView's natural visibility events. On hide we drop pending bridge
 * payloads (so they don't try to deliver on a paused WebView) and pause the bullet timer; on show
 * we resume the timer and force one full-refresh flush. There is no heartbeat watchdog, no
 * hang-probe stack, no auto-reinit. Manual reinit is exposed by `bridge-reinit.ts`.
 */

import type { Store } from '../state/store';
import type { EvenHubBridge } from '../evenhub/bridge';
import type { FlushController } from './flush';
import type { BrandingController } from './branding';
import type { BulletTimerController } from './bullet-timer';
import type { AutosaveController } from './autosave';
import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { debugLog } from '../debug/logger';

export interface DeviceStatusFlags {
  isWearingGlasses: boolean;
  isDeviceConnected: boolean;
}

export interface LifecycleDeps {
  bridge: EvenHubBridge;
  store: Store;
  flush: FlushController;
  branding: BrandingController;
  bulletTimer: BulletTimerController;
  autosave: AutosaveController;
  /** Mutable read-write reference to the wearing/connected flags consumed by flush.ts. */
  deviceFlags: DeviceStatusFlags;
  /** True once the page has been upgraded from text-only startup to the full layout. Lifecycle
   *  uses this on resume to decide whether to rebuild the page (resetting SDK image-container
   *  state after a `shutDownPageContainer(1)` exit-dialog cancellation). */
  imageContainersActive: () => boolean;
}

export interface LifecycleController {
  attach(): void;
  detach(): void;
  /** Forwarded from the SDK's `onEvenHubEvent`; lifecycle handles only the sysEvent lifecycle types. */
  onHubEvent(event: EvenHubEvent): void;
  /** Forwarded from the SDK's `onDeviceStatusChanged`. */
  onDeviceStatusChanged(status: DeviceStatusUpdate): void;
  /**
   * Called by the input dispatcher whenever a real user-input action arrives. If we believe the
   * app is currently "hidden" (because FG_EXIT fired but no FG_ENTER followed — observed on iOS
   * after a `shutDownPageContainer(1)` exit-dialog cancellation), treat the input as an implicit
   * foreground-enter and run the recovery path. Without this, onShow's force-reset + page rebuild
   * is never triggered for the dialog-cancel case and the board stays frozen.
   */
  notifyInputReceived(): void;
}

export interface DeviceStatusUpdate {
  isWearing?: boolean;
  isInCase?: boolean;
  connectType?: string;
  isCharging?: boolean;
  batteryLevel?: number;
}

export function createLifecycle(deps: LifecycleDeps): LifecycleController {
  const subscriptions = new Set<() => void>();
  let attached = false;
  // Tracks whether the app is currently considered "hidden" (backgrounded). The SDK has been
  // observed to fire FOREGROUND_EXIT_EVENT and FOREGROUND_ENTER_EVENT *twice* per real transition
  // (likely once per glasses ear, since each maintains its own BLE link). v1 absorbed the
  // duplicate via its `pendingRecoveryRefreshTimeout` debounce; v2 dedupes by ignoring repeat
  // hide-while-hidden and show-while-showing calls.
  let isHidden = false;

  function attach(): void {
    if (attached) return;
    attached = true;

    if (typeof document !== 'undefined') {
      const onVisibility = (): void => {
        if (document.visibilityState === 'hidden') onHide('visibilitychange');
        else if (document.visibilityState === 'visible') onShow('visibilitychange');
      };
      document.addEventListener('visibilitychange', onVisibility);
      subscriptions.add(() => document.removeEventListener('visibilitychange', onVisibility));
    }

    if (typeof window !== 'undefined') {
      // pagehide/pageshow fire on iOS BFCache pause/resume even when visibilitychange does not.
      // Calling onHide/onShow twice is harmless (idempotent) — better double-coverage than a miss.
      const onPagehide = (): void => onHide('pagehide');
      const onPageshow = (): void => onShow('pageshow');
      window.addEventListener('pagehide', onPagehide);
      window.addEventListener('pageshow', onPageshow);
      subscriptions.add(() => window.removeEventListener('pagehide', onPagehide));
      subscriptions.add(() => window.removeEventListener('pageshow', onPageshow));
    }
  }

  function detach(): void {
    for (const unsubscribe of subscriptions) {
      try {
        unsubscribe();
      } catch (err) {
        console.error('[lifecycle] unsubscribe error', err);
      }
    }
    subscriptions.clear();
    attached = false;
  }

  function onHide(reason: string): void {
    if (isHidden) {
      debugLog('lifecycle hide ignored (already hidden)', { reason }, 'LCY');
      return;
    }
    isHidden = true;
    debugLog('lifecycle hide', { reason }, 'LCY');
    // Per the weather-even-g2 reference and v1's notes: do MINIMAL work on FG_EXIT. We previously
    // called bridge.clearPending() here to drop pending payloads, but that interacted badly with
    // shutDownPageContainer(1)'s exit-dialog flow: the in-flight image send sometimes never
    // resolved on iOS WKWebView, and clearing pending + setting the `cleared` flag added extra
    // sender state churn that delayed recovery. The latest-wins map handles staleness on resume
    // — onShow's force-flush overwrites any stale pending entries with fresh state. The
    // The bridge's per-send timeout is what unsticks an actually-hung send.
    deps.bulletTimer.suspend();
    // Force-flush deferred autosave so a backgrounded app doesn't lose the latest move.
    deps.autosave.flushNow();
  }

  function onShow(reason: string): void {
    if (!isHidden) {
      debugLog('lifecycle show ignored (already showing)', { reason }, 'LCY');
      return;
    }
    isHidden = false;
    debugLog('lifecycle show', { reason }, 'LCY');
    // Optimistic device-status reset on resume (mirrors v1's resetDeviceStatusOnResume): WKWebView
    // observably fires a final `connectType=disconnected` right as it pauses, which closes the
    // wearing/connected gate; if the reconnect event after resume is delayed, the user comes back
    // to a frozen display. Trust the next genuine device-status event to correct this.
    const wasWearing = deps.deviceFlags.isWearingGlasses;
    const wasConnected = deps.deviceFlags.isDeviceConnected;
    deps.deviceFlags.isWearingGlasses = true;
    deps.deviceFlags.isDeviceConnected = true;
    if (!wasWearing || !wasConnected) {
      debugLog('lifecycle device-status reset', { reason, wasWearing, wasConnected }, 'LCY');
    }

    deps.bulletTimer.resume();
    // Reset the bridge's image transport. After a `shutDownPageContainer(1)` exit-dialog
    // cancellation, the SDK's image transport ends up in a wedged state — invalidate any stuck
    // sender so a fresh runner can pick up the latest pending payload.
    deps.bridge.forceResetImageTransport(`onShow:${reason}`);
    deps.flush.setForceFullRefresh();
    deps.branding.forceNextRefresh();

    // Note: we deliberately do NOT call bridge.updatePage(rebuildPageContainer) here. A page
    // rebuild on its own succeeds, but it replaces the live image containers with empty
    // placeholders. The followup updateImageRawData fills come via a SEPARATE BLE call — and on
    // iOS post-dialog those calls return `sendFailed`. Net result: rebuild + failed fill = blank
    // board (worse than the pre-rebuild "frozen on last frame" state). The snake reference avoids
    // this trap by baking text content into its rebuild config, but our image data must travel
    // separately so we don't have that option. Best effort: keep the previously-displayed image
    // content on screen and let the bridge retry sends; if the SDK transport recovers, the
    // force-flush below repaints; if it doesn't, the user keeps seeing the last good frame.
    void deps.flush.flushNow({ force: true });
    deps.branding.syncNow();
  }

  function onHubEvent(event: EvenHubEvent): void {
    const sysEvent = event.sysEvent;
    if (!sysEvent) return;
    const eventType = sysEvent.eventType;
    if (eventType === undefined || eventType === null) return;

    if (eventType === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
      onHide('foreground-exit');
      return;
    }
    if (eventType === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
      onShow('foreground-enter');
      return;
    }

    const abnormalExitType = (OsEventTypeList as unknown as { ABNORMAL_EXIT_EVENT?: number }).ABNORMAL_EXIT_EVENT;
    if (typeof abnormalExitType === 'number' && eventType === abnormalExitType) {
      debugLog('lifecycle abnormal-exit', {}, 'LCY');
      // WebView is going away. Flush autosave and drop pending sends; do NOT await shutdown
      // because the host has already torn down BLE.
      deps.bridge.clearPending();
      deps.bulletTimer.suspend();
      deps.autosave.flushNow();
      return;
    }

    const systemExitType = (OsEventTypeList as unknown as { SYSTEM_EXIT_EVENT?: number }).SYSTEM_EXIT_EVENT;
    if (typeof systemExitType === 'number' && eventType === systemExitType) {
      debugLog('lifecycle system-exit', {}, 'LCY');
      // User confirmed exit from the system "End this feature?" dialog. Properly await
      // bridge.shutdown() — race #7 fix vs the v1 fire-and-forget `fireEarlyShutdown` path.
      deps.flush.cancel();
      deps.branding.cancel();
      deps.autosave.flushNow();
      void (async () => {
        try {
          await deps.bridge.shutdown();
        } catch (err) {
          console.error('[lifecycle] bridge.shutdown error', err);
        }
        detach();
      })();
      return;
    }
  }

  function onDeviceStatusChanged(status: DeviceStatusUpdate): void {
    const wearing = status.isWearing !== false && status.isInCase !== true;
    const connected =
      status.connectType !== 'disconnected' &&
      status.connectType !== 'connectionFailed' &&
      status.connectType !== 'none';

    debugLog('device-status', {
      wearing,
      connected,
      battery: status.batteryLevel ?? null,
      isCharging: status.isCharging ?? null,
      isInCase: status.isInCase ?? null,
    }, 'DEV');

    const wearingChanged = wearing !== deps.deviceFlags.isWearingGlasses;
    const connectedChanged = connected !== deps.deviceFlags.isDeviceConnected;
    deps.deviceFlags.isWearingGlasses = wearing;
    deps.deviceFlags.isDeviceConnected = connected;

    if ((wearingChanged && wearing) || (connectedChanged && connected)) {
      // Resume / reconnect: force a refresh so the display catches up with whatever happened
      // while flushes were skipped. Branding gets the same treatment so it doesn't show stale
      // state when the user puts the glasses back on after a checkmate happened in the interim.
      deps.flush.setForceFullRefresh();
      deps.branding.forceNextRefresh();
      deps.flush.schedule();
      deps.branding.schedule();
    }
  }

  function notifyInputReceived(): void {
    // If we're "hidden" but a user input just arrived, the app is clearly back in the foreground —
    // the SDK's FG_ENTER event didn't fire (a known iOS quirk after the exit-dialog dismiss).
    // Treat this as an implicit foreground-enter and run the full recovery path.
    if (isHidden) {
      debugLog('lifecycle implicit foreground-enter from input', {}, 'LCY');
      onShow('input-after-hidden');
    }
  }

  return { attach, detach, onHubEvent, onDeviceStatusChanged, notifyInputReceived };
}
