import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from '../../src/state/store';
import { buildInitialState } from '../../src/state/contracts';
import type { Action, GameState } from '../../src/state/contracts';
import { ChessService } from '../../src/chess/chessservice';
import { createAutosave } from '../../src/app/autosave';
import * as persistence from '../../src/storage/persistence';

describe('createAutosave', () => {
  let chess: ChessService;
  let store: ReturnType<typeof createStore>;
  let dispatched: Action[];
  let saveSpy: ReturnType<typeof vi.spyOn>;

  function withMoves(state: GameState, history: string[]): GameState {
    return { ...state, history, hasUnsavedChanges: true };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    chess = new ChessService();
    store = createStore(withMoves(buildInitialState(chess), ['e4', 'e5']));
    dispatched = [];
    saveSpy = vi.spyOn(persistence, 'saveGame').mockResolvedValue();
  });

  afterEach(() => {
    saveSpy.mockRestore();
    vi.useRealTimers();
  });

  it('queue() with empty history is a no-op', () => {
    const autosave = createAutosave({ store, dispatch: (a) => dispatched.push(a) });
    autosave.queue({ ...buildInitialState(chess), history: [] });
    vi.advanceTimersByTime(500);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('queue() debounces and writes once at the idle delay', () => {
    const autosave = createAutosave({ store, dispatch: (a) => dispatched.push(a) });
    autosave.queue(store.getState());
    autosave.queue(store.getState());
    autosave.queue(store.getState());
    expect(saveSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('flushNow() writes immediately', () => {
    const autosave = createAutosave({ store, dispatch: (a) => dispatched.push(a) });
    autosave.queue(store.getState());
    autosave.flushNow();
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('clear() drops the pending snapshot without writing', () => {
    const autosave = createAutosave({ store, dispatch: (a) => dispatched.push(a) });
    autosave.queue(store.getState());
    autosave.clear();
    vi.advanceTimersByTime(500);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('dispatches MARK_SAVED when the saved snapshot matches current state', () => {
    const autosave = createAutosave({ store, dispatch: (a) => dispatched.push(a) });
    autosave.queue(store.getState());
    autosave.flushNow();
    expect(dispatched).toEqual([{ type: 'MARK_SAVED' }]);
  });

  it('passes the queued game to saveGame in its parameter order', () => {
    const state: GameState = {
      ...withMoves(buildInitialState(chess), ['e4', 'e5', 'Nf3']),
      fen: 'test-fen',
      turn: 'b',
      difficulty: 'custom',
      customSkillLevel: 7,
      playerColor: 'b',
    };
    const autosave = createAutosave({ store, dispatch: (a) => dispatched.push(a) });
    autosave.queue(state);
    autosave.flushNow();
    // saveGame(fen, history, turn, difficulty, playerColor, customSkillLevel)
    expect(saveSpy).toHaveBeenCalledWith('test-fen', ['e4', 'e5', 'Nf3'], 'b', 'custom', 'b', 7);
  });

  it('saves the history as it was when queued, not as later mutated', () => {
    const history = ['e4', 'e5'];
    const autosave = createAutosave({ store, dispatch: (a) => dispatched.push(a) });
    autosave.queue({ ...store.getState(), history });
    history.push('Nf3');
    autosave.flushNow();
    expect(saveSpy.mock.calls[0]?.[1]).toEqual(['e4', 'e5']);
  });

  it('a move made between queue and save is not marked saved; it is re-queued and saved after another delay', () => {
    const autosave = createAutosave({ store, dispatch: (a) => dispatched.push(a) });
    autosave.queue(store.getState()); // e4 e5
    // The store moves on before the idle timer fires (store is not wired to autosave here).
    store.dispatch({ type: 'RESTORE_STATE', state: withMoves(store.getState(), ['e4', 'e5', 'Nf3']) });

    vi.advanceTimersByTime(200);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0]?.[1]).toEqual(['e4', 'e5']);
    expect(dispatched).toEqual([]); // the stale snapshot must not clear hasUnsavedChanges

    vi.advanceTimersByTime(200);
    expect(saveSpy).toHaveBeenCalledTimes(2);
    expect(saveSpy.mock.calls[1]?.[1]).toEqual(['e4', 'e5', 'Nf3']);
    expect(dispatched).toEqual([{ type: 'MARK_SAVED' }]);
  });

  it('a difficulty change between queue and save also counts as a mismatch', () => {
    const autosave = createAutosave({ store, dispatch: (a) => dispatched.push(a) });
    autosave.queue(store.getState());
    store.dispatch({ type: 'RESTORE_STATE', state: { ...store.getState(), difficulty: 'serious' } });
    autosave.flushNow();
    expect(dispatched).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(saveSpy).toHaveBeenCalledTimes(2);
    expect(saveSpy.mock.calls[1]?.[3]).toBe('serious');
  });

  it('does not re-queue when the state already counts as saved', () => {
    const autosave = createAutosave({ store, dispatch: (a) => dispatched.push(a) });
    autosave.queue(store.getState());
    store.dispatch({ type: 'RESTORE_STATE', state: { ...withMoves(store.getState(), ['e4', 'e5', 'Nf3']), hasUnsavedChanges: false } });
    autosave.flushNow();
    vi.advanceTimersByTime(500);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(dispatched).toEqual([]);
  });
});
