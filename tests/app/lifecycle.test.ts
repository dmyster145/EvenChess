import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from '../../src/state/store';
import { buildInitialState } from '../../src/state/contracts';
import { ChessService } from '../../src/chess/chessservice';
import { createLifecycle, type DeviceStatusFlags } from '../../src/app/lifecycle';
import type { FlushController } from '../../src/app/flush';
import type { BrandingController } from '../../src/app/branding';
import type { BulletTimerController } from '../../src/app/bullet-timer';
import type { AutosaveController } from '../../src/app/autosave';
import type { EvenHubBridge } from '../../src/evenhub/bridge';
import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk';

const SYSTEM_EXIT = (OsEventTypeList as unknown as { SYSTEM_EXIT_EVENT?: number }).SYSTEM_EXIT_EVENT ?? 7;

/** A host sys event as the SDK delivers it (the SDK's own class adds a toJson we never call). */
function sys(eventType: number): EvenHubEvent {
  return { sysEvent: { eventType } } as unknown as EvenHubEvent;
}

interface BridgeRecorder {
  clearPendingCalls: number;
  shutdownCalls: number;
  forceResets: number;
  updatePages: number;
  clearExitDialogCalls: number;
  dialogPending: boolean;
  resolveShutdown: () => void;
}

function makeBridge(): EvenHubBridge & BridgeRecorder {
  let resolveShutdown = (): void => {};
  const recorder: Partial<EvenHubBridge> & BridgeRecorder = {
    clearPendingCalls: 0,
    shutdownCalls: 0,
    forceResets: 0,
    updatePages: 0,
    clearExitDialogCalls: 0,
    dialogPending: false,
    resolveShutdown: () => resolveShutdown(),
    clearPending() {
      this.clearPendingCalls += 1;
    },
    forceResetImageTransport() {
      this.forceResets += 1;
    },
    isExitDialogPending() {
      return this.dialogPending;
    },
    clearExitDialog() {
      this.clearExitDialogCalls += 1;
      this.dialogPending = false;
    },
    async updatePage() {
      this.updatePages += 1;
      return true;
    },
    async shutdown() {
      this.shutdownCalls += 1;
      await new Promise<void>((resolve) => {
        resolveShutdown = resolve;
      });
    },
  };
  return recorder as unknown as EvenHubBridge & BridgeRecorder;
}

function makeFlush(): FlushController & { schedules: number; flushNows: number; cancels: number; forces: number } {
  const obj = {
    schedules: 0,
    flushNows: 0,
    cancels: 0,
    forces: 0,
    schedule() { obj.schedules += 1; },
    async flushNow(_opts?: { force?: boolean }) { obj.flushNows += 1; },
    cancel() { obj.cancels += 1; },
    setForceFullRefresh() { obj.forces += 1; },
  };
  return obj;
}

function makeBranding(): BrandingController & { schedules: number; cancels: number; syncs: number; forces: number } {
  const obj = {
    schedules: 0,
    cancels: 0,
    syncs: 0,
    forces: 0,
    schedule() { obj.schedules += 1; },
    syncNow() { obj.syncs += 1; },
    forceNextRefresh() { obj.forces += 1; },
    cancel() { obj.cancels += 1; },
  };
  return obj;
}

function makeBulletTimer(): BulletTimerController & { suspended: number; resumed: number; running: boolean } {
  const obj = {
    suspended: 0,
    resumed: 0,
    running: false,
    start() { obj.running = true; },
    stop() { obj.running = false; },
    suspend() { obj.suspended += 1; obj.running = false; },
    resume() { obj.resumed += 1; },
    isRunning() { return obj.running; },
    onStateChange() { /* noop */ },
  };
  return obj;
}

function makeAutosave(): AutosaveController & { flushes: number; clears: number } {
  const obj = {
    flushes: 0,
    clears: 0,
    queue() {},
    clear() { obj.clears += 1; },
    flushNow() { obj.flushes += 1; },
  };
  return obj;
}

describe('createLifecycle', () => {
  let chess: ChessService;
  let store: ReturnType<typeof createStore>;
  let bridge: EvenHubBridge & BridgeRecorder;
  let flush: ReturnType<typeof makeFlush>;
  let branding: ReturnType<typeof makeBranding>;
  let bulletTimer: ReturnType<typeof makeBulletTimer>;
  let autosave: ReturnType<typeof makeAutosave>;
  let deviceFlags: DeviceStatusFlags;

  beforeEach(() => {
    vi.useFakeTimers();
    chess = new ChessService();
    store = createStore(buildInitialState(chess));
    bridge = makeBridge();
    flush = makeFlush();
    branding = makeBranding();
    bulletTimer = makeBulletTimer();
    autosave = makeAutosave();
    deviceFlags = { isWearingGlasses: true, isDeviceConnected: true };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeLifecycle(): ReturnType<typeof createLifecycle> {
    return createLifecycle({
      bridge,
      store,
      flush,
      branding,
      bulletTimer,
      autosave,
      deviceFlags,
    });
  }

  // --- Normal lifecycle (no exit dialog pending) ---

  it('FOREGROUND_EXIT (no exit dialog) suspends timer + flushes autosave', () => {
    const lifecycle = makeLifecycle();
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_EXIT_EVENT));
    expect(bulletTimer.suspended).toBe(1);
    expect(autosave.flushes).toBe(1);
    expect(bridge.clearPendingCalls).toBe(0);
  });

  it('FOREGROUND_ENTER (no exit dialog) resumes timer + force-refreshes, after a FG_EXIT', async () => {
    const lifecycle = makeLifecycle();
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_EXIT_EVENT));
    // Advance past the sys-event dedup window so the ENTER isn't swallowed.
    await vi.advanceTimersByTimeAsync(700);
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_ENTER_EVENT));
    expect(bulletTimer.resumed).toBe(1);
    expect(flush.forces).toBeGreaterThanOrEqual(1);
    expect(flush.flushNows).toBe(1);
  });

  it('duplicate sys events within 600ms are deduped', () => {
    const lifecycle = makeLifecycle();
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_EXIT_EVENT));
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_EXIT_EVENT));
    expect(bulletTimer.suspended).toBe(1);
    expect(autosave.flushes).toBe(1);
  });

  // --- Overlay disambiguation (SDK 0.0.14 native OS context menu) ---
  // The OS menu surfaces as FOREGROUND_ENTER (appeared) then FOREGROUND_EXIT (dismissed) — the
  // inverse order of a genuine background. Closing it must NOT be treated as a background (which
  // would suspend the bullet timer and latch the app "hidden").

  it('native menu open (ENTER while showing) then close (EXIT) does NOT suspend the timer or hide', async () => {
    const lifecycle = makeLifecycle();
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_ENTER_EVENT)); // menu appeared
    await vi.advanceTimersByTimeAsync(700);
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_EXIT_EVENT));  // menu dismissed
    expect(bulletTimer.suspended).toBe(0);
    expect(autosave.flushes).toBe(0);
    expect(bulletTimer.resumed).toBe(0);
  });

  it('a genuine background AFTER an overlay cycle still suspends the timer', async () => {
    const lifecycle = makeLifecycle();
    // Overlay cycle.
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_ENTER_EVENT));
    await vi.advanceTimersByTimeAsync(700);
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_EXIT_EVENT));
    expect(bulletTimer.suspended).toBe(0);
    // Real background later (past the dedup window): EXIT with no overlay pending → onHide.
    await vi.advanceTimersByTimeAsync(700);
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_EXIT_EVENT));
    expect(bulletTimer.suspended).toBe(1);
    expect(autosave.flushes).toBe(1);
  });

  it('a genuine background pauses a running bullet clock; the return resumes it without charging the time away', async () => {
    const start = Date.now();
    store = createStore({
      ...buildInitialState(chess),
      mode: 'bullet', phase: 'idle',
      timers: { whiteMs: 60000, blackMs: 60000, incrementMs: 0 },
      timerActive: true, lastTickTime: start,
    });
    const lifecycle = makeLifecycle();
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_EXIT_EVENT)); // backgrounded
    expect(store.getState().timerActive).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);                         // 30s away
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_ENTER_EVENT)); // back
    expect(store.getState().timerActive).toBe(true);
    expect(store.getState().lastTickTime).toBeGreaterThanOrEqual(start + 30_000);
    store.dispatch({ type: 'TIMER_TICK' });
    expect(store.getState().timers?.whiteMs).toBe(60000);              // the 30s was not charged
  });

  it('a background does not start a clock that was not running', async () => {
    store = createStore({
      ...buildInitialState(chess),
      mode: 'bullet', phase: 'idle',
      timers: { whiteMs: 60000, blackMs: 60000, incrementMs: 0 },
      timerActive: false, lastTickTime: null,
    });
    const lifecycle = makeLifecycle();
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_EXIT_EVENT));
    await vi.advanceTimersByTimeAsync(700);
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_ENTER_EVENT));
    expect(store.getState().timerActive).toBe(false);
  });

  it('pauses a running bullet clock when the overlay opens and resumes it on close', async () => {
    store = createStore({
      ...buildInitialState(chess),
      mode: 'bullet', phase: 'idle',
      timers: { whiteMs: 60000, blackMs: 60000, incrementMs: 0 },
      timerActive: true, lastTickTime: Date.now(),
    });
    const lifecycle = makeLifecycle();
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_ENTER_EVENT)); // menu opens
    expect(store.getState().timerActive).toBe(false); // paused
    await vi.advanceTimersByTimeAsync(700);
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_EXIT_EVENT)); // menu closes
    expect(store.getState().timerActive).toBe(true); // resumed
  });

  it('does not start a not-yet-running bullet clock by opening/closing the overlay', async () => {
    store = createStore({
      ...buildInitialState(chess),
      mode: 'bullet', phase: 'idle',
      timers: { whiteMs: 60000, blackMs: 60000, incrementMs: 0 },
      timerActive: false,
    });
    const lifecycle = makeLifecycle();
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_ENTER_EVENT));
    expect(store.getState().timerActive).toBe(false);
    await vi.advanceTimersByTimeAsync(700);
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_EXIT_EVENT));
    expect(store.getState().timerActive).toBe(false); // still not started
  });

  // --- Exit-dialog path (inverted polarity) ---

  // The exit dialog (menu double-tap → shutDownPageContainer(1)) is ENABLED for ER submission.
  // While it is on screen the app must do NOTHING to the page/images — a rebuild or force-repaint
  // during this window decomposes the board (image containers become empty placeholders whose
  // refills come back sendFailed). Mirror the firmware long-press exit, which leaves the board
  // intact by not touching it.

  it('exit dialog: FOREGROUND_ENTER (sys=4) leaves the page untouched, does NOT resume as a foreground', () => {
    bridge.dialogPending = true;
    const lifecycle = makeLifecycle();
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_ENTER_EVENT));
    // No rebuild while the dialog is up — the firmware retains the last board frame.
    expect(bridge.updatePages).toBe(0);
    expect(flush.schedules).toBe(0);
    // Must NOT run the normal foreground-resume path.
    expect(bulletTimer.resumed).toBe(0);
    expect(flush.flushNows).toBe(0);
  });

  it('exit dialog: FOREGROUND_EXIT (sys=5) = "No" — clears flag, gentle resync, board left intact (no rebuild, no reload)', () => {
    bridge.dialogPending = true;
    const lifecycle = makeLifecycle();
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_EXIT_EVENT));
    expect(bridge.clearExitDialogCalls).toBe(1);
    // Must NOT treat as background.
    expect(bulletTimer.suspended).toBe(0);
    // No page rebuild, no forced repaint, and no WebView reload (a reload doesn't recover the dead
    // image channel and triggers a spurious sys=7 that exits the app). Only a gentle, diff-gated
    // flush is scheduled — an unchanged board produces no image sends, leaving the retained frame.
    expect(bridge.updatePages).toBe(0);
    expect(flush.flushNows).toBe(0);
    expect(flush.schedules).toBe(1);
    expect(branding.schedules).toBeGreaterThanOrEqual(1);
  });

  it('exit dialog: SYSTEM_EXIT (sys=7) = "Yes" — cleans up and shuts down', async () => {
    bridge.dialogPending = true;
    const lifecycle = makeLifecycle();
    lifecycle.onHubEvent(sys(SYSTEM_EXIT));
    expect(bridge.clearExitDialogCalls).toBe(1);
    expect(flush.cancels).toBe(1);
    expect(branding.cancels).toBe(1);
    expect(autosave.flushes).toBe(1);
    expect(bulletTimer.suspended).toBe(1); // no TIMER_TICKs (and their flushes) after shutdown
    expect(bridge.shutdownCalls).toBe(1);
    bridge.resolveShutdown();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('exit dialog cancel then a genuine later background works normally', async () => {
    bridge.dialogPending = true;
    const lifecycle = makeLifecycle();
    // "No" tapped — flag cleared.
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_EXIT_EVENT));
    expect(bridge.dialogPending).toBe(false);
    expect(bulletTimer.suspended).toBe(0);
    await vi.advanceTimersByTimeAsync(700);
    // A genuine background later (no exit dialog pending) now suspends normally.
    lifecycle.onHubEvent(sys(OsEventTypeList.FOREGROUND_EXIT_EVENT));
    expect(bulletTimer.suspended).toBe(1);
  });

  // --- Device status ---

  it('onDeviceStatusChanged: wearing-resume forces a refresh', () => {
    const lifecycle = makeLifecycle();
    deviceFlags.isWearingGlasses = false;
    lifecycle.onDeviceStatusChanged({ isWearing: true });
    expect(deviceFlags.isWearingGlasses).toBe(true);
    expect(flush.forces).toBeGreaterThanOrEqual(1);
    expect(flush.schedules).toBeGreaterThanOrEqual(1);
  });

  it('onDeviceStatusChanged: in-case treated as not-wearing', () => {
    const lifecycle = makeLifecycle();
    lifecycle.onDeviceStatusChanged({ isInCase: true });
    expect(deviceFlags.isWearingGlasses).toBe(false);
  });

  it('onDeviceStatusChanged: spurious default (disconnected + battery 0) is ignored — gate stays open', () => {
    // The SDK pushes one uninitialized DeviceStatus at startup (connectType none, battery 0)
    // even though the device is connected. Trusting it latched both flags false for the whole
    // session and froze all rendering. deviceFlags is seeded true/true in beforeEach.
    const lifecycle = makeLifecycle();
    lifecycle.onDeviceStatusChanged({ isWearing: false, isInCase: false, connectType: 'none', batteryLevel: 0 });
    expect(deviceFlags.isWearingGlasses).toBe(true);
    expect(deviceFlags.isDeviceConnected).toBe(true);
  });

  it('onDeviceStatusChanged: genuine not-wearing with a real battery still gates', () => {
    const lifecycle = makeLifecycle();
    lifecycle.onDeviceStatusChanged({ isWearing: false, isInCase: false, connectType: 'ble', batteryLevel: 72 });
    expect(deviceFlags.isWearingGlasses).toBe(false);
    expect(deviceFlags.isDeviceConnected).toBe(true);
  });
});
