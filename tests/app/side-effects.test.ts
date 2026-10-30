import { describe, it, expect } from 'vitest';
import { createSideEffects, type SideEffectsDeps } from '../../src/app/side-effects';
import { createStore } from '../../src/state/store';
import { ChessService } from '../../src/chess/chessservice';
import { BoardRenderer } from '../../src/render/boardimage';
import { MENU_INDEX } from '../../src/state/constants';
import { baseGameState } from '../helpers/game-state';

/** Wires createSideEffects to a real store with counting fakes for everything that talks to the glasses. */
function setup() {
  const chess = new ChessService();
  const store = createStore({ ...baseGameState(), phase: 'menu', menuSelectedIndex: MENU_INDEX.EXIT });
  let exitDialogPending = false;
  const calls = { systemExits: 0, flushSchedules: 0, brandingSchedules: 0, flushCancels: 0, brandingCancels: 0 };
  const deps = {
    store,
    chess,
    turnLoop: { onPlayerMoved: async () => {}, requestEngineMove: async () => {}, setProfile: () => {} },
    bridge: {
      requestSystemExit: () => { calls.systemExits += 1; exitDialogPending = true; },
      isExitDialogPending: () => exitDialogPending,
      updatePage: async () => true,
    },
    flush: { schedule: () => { calls.flushSchedules += 1; }, cancel: () => { calls.flushCancels += 1; }, setForceFullRefresh: () => {}, flushNow: async () => {} },
    branding: { schedule: () => { calls.brandingSchedules += 1; }, cancel: () => { calls.brandingCancels += 1; }, forceNextRefresh: () => {}, syncNow: () => {} },
    bulletTimer: { onStateChange: () => {} },
    autosave: { queue: () => {}, clear: () => {}, flushNow: () => {} },
    rendererRef: { current: new BoardRenderer() },
  } as unknown as SideEffectsDeps;
  const sideEffects = createSideEffects(deps);
  store.subscribe((s, prev) => sideEffects.onStateChange(s, prev));
  return { store, calls, setPending: (v: boolean) => { exitDialogPending = v; } };
}

describe('side-effects: system exit request', () => {
  it('tapping Exit opens the system dialog once and schedules no screen updates while it is up', () => {
    const { store, calls } = setup();
    store.dispatch({ type: 'TAP', selectedIndex: 0, selectedName: '' }); // Exit item
    expect(calls.systemExits).toBe(1);
    expect(calls.flushCancels).toBe(1);
    expect(calls.brandingCancels).toBe(1);
    expect(calls.flushSchedules).toBe(0);
    expect(calls.brandingSchedules).toBe(0);
    expect(store.getState().pendingSystemExitDialog).toBe(false); // request consumed
  });

  it('schedules screen updates normally when no exit dialog is up', () => {
    const { store, calls } = setup();
    store.dispatch({ type: 'SCROLL', direction: 'up' });
    expect(calls.flushSchedules).toBeGreaterThan(0);
    expect(calls.brandingSchedules).toBeGreaterThan(0);
  });
});
