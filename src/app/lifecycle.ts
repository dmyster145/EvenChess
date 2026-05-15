/**
 * lifecycle.ts — owns foreground/background, exit-dialog, wearing, and visibility signals.
 *
 * CRITICAL: shutDownPageContainer(1)'s SDK event polarity is INVERTED vs a real background.
 * After an exit request the SDK fires:
 *   - FOREGROUND_ENTER (sys=4) when the dialog APPEARS (~100ms later). The page container is
 *     cleared host-side at this point — this is the cue to rebuildPageContainer.
 *   - FOREGROUND_EXIT  (sys=5) when the user taps "No" (dialog cancelled — KEEP RUNNING).
 *   - SYSTEM_EXIT      (sys=7) when the user taps "Yes" (confirmed exit — clean up).
 * So a FOREGROUND_EXIT right after an exit request means "cancelled, keep running" — NOT
 * "backgrounded". Treating it as a background (suspend timers, recovery churn) is what froze the
 * board after "No". The bridge arms `exitDialogPending` synchronously in requestSystemExit(); we
 * branch on it here.
 *
 * Outside the exit-dialog window the events have normal meaning (sys=4 resume, sys=5 background).
 *
 * The firmware also emits DUPLICATE events for one physical transition (~50–100ms apart), so all
 * sys events are deduped by (type, time) before any state-changing decision.
 */

import type { Store } from '../state/store';
import type { EvenHubBridge } from '../evenhub/bridge';
import type { FlushController } from './flush';
import type { BrandingController } from './branding';
import type { BulletTimerController } from './bullet-timer';
import type { AutosaveController } from './autosave';
import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { composePageForState } from '../render/composer';
import { debugLog } from '../debug/logger';

const SYS_EVENT_DEDUP_MS = 600;

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
  /** True once the text-only startup page has been upgraded to the full layout. */
  imageContainersActive: () => boolean;
}

export interface LifecycleController {
  attach(): void;
  detach(): void;
  /** Forwarded from the SDK's `onEvenHubEvent`; handles only the sysEvent lifecycle types. */
  onHubEvent(event: EvenHubEvent): void;
  /** Forwarded from the SDK's `onDeviceStatusChanged`. */
  onDeviceStatusChanged(status: DeviceStatusUpdate): void;
}

export interface DeviceStatusUpdate {
  isWearing?: boolean;
  isInCase?: boolean;
  connectType?: string;
  isCharging?: boolean;
  batteryLevel?: number;
}

const FOREGROUND_ENTER = OsEventTypeList.FOREGROUND_ENTER_EVENT;
const FOREGROUND_EXIT = OsEventTypeList.FOREGROUND_EXIT_EVENT;
const ABNORMAL_EXIT = (OsEventTypeList as unknown as { ABNORMAL_EXIT_EVENT?: number }).ABNORMAL_EXIT_EVENT ?? 6;
const SYSTEM_EXIT = (OsEventTypeList as unknown as { SYSTEM_EXIT_EVENT?: number }).SYSTEM_EXIT_EVENT ?? 7;

export function createLifecycle(deps: LifecycleDeps): LifecycleController {
  const subscriptions = new Set<() => void>();
  let attached = false;
  let isHidden = false;

  // Firmware emits duplicate sys events ~50–100ms apart for one physical transition. Dedupe
  // identical consecutive sys events within 600ms before any state-changing decision.
  let lastSysType = -1;
  let lastSysAt = 0;

  function attach(): void {
    if (attached) return;
    attached = true;
    // NOTE: we intentionally do NOT wire browser visibilitychange/pagehide/pageshow listeners.
    // The SDK's sys events (4/5/6/7) are the authoritative foreground/background/exit signal on
    // G2; the browser events fire at unpredictable times in iOS WKWebView and racing them
    // against the sys-event state machine was a source of the exit-dialog freeze. The reference
    // weather/snake apps rely solely on sys events too.
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

  // --- Genuine background / foreground (no exit dialog pending) ---

  function onHide(reason: string): void {
    if (isHidden) {
      debugLog('lifecycle hide ignored (already hidden)', { reason }, 'LCY');
      return;
    }
    isHidden = true;
    debugLog('lifecycle hide', { reason }, 'LCY');
    deps.bulletTimer.suspend();
    deps.autosave.flushNow();
  }

  function onShow(reason: string): void {
    if (!isHidden) {
      debugLog('lifecycle show ignored (already showing)', { reason }, 'LCY');
      return;
    }
    isHidden = false;
    debugLog('lifecycle show', { reason }, 'LCY');
    const wasWearing = deps.deviceFlags.isWearingGlasses;
    const wasConnected = deps.deviceFlags.isDeviceConnected;
    deps.deviceFlags.isWearingGlasses = true;
    deps.deviceFlags.isDeviceConnected = true;
    if (!wasWearing || !wasConnected) {
      debugLog('lifecycle device-status reset', { reason, wasWearing, wasConnected }, 'LCY');
    }
    deps.bulletTimer.resume();
    deps.flush.setForceFullRefresh();
    deps.branding.forceNextRefresh();
    void deps.flush.flushNow({ force: true });
    deps.branding.syncNow();
  }

  // --- Exit-dialog handling (inverted polarity) ---

  // NOTE: The exit-dialog handlers below are RUNTIME-DEAD while the dialog is suppressed in
  // app.ts (isExitDialogEnabled() default off — ER SDK image-channel defect). They are kept,
  // and written as the correct EvenRoads-style handling, so behavior is right the instant the
  // dialog is re-enabled after ER ships an SDK fix. The earlier WebView-reload recovery was
  // removed: on-device logs proved the host keeps the BLE session across location.reload(), so
  // the image channel stayed dead AND the reload added a jarring ~2s blank — strictly worse.

  /** sys=4 while exit dialog pending: dialog appeared, host cleared the page. Rebuild it. */
  function onExitDialogShown(): void {
    debugLog('exit-dialog shown (sys=4) — rebuilding page', {}, 'LCY');
    if (!deps.imageContainersActive()) return;
    void deps.bridge.updatePage(composePageForState(deps.store.getState()));
  }

  /** sys=5 while exit dialog pending: user tapped "No". Keep running; re-render. Do NOT pause. */
  function onExitDialogCancelled(): void {
    debugLog('exit-dialog cancelled (sys=5) — re-rendering, app stays alive', {}, 'LCY');
    deps.bridge.clearExitDialog();
    deps.flush.setForceFullRefresh();
    deps.branding.forceNextRefresh();
    void deps.flush.flushNow({ force: true });
    deps.branding.syncNow();
  }

  function doSystemExitCleanup(reason: string): void {
    debugLog('lifecycle system-exit cleanup', { reason }, 'LCY');
    deps.bridge.clearExitDialog();
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
  }

  function doAbnormalExitCleanup(): void {
    debugLog('lifecycle abnormal-exit cleanup', {}, 'LCY');
    deps.bridge.clearExitDialog();
    deps.bridge.clearPending();
    deps.bulletTimer.suspend();
    deps.autosave.flushNow();
  }

  function onHubEvent(event: EvenHubEvent): void {
    const sysEvent = event.sysEvent;
    if (!sysEvent) return;
    // Protobuf strips zero values: CLICK_EVENT (0) arrives as undefined. We only care about
    // lifecycle types (4/5/6/7), all non-zero, so `?? 0` then a membership check is safe.
    const eventType = sysEvent.eventType ?? 0;
    if (
      eventType !== FOREGROUND_ENTER &&
      eventType !== FOREGROUND_EXIT &&
      eventType !== ABNORMAL_EXIT &&
      eventType !== SYSTEM_EXIT
    ) {
      return;
    }

    // Dedupe duplicate firmware echoes (one physical transition → 2 events ~50–100ms apart).
    const now = Date.now();
    if (eventType === lastSysType && now - lastSysAt < SYS_EVENT_DEDUP_MS) {
      debugLog('lifecycle dup sys event ignored', { eventType }, 'LCY');
      return;
    }
    lastSysType = eventType;
    lastSysAt = now;

    // --- Exit-dialog path: inverted polarity ---
    if (deps.bridge.isExitDialogPending()) {
      if (eventType === FOREGROUND_ENTER) {
        onExitDialogShown();
        return;
      }
      if (eventType === FOREGROUND_EXIT) {
        onExitDialogCancelled();
        return;
      }
      if (eventType === SYSTEM_EXIT) {
        doSystemExitCleanup('exit-dialog-confirmed');
        return;
      }
      if (eventType === ABNORMAL_EXIT) {
        doAbnormalExitCleanup();
        return;
      }
      return;
    }

    // --- Normal lifecycle ---
    if (eventType === FOREGROUND_EXIT) {
      onHide('foreground-exit');
      return;
    }
    if (eventType === FOREGROUND_ENTER) {
      onShow('foreground-enter');
      return;
    }
    if (eventType === ABNORMAL_EXIT) {
      doAbnormalExitCleanup();
      return;
    }
    if (eventType === SYSTEM_EXIT) {
      doSystemExitCleanup('system-exit');
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
      deps.flush.setForceFullRefresh();
      deps.branding.forceNextRefresh();
      deps.flush.schedule();
      deps.branding.schedule();
    }
  }

  return { attach, detach, onHubEvent, onDeviceStatusChanged };
}
