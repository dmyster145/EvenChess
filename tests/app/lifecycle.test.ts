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
import { OsEventTypeList } from '@evenrealities/even_hub_sdk';

const SYSTEM_EXIT = (OsEventTypeList as unknown as { SYSTEM_EXIT_EVENT?: number }).SYSTEM_EXIT_EVENT ?? 7;

interface BridgeRecorder {
  cleared: number;
  shutdownCalls: number;
  forceResets: number;
  updatePages: number;
  clearExitDialogCalls: number;
  exitDialogPending: boolean;
  resolveShutdown: () => void;
}

function makeBridge(): EvenHubBridge & BridgeRecorder {
  let resolveShutdown = (): void => {};
  const recorder: Partial<EvenHubBridge> & BridgeRecorder = {
    cleared: 0,
    shutdownCalls: 0,
    forceResets: 0,
    updatePages: 0,
    clearExitDialogCalls: 0,
    exitDialogPending: false,
    resolveShutdown: () => resolveShutdown(),
    clearPending() {
      this.cleared += 1;
    },
    forceResetImageTransport() {
      this.forceResets += 1;
    },
    isExitDialogPending() {
      return this.exitDialogPending;
    },
    clearExitDialog() {
      this.clearExitDialogCalls += 1;
      this.exitDialogPending = false;
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

  function makeLifecycle(opts?: { imageContainersActive?: boolean }): ReturnType<typeof createLifecycle> {
    const imageContainersActive = opts?.imageContainersActive ?? true;
    return createLifecycle({
      bridge,
      store,
      flush,
      branding,
      bulletTimer,
      autosave,
      deviceFlags,
      imageContainersActive: () => imageContainersActive,
    });
  }

  // --- Normal lifecycle (no exit dialog pending) ---

  it('FOREGROUND_EXIT (no exit dialog) suspends timer + flushes autosave', () => {
    const lifecycle = makeLifecycle();
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } });
    expect(bulletTimer.suspended).toBe(1);
    expect(autosave.flushes).toBe(1);
    expect(bridge.cleared).toBe(0);
  });

  it('FOREGROUND_ENTER (no exit dialog) resumes timer + force-refreshes, after a FG_EXIT', async () => {
    const lifecycle = makeLifecycle();
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } });
    // Advance past the sys-event dedup window so the ENTER isn't swallowed.
    await vi.advanceTimersByTimeAsync(700);
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } });
    expect(bulletTimer.resumed).toBe(1);
    expect(flush.forces).toBeGreaterThanOrEqual(1);
    expect(flush.flushNows).toBe(1);
  });

  it('duplicate sys events within 600ms are deduped', () => {
    const lifecycle = makeLifecycle();
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } });
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } });
    expect(bulletTimer.suspended).toBe(1);
    expect(autosave.flushes).toBe(1);
  });

  // --- Exit-dialog path (inverted polarity) ---

  // The exit-dialog path is runtime-dead while the dialog is suppressed (ER SDK image-channel
  // defect — see app.ts isExitDialogEnabled). These tests pin the EvenRoads-style handling that
  // takes effect if/when the dialog is re-enabled after ER ships an SDK fix.

  it('exit dialog: FOREGROUND_ENTER (sys=4) rebuilds the page, does NOT resume as a foreground', () => {
    bridge.exitDialogPending = true;
    const lifecycle = makeLifecycle({ imageContainersActive: true });
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } });
    // Host cleared the page when the dialog appeared — rebuild it (control channel works).
    expect(bridge.updatePages).toBe(1);
    // Must NOT run the normal foreground-resume path.
    expect(bulletTimer.resumed).toBe(0);
    expect(flush.flushNows).toBe(0);
  });

  it('exit dialog: FOREGROUND_EXIT (sys=5) = "No" — clears flag, re-renders, app stays alive (no pause, no reload)', () => {
    bridge.exitDialogPending = true;
    const lifecycle = makeLifecycle({ imageContainersActive: true });
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } });
    expect(bridge.clearExitDialogCalls).toBe(1);
    // Must NOT treat as background.
    expect(bulletTimer.suspended).toBe(0);
    // Re-renders to keep the app alive; no page rebuild here (sys=4 did that), no WebView reload.
    expect(bridge.updatePages).toBe(0);
    expect(flush.flushNows).toBe(1);
  });

  it('exit dialog: SYSTEM_EXIT (sys=7) = "Yes" — cleans up and shuts down', async () => {
    bridge.exitDialogPending = true;
    const lifecycle = makeLifecycle();
    lifecycle.attach();
    lifecycle.onHubEvent({ sysEvent: { eventType: SYSTEM_EXIT } });
    expect(bridge.clearExitDialogCalls).toBe(1);
    expect(flush.cancels).toBe(1);
    expect(branding.cancels).toBe(1);
    expect(autosave.flushes).toBe(1);
    expect(bridge.shutdownCalls).toBe(1);
    bridge.resolveShutdown();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('exit dialog cancel then a genuine later background works normally', async () => {
    bridge.exitDialogPending = true;
    const lifecycle = makeLifecycle({ imageContainersActive: true });
    // "No" tapped — flag cleared.
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } });
    expect(bridge.exitDialogPending).toBe(false);
    expect(bulletTimer.suspended).toBe(0);
    await vi.advanceTimersByTimeAsync(700);
    // A genuine background later (no exit dialog pending) now suspends normally.
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } });
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

  it('attach() is idempotent', () => {
    const lifecycle = makeLifecycle();
    lifecycle.attach();
    lifecycle.attach();
    lifecycle.detach();
  });
});
