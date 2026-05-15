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

interface BridgeRecorder {
  cleared: number;
  shutdownCalls: number;
  forceResets: number;
  resolveShutdown: () => void;
}

function makeBridge(): EvenHubBridge & BridgeRecorder {
  let resolveShutdown = (): void => {};
  const recorder: Partial<EvenHubBridge> & BridgeRecorder = {
    kind: 'v2',
    cleared: 0,
    shutdownCalls: 0,
    forceResets: 0,
    resolveShutdown: () => resolveShutdown(),
    clearPending() {
      this.cleared += 1;
    },
    forceResetImageTransport() {
      this.forceResets += 1;
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
    // No-op — tests that attach() also call detach() in cleanup.
  });

  function makeLifecycle(opts?: { imageContainersActive?: boolean }): ReturnType<typeof createLifecycle> {
    const imageContainersActive = opts?.imageContainersActive ?? false;
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

  it('FOREGROUND_EXIT suspends timer + flushes autosave but does NOT clear bridge pending', () => {
    // Per the iOS WKWebView fix: clearing the bridge's pending map on FG_EXIT interacted badly
    // with shutDownPageContainer(1)'s exit-dialog flow (the SDK send sometimes never resolved
    // and the `cleared` flag mechanism delayed recovery). Latest-wins handles staleness on resume.
    const lifecycle = makeLifecycle();
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } });
    expect(bridge.cleared).toBe(0);
    expect(bulletTimer.suspended).toBe(1);
    expect(autosave.flushes).toBe(1);
  });

  it('FOREGROUND_ENTER forces a refresh and resumes timer (must follow a FOREGROUND_EXIT)', async () => {
    const lifecycle = makeLifecycle();
    // The dedupe ignores show-while-already-showing; first put the app into hidden state.
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } });
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } });
    expect(bulletTimer.resumed).toBe(1);
    expect(flush.forces).toBeGreaterThanOrEqual(1);
    expect(branding.forces).toBeGreaterThanOrEqual(1);
    expect(flush.flushNows).toBe(1);
  });

  it('duplicate FOREGROUND_EXIT and FOREGROUND_ENTER events are deduped (SDK fires per ear)', () => {
    const lifecycle = makeLifecycle();
    // Two consecutive exits — second is ignored.
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } });
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } });
    expect(bulletTimer.suspended).toBe(1);
    expect(autosave.flushes).toBe(1);

    // Two consecutive enters — second is ignored.
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } });
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } });
    expect(bulletTimer.resumed).toBe(1);
    expect(flush.flushNows).toBe(1);
  });

  it('SYSTEM_EXIT awaits bridge.shutdown() then detaches', async () => {
    const lifecycle = makeLifecycle();
    lifecycle.attach();
    const systemExitType = (OsEventTypeList as unknown as { SYSTEM_EXIT_EVENT?: number }).SYSTEM_EXIT_EVENT;
    expect(typeof systemExitType).toBe('number');
    lifecycle.onHubEvent({ sysEvent: { eventType: systemExitType } });
    expect(bridge.shutdownCalls).toBe(1);
    expect(autosave.flushes).toBe(1);
    expect(flush.cancels).toBe(1);
    expect(branding.cancels).toBe(1);
    bridge.resolveShutdown();
    // Allow the awaited shutdown promise to resolve and detach to fire.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

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

  it('notifyInputReceived treats input-while-hidden as an implicit foreground-enter', () => {
    const lifecycle = makeLifecycle();
    // Put the app into hidden state.
    lifecycle.onHubEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } });
    expect(bulletTimer.suspended).toBe(1);

    // Input arrives but no FG_ENTER fires (iOS post-dialog quirk). notifyInputReceived runs the
    // recovery path.
    lifecycle.notifyInputReceived();
    expect(bulletTimer.resumed).toBe(1);
    expect(flush.forces).toBeGreaterThanOrEqual(1);
    expect(branding.forces).toBeGreaterThanOrEqual(1);
    expect(flush.flushNows).toBe(1);
    expect(bridge.forceResets).toBe(1);
  });

  it('notifyInputReceived is a no-op when not hidden', () => {
    const lifecycle = makeLifecycle();
    lifecycle.notifyInputReceived();
    expect(bulletTimer.resumed).toBe(0);
    expect(flush.forces).toBe(0);
    expect(bridge.forceResets).toBe(0);
  });
});
