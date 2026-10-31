import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createReinit, type ReinitDeps } from '../../src/app/bridge-reinit';
import { createStore } from '../../src/state/store';
import { baseGameState } from '../helpers/game-state';

/** Wires createReinit to fakes that append every call to one ordered log. */
function setup(opts: { setupPageOk?: boolean; shutdownThrows?: boolean } = {}) {
  const log: string[] = [];
  const deviceStatusUnsubscribe = (): void => {};
  const launchSourceUnsubscribe = (): void => {};
  const hubEventHandler = (): void => {};
  const deviceStatusHandler = (): void => {};
  const set = { deviceStatus: null as (() => void) | null, launchSource: null as (() => void) | null };
  const deps = {
    bridge: {
      shutdown: async () => {
        log.push('bridge.shutdown');
        if (opts.shutdownThrows) throw new Error('already gone');
      },
      init: async () => { log.push('bridge.init'); },
      subscribeEvents: (handler: unknown) => { log.push(handler === hubEventHandler ? 'bridge.subscribeEvents(hub)' : 'bridge.subscribeEvents(?)'); },
      subscribeDeviceStatus: () => { log.push('bridge.subscribeDeviceStatus'); return deviceStatusUnsubscribe; },
      subscribeLaunchSource: () => { log.push('bridge.subscribeLaunchSource'); return launchSourceUnsubscribe; },
      setupPage: async () => { log.push('bridge.setupPage'); return opts.setupPageOk ?? true; },
      updatePage: async () => { log.push('bridge.updatePage'); return true; },
    },
    store: createStore(baseGameState()),
    flush: {
      cancel: () => { log.push('flush.cancel'); },
      setForceFullRefresh: () => { log.push('flush.setForceFullRefresh'); },
      flushNow: async (o?: { force?: boolean }) => { log.push(`flush.flushNow(force=${String(o?.force)})`); },
      schedule: () => {},
    },
    branding: {
      cancel: () => { log.push('branding.cancel'); },
      forceNextRefresh: () => { log.push('branding.forceNextRefresh'); },
      syncNow: () => { log.push('branding.syncNow'); },
      schedule: () => {},
    },
    imageContainersActive: () => true,
    hubEventHandler,
    deviceStatusHandler,
    setDeviceStatusUnsubscribe: (fn: (() => void) | null) => { set.deviceStatus = fn; },
    setLaunchSourceUnsubscribe: (fn: (() => void) | null) => { set.launchSource = fn; },
  } as unknown as ReinitDeps;
  return { reinit: createReinit(deps), log, set, deviceStatusUnsubscribe, launchSourceUnsubscribe };
}

describe('createReinit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shuts down, waits for the link to settle, then brings the bridge back and repaints everything', async () => {
    const { reinit, log } = setup();
    const done = reinit.reinit('test');
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['flush.cancel', 'branding.cancel', 'bridge.shutdown']); // still settling
    await vi.advanceTimersByTimeAsync(1500);
    await done;
    expect(log).toEqual([
      'flush.cancel',
      'branding.cancel',
      'bridge.shutdown',
      'bridge.init',
      'bridge.subscribeEvents(hub)',
      'bridge.subscribeDeviceStatus',
      'bridge.subscribeLaunchSource',
      'bridge.setupPage',
      'flush.setForceFullRefresh',
      'branding.forceNextRefresh',
      'flush.flushNow(force=true)',
      'branding.syncNow',
    ]);
  });

  it('hands the new subscriptions back so the app can unsubscribe them later', async () => {
    const { reinit, set, deviceStatusUnsubscribe, launchSourceUnsubscribe } = setup();
    const done = reinit.reinit('test');
    await vi.advanceTimersByTimeAsync(1500);
    await done;
    expect(set.deviceStatus).toBe(deviceStatusUnsubscribe);
    expect(set.launchSource).toBe(launchSourceUnsubscribe);
  });

  it('rebuilds the page when the new bridge rejects a second startup page', async () => {
    const { reinit, log } = setup({ setupPageOk: false });
    const done = reinit.reinit('test');
    await vi.advanceTimersByTimeAsync(1500);
    await done;
    expect(log.slice(7, 9)).toEqual(['bridge.setupPage', 'bridge.updatePage']);
  });

  it('carries on when the old bridge fails to shut down', async () => {
    const { reinit, log } = setup({ shutdownThrows: true });
    const done = reinit.reinit('test');
    await vi.advanceTimersByTimeAsync(1500);
    await done;
    expect(log).toContain('bridge.init');
    expect(log.at(-1)).toBe('branding.syncNow');
  });

  it('ignores a second reinit while one is running, and allows one after it finishes', async () => {
    const { reinit, log } = setup();
    const first = reinit.reinit('first');
    const second = reinit.reinit('second');
    await vi.advanceTimersByTimeAsync(1500);
    await Promise.all([first, second]);
    expect(log.filter((e) => e === 'bridge.shutdown')).toHaveLength(1);

    const third = reinit.reinit('third');
    await vi.advanceTimersByTimeAsync(1500);
    await third;
    expect(log.filter((e) => e === 'bridge.shutdown')).toHaveLength(2);
  });
});
