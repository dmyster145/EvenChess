import { describe, it, expect, beforeEach } from 'vitest';
import { loadInitialAppState } from '../../src/app/init';
import { initPersistence, saveGame, loadGame } from '../../src/storage/persistence';
import { ChessService } from '../../src/chess/chessservice';

const START_FEN = new ChessService().getFen();
// Black to move with no legal moves and not in check.
const STALEMATE_FEN = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';

describe('loadInitialAppState (saved game)', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    initPersistence(
      async (key) => storage.get(key) ?? null,
      async (key, value) => { storage.set(key, value); },
    );
  });

  it('resumes a game in progress', async () => {
    const chess = new ChessService();
    chess.makeMove('e2', 'e4');
    await saveGame(chess.getFen(), ['e4'], 'b');
    const state = await loadInitialAppState(new ChessService());
    expect(state.history).toEqual(['e4']);
    expect(state.turn).toBe('b');
  });

  it('starts a new game instead of resuming a stalemate', async () => {
    await saveGame(STALEMATE_FEN, ['e4', 'e5'], 'b');
    const chess = new ChessService();
    const state = await loadInitialAppState(chess);
    expect(state.history).toEqual([]);
    expect(state.fen).toBe(START_FEN);
    expect(state.pieces.length).toBeGreaterThan(0);
    await Promise.resolve();
    expect(await loadGame()).toBeNull(); // the dead save is cleared
  });

  it('starts a new game instead of showing a saved log over the wrong board', async () => {
    await saveGame('not a fen', ['e4', 'e5', 'Nf3'], 'b');
    const state = await loadInitialAppState(new ChessService());
    expect(state.history).toEqual([]);
    expect(state.fen).toBe(START_FEN);
  });
});
