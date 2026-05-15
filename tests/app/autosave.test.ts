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
});
