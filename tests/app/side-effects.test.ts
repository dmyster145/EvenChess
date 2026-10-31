import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSideEffects, type SideEffectsDeps } from '../../src/app/side-effects';
import { createStore } from '../../src/state/store';
import type { GameState } from '../../src/state/contracts';
import { ChessService } from '../../src/chess/chessservice';
import { BoardRenderer } from '../../src/render/boardimage';
import { MENU_INDEX, PLAY_AS_OPTIONS, RESET_CONFIRM_INDEX } from '../../src/state/constants';
import { getEngineProfile } from '../../src/engine/profiles';
import * as persistence from '../../src/storage/persistence';
import { baseGameState } from '../helpers/game-state';

const START_FEN = new ChessService().getFen();

/** Every storage write side-effects.ts can make; each is replaced by a spy in beforeEach. */
const SAVE_FUNCTIONS = [
  'saveGame',
  'saveDifficulty',
  'saveCustomSkillLevel',
  'saveBoardMarkers',
  'saveBoardSize',
  'saveBoardAlignment',
  'saveBoardPosition',
  'savePlayAs',
  'clearSave',
] as const;

type SaveName = (typeof SAVE_FUNCTIONS)[number];

let saveSpies: Record<SaveName, ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  saveSpies = Object.fromEntries(
    SAVE_FUNCTIONS.map((name) => [name, vi.spyOn(persistence, name).mockResolvedValue()]),
  ) as unknown as Record<SaveName, ReturnType<typeof vi.spyOn>>;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The storage writes made so far, as { functionName: [argsOfEachCall] }; unused functions are left out. */
function savesMade(): Partial<Record<SaveName, unknown[][]>> {
  const made: Partial<Record<SaveName, unknown[][]>> = {};
  for (const name of SAVE_FUNCTIONS) {
    if (saveSpies[name].mock.calls.length > 0) made[name] = saveSpies[name].mock.calls;
  }
  return made;
}

/** A ChessService two plies into a game (1. e4 e5), plus the matching store fields. */
function gameInProgress(): { chess: ChessService; fields: Partial<GameState> } {
  const chess = new ChessService();
  chess.makeMove('e2', 'e4');
  chess.makeMove('e7', 'e5');
  return {
    chess,
    fields: { fen: chess.getFen(), turn: 'w', pieces: chess.getPiecesWithMoves(), history: ['e4', 'e5'], hasUnsavedChanges: true },
  };
}

/**
 * Wires createSideEffects to a real store and ChessService. Everything that talks to the glasses or
 * the engine is a fake that appends to one ordered `log`, so tests can check both counts and order.
 */
function setup(initial: Partial<GameState> = {}, chess = new ChessService()) {
  const store = createStore({ ...baseGameState(), ...initial });
  const log: string[] = [];
  let exitDialogPending = false;
  const engineProfiles: unknown[] = [];
  const deps = {
    store,
    chess,
    turnLoop: {
      onPlayerMoved: async () => { log.push('turnLoop.onPlayerMoved'); },
      requestEngineMove: async () => { log.push('turnLoop.requestEngineMove'); },
      setProfile: (profile: unknown) => { engineProfiles.push(profile); },
    },
    bridge: {
      requestSystemExit: () => { log.push('bridge.requestSystemExit'); exitDialogPending = true; },
      isExitDialogPending: () => exitDialogPending,
      updatePage: async () => { log.push('bridge.updatePage'); return true; },
    },
    flush: {
      schedule: () => { log.push('flush.schedule'); },
      cancel: () => { log.push('flush.cancel'); },
      setForceFullRefresh: () => { log.push('flush.setForceFullRefresh'); },
      flushNow: async () => {},
    },
    branding: {
      schedule: () => { log.push('branding.schedule'); },
      cancel: () => { log.push('branding.cancel'); },
      forceNextRefresh: () => { log.push('branding.forceNextRefresh'); },
      syncNow: () => {},
    },
    bulletTimer: { onStateChange: () => {} },
    autosave: {
      queue: () => { log.push('autosave.queue'); },
      clear: () => { log.push('autosave.clear'); },
      flushNow: () => {},
    },
    rendererRef: { current: new BoardRenderer() },
  } as unknown as SideEffectsDeps;
  const sideEffects = createSideEffects(deps);
  store.subscribe((s, prev) => {
    log.push(`dispatch → ${s.phase}`);
    sideEffects.onStateChange(s, prev);
  });
  const count = (entry: string): number => log.filter((e) => e === entry).length;
  return { store, chess, log, count, engineProfiles, sideEffects, rendererRef: deps.rendererRef };
}

describe('side-effects: system exit request', () => {
  it('tapping Exit opens the system dialog once and schedules no screen updates while it is up', () => {
    const { store, count } = setup({ phase: 'menu', menuSelectedIndex: MENU_INDEX.exit });
    store.dispatch({ type: 'TAP' }); // Exit item
    expect(count('bridge.requestSystemExit')).toBe(1);
    expect(count('flush.cancel')).toBe(1);
    expect(count('branding.cancel')).toBe(1);
    expect(count('flush.schedule')).toBe(0);
    expect(count('branding.schedule')).toBe(0);
    expect(store.getState().pendingSystemExitDialog).toBe(false); // request consumed
  });

  it('cancels pending flush and branding sends before asking the bridge for the exit dialog', () => {
    const { store, log } = setup({ phase: 'menu', menuSelectedIndex: MENU_INDEX.exit });
    store.dispatch({ type: 'TAP' });
    // The CLEAR_SYSTEM_EXIT_REQUEST dispatch (second store update) comes after the request.
    expect(log.slice(0, 5)).toEqual([
      'dispatch → menu',
      'flush.cancel',
      'branding.cancel',
      'bridge.requestSystemExit',
      'dispatch → menu',
    ]);
  });

  it('schedules screen updates normally when no exit dialog is up', () => {
    const { store, count } = setup({ phase: 'menu', menuSelectedIndex: MENU_INDEX.exit });
    store.dispatch({ type: 'SCROLL', direction: 'up' });
    expect(count('flush.schedule')).toBe(1);
    expect(count('branding.schedule')).toBe(1);
  });
});

describe('side-effects: settings persistence', () => {
  // These call onStateChange directly with a before/after pair so each test changes exactly one field.
  const base = baseGameState();

  it.each([
    ['playAs', { playAs: 'black' }, { savePlayAs: [['black']] }],
    ['showBoardMarkers', { showBoardMarkers: false }, { saveBoardMarkers: [[false]] }],
    ['boardPosition', { boardPosition: 'top' }, { saveBoardPosition: [['top']] }],
    ['boardSize', { boardSize: 'large' }, { saveBoardSize: [['large']] }],
    ['boardAlignment', { boardAlignment: 'center' }, { saveBoardAlignment: [['center']] }],
    ['difficulty', { difficulty: 'serious' }, { saveDifficulty: [['serious']] }],
  ] as const)('a %s change writes only that setting, once', (_field, change, expected) => {
    const { sideEffects } = setup();
    sideEffects.onStateChange({ ...base, ...change }, base);
    expect(savesMade()).toEqual(expected);
  });

  it('a change to nothing persisted (menu cursor move) writes nothing', () => {
    const { sideEffects } = setup();
    sideEffects.onStateChange({ ...base, phase: 'menu', menuSelectedIndex: 3 }, { ...base, phase: 'menu' });
    expect(savesMade()).toEqual({});
  });

  it('a custom level change while on Custom writes the level and reconfigures the engine', () => {
    const { sideEffects, engineProfiles } = setup();
    const before = { ...base, difficulty: 'custom' as const, customSkillLevel: 3 };
    sideEffects.onStateChange({ ...before, customSkillLevel: 7 }, before);
    expect(savesMade()).toEqual({ saveCustomSkillLevel: [[7]] });
    expect(engineProfiles).toEqual([getEngineProfile('custom', 7)]);
  });

  it('a difficulty change reconfigures the engine with the new tier', () => {
    const { sideEffects, engineProfiles } = setup();
    sideEffects.onStateChange({ ...base, difficulty: 'easy' }, base);
    expect(engineProfiles).toEqual([getEngineProfile('easy', base.customSkillLevel)]);
  });

  it('a difficulty change mid-game also re-saves the game with the new difficulty', () => {
    const { sideEffects } = setup();
    const { fields } = gameInProgress();
    const before = { ...base, ...fields, playerColor: 'b' as const };
    sideEffects.onStateChange({ ...before, difficulty: 'serious' }, before);
    expect(savesMade()).toEqual({
      saveDifficulty: [['serious']],
      saveGame: [[fields.fen, ['e4', 'e5'], 'w', 'serious', 'b', base.customSkillLevel]],
    });
  });

  it('a board size change swaps in a renderer for the new grid and forces a full repaint', () => {
    const { sideEffects, rendererRef, count } = setup();
    const oldRenderer = rendererRef.current;
    sideEffects.onStateChange({ ...base, boardSize: 'large' }, base);
    expect(rendererRef.current).not.toBe(oldRenderer);
    expect(count('flush.setForceFullRefresh')).toBe(1);
    expect(count('branding.forceNextRefresh')).toBe(1);
  });

  it('a board alignment change rebuilds the page once', () => {
    const { sideEffects, count } = setup();
    sideEffects.onStateChange({ ...base, boardAlignment: 'center' }, base);
    expect(count('bridge.updatePage')).toBe(1);
    expect(count('flush.setForceFullRefresh')).toBe(1);
  });

  it('toggling a display option through the menu writes it exactly once', () => {
    // displayOptionsSelect row 2 is Board Markers; a tap flips it in place.
    const { store } = setup({ phase: 'displayOptionsSelect', menuSelectedIndex: 2 });
    store.dispatch({ type: 'TAP' });
    expect(savesMade()).toEqual({ saveBoardMarkers: [[false]] });
  });
});

describe('side-effects: autosave', () => {
  it('a new move queues an autosave; clearing the history cancels it', () => {
    const { sideEffects, count } = setup();
    const empty = baseGameState();
    const oneMove = { ...empty, history: ['e4'] };
    sideEffects.onStateChange(oneMove, empty);
    expect(count('autosave.queue')).toBe(1);
    expect(count('autosave.clear')).toBe(0);
    sideEffects.onStateChange(empty, oneMove);
    expect(count('autosave.queue')).toBe(1);
    expect(count('autosave.clear')).toBe(1);
  });
});

describe('side-effects: reset and new-game flows', () => {
  it('confirming Reset clears the save and starts one fresh game', () => {
    const { chess, fields } = gameInProgress();
    const resetSpy = vi.spyOn(chess, 'reset');
    const { store, count } = setup(
      { ...fields, phase: 'resetConfirm', menuSelectedIndex: RESET_CONFIRM_INDEX.confirm },
      chess,
    );
    store.dispatch({ type: 'TAP' });
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(savesMade()).toEqual({ clearSave: [[]] });
    expect(count('autosave.clear')).toBe(1);
    const state = store.getState();
    expect(state.fen).toBe(START_FEN);
    expect(state.history).toEqual([]);
    expect(state.pendingReset).toBe(false);
    expect(state.playerColor).toBe('w');
    expect(count('turnLoop.requestEngineMove')).toBe(0); // human is White, so the human moves first
  });

  it('cancelling Reset leaves the game and the save alone', () => {
    const { chess, fields } = gameInProgress();
    const resetSpy = vi.spyOn(chess, 'reset');
    const { store } = setup(
      { ...fields, phase: 'resetConfirm', menuSelectedIndex: RESET_CONFIRM_INDEX.cancel },
      chess,
    );
    store.dispatch({ type: 'TAP' });
    expect(resetSpy).not.toHaveBeenCalled();
    expect(savesMade()).toEqual({});
    expect(store.getState().history).toEqual(['e4', 'e5']);
  });

  it('confirming a mid-game switch to Black commits it, resets, and asks the engine for the opening move', () => {
    const { chess, fields } = gameInProgress();
    const resetSpy = vi.spyOn(chess, 'reset');
    const { store, count } = setup(
      { ...fields, phase: 'resetConfirm', menuSelectedIndex: RESET_CONFIRM_INDEX.confirm, pendingPlayAs: 'black' },
      chess,
    );
    store.dispatch({ type: 'TAP' });
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(savesMade()).toEqual({ savePlayAs: [['black']], clearSave: [[]] });
    expect(store.getState().playerColor).toBe('b');
    expect(store.getState().history).toEqual([]);
    expect(count('turnLoop.requestEngineMove')).toBe(1);
  });

  it('picking Black on a fresh board applies it at once and the engine opens', () => {
    const chess = new ChessService();
    const resetSpy = vi.spyOn(chess, 'reset');
    const { store, count } = setup(
      { phase: 'playAsSelect', menuSelectedIndex: PLAY_AS_OPTIONS.indexOf('black') },
      chess,
    );
    store.dispatch({ type: 'TAP' });
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(savesMade()).toEqual({ savePlayAs: [['black']], clearSave: [[]] });
    expect(store.getState().playerColor).toBe('b');
    expect(count('turnLoop.requestEngineMove')).toBe(1);
  });

  it('starting a new game after game over resets the board once without clearing the save', () => {
    const { chess, fields } = gameInProgress();
    const resetSpy = vi.spyOn(chess, 'reset');
    const { store } = setup({ ...fields, gameOver: 'Black wins on time!' }, chess);
    store.dispatch({ type: 'DOUBLE_TAP' });
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(savesMade()).toEqual({});
    expect(store.getState().gameOver).toBeNull();
    expect(store.getState().fen).toBe(START_FEN);
    expect(store.getState().history).toEqual([]);
  });

  it('starting a bullet game from the time-control picker resets the board once', () => {
    const { chess, fields } = gameInProgress();
    const resetSpy = vi.spyOn(chess, 'reset');
    const { store } = setup({ ...fields, phase: 'bulletSetup' }, chess);
    store.dispatch({ type: 'TAP' });
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(store.getState().mode).toBe('bullet');
    expect(store.getState().fen).toBe(START_FEN);
    expect(store.getState().history).toEqual([]);
  });
});
