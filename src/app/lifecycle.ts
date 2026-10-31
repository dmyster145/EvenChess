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
 *
 * Browser visibilitychange/pagehide/pageshow are deliberately NOT used: the SDK's sys events
 * (4/5/6/7) are the authoritative foreground/background/exit signal on G2. The browser events fire
 * at unpredictable times in iOS WKWebView, and racing them against this state machine caused the
 * exit-dialog freeze.
 */

import type { Store } from '../state/store';
import type { EvenHubBridge } from '../evenhub/bridge';
import type { FlushController } from './flush';
import type { BrandingController } from './branding';
import type { BulletTimerController } from './bullet-timer';
import type { AutosaveController } from './autosave';
import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
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
}

export interface LifecycleController {
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
  let isHidden = false;
  // Set when a FOREGROUND_ENTER arrives while we already believe we're showing — i.e. an overlay
  // (e.g. the glasses' system menu) appeared on top of the app. The
  // paired FOREGROUND_EXIT then means the overlay dismissed, NOT a genuine background. See the
  // overlay-disambiguation note in onHubEvent's normal-lifecycle branch.
  let overlayActive = false;
  // True while an overlay paused a running bullet clock — so its dismissal knows to
  // resume it, and a not-yet-started clock is never started by opening/closing the menu.
  let overlayPausedBullet = false;
  // True while a genuine background paused a running bullet clock, so the return resumes it
  // without charging the time away (same policy as the overlay path).
  let hiddenPausedBullet = false;

  // Firmware emits duplicate sys events ~50–100ms apart for one physical transition. Dedupe
  // identical consecutive sys events within 600ms before any state-changing decision.
  let lastSysType = -1;
  let lastSysAt = 0;

  /** Forget overlay/background pause bookkeeping once the app has shut down. */
  function resetPauseTracking(): void {
    overlayActive = false;
    overlayPausedBullet = false;
    hiddenPausedBullet = false;
  }

  /** Pause a running bullet clock; returns true if this call paused it. */
  function pauseRunningBullet(): boolean {
    const st = deps.store.getState();
    if (st.mode !== 'bullet' || !st.timerActive) return false;
    deps.store.dispatch({ type: 'BULLET_PAUSE' });
    return true;
  }

  // --- Genuine background / foreground (no exit dialog pending) ---

  function onHide(reason: string): void {
    if (isHidden) {
      debugLog('lifecycle hide ignored (already hidden)', { reason }, 'LCY');
      return;
    }
    isHidden = true;
    debugLog('lifecycle hide', { reason }, 'LCY');
    hiddenPausedBullet = pauseRunningBullet();
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
    if (hiddenPausedBullet) {
      hiddenPausedBullet = false;
      deps.store.dispatch({ type: 'BULLET_RESUME' });
    }
    deps.bulletTimer.resume();
    deps.flush.setForceFullRefresh();
    deps.branding.forceNextRefresh();
    void deps.flush.flushNow({ force: true });
    deps.branding.syncNow();
  }

  // --- Exit-dialog handling (inverted polarity) ---

  // The exit dialog (menu double-tap → shutDownPageContainer(1)) is ENABLED for ER submission.
  // CRITICAL: while it is on screen we must do NOTHING to the page/images — mirror the firmware
  // long-press exit, which the app doesn't touch and which leaves the board intact. The earlier
  // "rebuild the page on sys=4" step is what DECOMPOSED the board: rebuildPageContainer swaps the
  // image containers to empty placeholders, and on this exit path the refills come back
  // `sendFailed`, leaving a blank/broken board after "No". Not rebuilding keeps the firmware's
  // last-rendered frame on screen. (An earlier WebView-reload recovery was also removed: the host
  // keeps the BLE session across reload, so it didn't help and added a ~2s blank.)

  /** sys=4 while exit dialog pending: the dialog appeared. Leave the page ALONE (see note above). */
  function onExitDialogShown(): void {
    debugLog('exit-dialog shown (sys=4) — leaving page untouched (board retained by firmware)', {}, 'LCY');
  }

  /**
   * sys=5 while exit dialog pending: user tapped "No". Keep running, and do NOTHING to the page or
   * images — the firmware retains the last board frame (mirrors the working long-press exit).
   *
   * The image channel is dead here (shutDownPageContainer(1) tore it down for the native session)
   * so the board can't update until a real app restart. We deliberately DON'T try to recover it:
   *   - rebuild/reinit re-decompose the board (empty containers + failing refills),
   *   - a WebView reload does NOT get a fresh channel (the native session keeps the dead one) AND
   *     was observed to trigger a spurious sys=7 that exits the app — strictly worse.
   * So we just clear the flag and schedule a gentle, diff-gated flush (unchanged board → no image
   * sends), leaving the retained frame visible. See the exit-affordance note in app.ts for context.
   */
  function onExitDialogCancelled(): void {
    debugLog('exit-dialog cancelled (sys=5) — app stays alive, page left intact (board frozen, channel dead)', {}, 'LCY');
    deps.bridge.clearExitDialog();
    deps.flush.schedule();
    deps.branding.schedule();
  }

  function doSystemExitCleanup(reason: string): void {
    debugLog('lifecycle system-exit cleanup', { reason }, 'LCY');
    deps.bridge.clearExitDialog();
    deps.flush.cancel();
    deps.branding.cancel();
    deps.bulletTimer.suspend();
    deps.autosave.flushNow();
    void (async () => {
      try {
        await deps.bridge.shutdown();
      } catch (err) {
        console.error('[lifecycle] bridge.shutdown error', err);
      }
      resetPauseTracking();
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
    // Overlay disambiguation: a system overlay (e.g. the glasses' system menu) — like the exit
    // dialog — surfaces as FOREGROUND_ENTER (appeared) then FOREGROUND_EXIT (dismissed), the
    // INVERSE order of a genuine background (FOREGROUND_EXIT to leave, FOREGROUND_ENTER to return).
    // We tell them apart by isHidden at ENTER time: a FOREGROUND_ENTER received while we already
    // believe we're showing means an overlay appeared, so the paired FOREGROUND_EXIT is that overlay
    // dismissing — NOT a real background. Treating that EXIT as a background is what would suspend
    // the bullet timer and latch the app "hidden" every time the user closed the system menu.
    if (eventType === FOREGROUND_ENTER) {
      if (!isHidden) {
        overlayActive = true;
        // Pause the bullet clock while the overlay is up — matching the hand-rolled
        // menu, which pauses via handleOpenMenu. Only when it's actually running, so we can decide
        // on dismiss whether to resume (and never start a not-yet-started clock).
        overlayPausedBullet = pauseRunningBullet();
        debugLog('overlay appeared (foreground-enter while showing) — pausing bullet clock if running', { paused: overlayPausedBullet }, 'LCY');
        return;
      }
      overlayActive = false;
      onShow('foreground-enter');
      return;
    }
    if (eventType === FOREGROUND_EXIT) {
      if (overlayActive) {
        overlayActive = false;
        // Resume the bullet clock the overlay paused. The reducer no-ops unless we're back in a game
        // phase.
        if (overlayPausedBullet) {
          deps.store.dispatch({ type: 'BULLET_RESUME' });
          overlayPausedBullet = false;
        }
        debugLog('overlay dismissed (foreground-exit) — not a background', {}, 'LCY');
        return;
      }
      onHide('foreground-exit');
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

    // The SDK pushes one default/uninitialized DeviceStatus at startup with everything zeroed
    // (connectType none/disconnected, batteryLevel 0) even though the device is connected —
    // getDeviceInfo() returns a real battery moments earlier. Writing the flags from that
    // spurious event latches the flush wearing/connected gate closed for the entire session
    // (no further status event arrives), freezing all rendering while input still flows. A
    // genuinely connected device always reports a nonzero battery; treat disconnected + no
    // battery as "no information" and ignore it. A real disconnect that also reports zero
    // battery is harmless to ignore here — failed sends are handled by the bridge's timeout
    // and persistent-failure path, never a hard freeze.
    const battery = status.batteryLevel ?? 0;
    if (!connected && battery <= 0) {
      debugLog('device-status ignored (spurious default: disconnected + no battery)', {
        isWearing: status.isWearing ?? null,
        connectType: status.connectType ?? null,
      }, 'DEV');
      return;
    }

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

  return { onHubEvent, onDeviceStatusChanged };
}
