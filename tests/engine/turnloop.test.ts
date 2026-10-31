import { describe, it, expect, vi, afterEach, onTestFinished } from 'vitest';
import { TurnLoop, type ChessEngine } from '../../src/engine/turnloop';
import { ChessService } from '../../src/chess/chessservice';
import { createStore } from '../../src/state/store';
import { CASUAL, SERIOUS } from '../../src/engine/profiles';
import type { EngineProfile, GameState } from '../../src/state/contracts';
import { baseGameState } from '../helpers/game-state';

/** A controllable engine: each getBestMove waits until the test answers it. */
class FakeEngine implements ChessEngine {
  calls: Array<{ fen: string; profile: EngineProfile; answer: (uci: string | null) => void }> = [];
  stops = 0;
  async init(): Promise<void> {}
  getBestMove(fen: string, profile: EngineProfile): Promise<string | null> {
    return new Promise((resolve) => this.calls.push({ fen, profile, answer: resolve }));
  }
  stop(): void { this.stops += 1; }
  destroy(): void {}
}

/** Let pending promise callbacks run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(state: Partial<GameState>, chess = new ChessService()) {
  const store = createStore({ ...baseGameState(), fen: chess.getFen(), turn: chess.getTurn(), pieces: chess.getPiecesWithMoves(), ...state });
  const engine = new FakeEngine();
  const loop = new TurnLoop(chess, store, CASUAL, engine);
  return { chess, store, engine, loop };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('TurnLoop', () => {
  it('an engine turn asked for before start-up waits for the engine instead of searching early', async () => {
    const { engine, loop } = setup({ playerColor: 'b' });
    let finishInit!: () => void;
    let inits = 0;
    engine.init = () => { inits += 1; return new Promise<void>((r) => { finishInit = r; }); };

    void loop.requestEngineMove();            // e.g. a background restore on the engine's turn
    await settle();
    expect(engine.calls).toHaveLength(0);     // no search against an engine that isn't up
    const appInit = loop.init();              // app.ts's own init() joins the same start-up
    expect(inits).toBe(1);

    finishInit();
    await appInit;
    await settle();
    expect(engine.calls).toHaveLength(1);
  });

  it('credits the bullet increment to the engine\'s own color when the engine plays White', async () => {
    const timers = { whiteMs: 60000, blackMs: 60000, incrementMs: 2000 };
    const { store, engine, loop } = setup({ mode: 'bullet', playerColor: 'b', timers, timerActive: true, lastTickTime: Date.now() });
    const done = loop.requestEngineMove();
    await settle();
    engine.calls[0]!.answer('e2e4');
    await done;
    expect(store.getState().history).toEqual(['e4']);
    expect(store.getState().timers?.whiteMs).toBeGreaterThanOrEqual(61000); // White (engine) got it
    expect(store.getState().timers?.blackMs).toBe(60000);                   // Black (human) did not
  });

  it('a request made while a search is in flight stops it and runs afterwards (not dropped)', async () => {
    const { store, engine, loop } = setup({ playerColor: 'b' });
    const first = loop.requestEngineMove();
    await settle();
    expect(engine.calls).toHaveLength(1);

    const second = loop.requestEngineMove();  // e.g. a new game started mid-search
    expect(engine.stops).toBe(1);             // the stale search is told to stop

    engine.calls[0]!.answer('e2e4');          // stale answer arrives…
    await first;
    await settle();
    expect(store.getState().history).toEqual([]); // …is not played, even though it is still legal…
    expect(engine.calls).toHaveLength(2);     // …and the queued request searches again
    engine.calls[1]!.answer('d2d4');
    await second;
    expect(store.getState().history).toEqual(['d4']);
  });

  it('in Bullet, caps the search time from the engine\'s remaining clock', async () => {
    const { engine, loop } = setup({
      mode: 'bullet', playerColor: 'b', timerActive: true, lastTickTime: Date.now(),
      timers: { whiteMs: 9000, blackMs: 60000, incrementMs: 0 },
    });
    loop.setProfile(SERIOUS);                 // 3000ms movetime
    void loop.requestEngineMove();
    await settle();
    expect(engine.calls[0]!.profile.movetime).toBe(300); // 9000 / 30
  });

  it('in Bullet, the search budget also gets half the increment', async () => {
    const { engine, loop } = setup({
      mode: 'bullet', playerColor: 'b', timerActive: true, lastTickTime: Date.now(),
      timers: { whiteMs: 9000, blackMs: 60000, incrementMs: 2000 },
    });
    loop.setProfile(SERIOUS);
    void loop.requestEngineMove();
    await settle();
    expect(engine.calls[0]!.profile.movetime).toBe(1300); // 9000 / 30 + 2000 / 2
  });

  it('outside Bullet, searches with the difficulty\'s own movetime', async () => {
    const { engine, loop } = setup({ mode: 'play', playerColor: 'b' });
    loop.setProfile(SERIOUS);
    void loop.requestEngineMove();
    await settle();
    expect(engine.calls[0]!.profile.movetime).toBe(SERIOUS.movetime);
  });

  it('an engine move that ends the game stops the bullet clock immediately', async () => {
    // White mates with Qh5xf7#.
    const chess = new ChessService();
    for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['d1', 'h5'], ['b8', 'c6'], ['f1', 'c4'], ['g8', 'f6']] as const) {
      chess.makeMove(from, to);
    }
    const { store, engine, loop } = setup({
      mode: 'bullet', playerColor: 'b', timerActive: true, lastTickTime: Date.now(),
      timers: { whiteMs: 60000, blackMs: 400, incrementMs: 0 },
    }, chess);
    const done = loop.requestEngineMove();
    await settle();
    engine.calls[0]!.answer('h5f7');
    await done;
    expect(store.getState().lastMove).toBe('Qxf7#');
    // Before GAME_OVER (delayed 500ms) the human's clock must already be stopped.
    expect(store.getState().gameOver).toBeNull();
    expect(store.getState().timerActive).toBe(false);
  });

  it('in Bullet with the human as White, each increment goes to the side that just moved', async () => {
    const timers = { whiteMs: 60000, blackMs: 60000, incrementMs: 2000 };
    // Date is frozen so no time passes between turn changes; only the increments move the clocks.
    vi.useFakeTimers({ toFake: ['Date'] });
    onTestFinished(() => { vi.useRealTimers(); });
    const { store, engine, loop } = setup({ mode: 'bullet', playerColor: 'w', timers, timerActive: true, lastTickTime: Date.now() });
    const done = loop.onPlayerMoved({ uci: 'e2e4', san: 'e4', from: 'e2', to: 'e4' });
    await settle();
    expect(store.getState().timers).toEqual({ whiteMs: 62000, blackMs: 60000, incrementMs: 2000 }); // human (White)
    engine.calls[0]!.answer('e7e5');
    await done;
    expect(store.getState().timers).toEqual({ whiteMs: 62000, blackMs: 62000, incrementMs: 2000 }); // engine (Black)
  });

  it('drops the engine\'s answer when the position changed while it was searching', async () => {
    const { chess, store, engine, loop } = setup({ playerColor: 'b' });
    const done = loop.requestEngineMove();
    await settle();
    chess.makeMove('e2', 'e4');               // the board moved on during the search…
    chess.makeMove('e7', 'e5');               // …and it is White's turn again
    engine.calls[0]!.answer('d2d4');          // legal now, but searched for the old position
    await done;
    expect(chess.getHistory()).toEqual(['e4', 'e5']);
    expect(store.getState().history).toEqual([]);
    expect(store.getState().engineThinking).toBe(false);
  });

  it('an engine that returns no move clears the thinking flag and leaves the board as it was', async () => {
    const { chess, store, engine, loop } = setup({ playerColor: 'b' });
    const done = loop.requestEngineMove();
    await settle();
    expect(store.getState().engineThinking).toBe(true);
    engine.calls[0]!.answer(null);
    await done;
    expect(store.getState().engineThinking).toBe(false);
    expect(chess.getHistory()).toEqual([]);
  });

  it('declares GAME_OVER exactly 500ms after a mating engine move, so the move is shown first', async () => {
    vi.useFakeTimers();
    const chess = new ChessService();
    for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['d1', 'h5'], ['b8', 'c6'], ['f1', 'c4'], ['g8', 'f6']] as const) {
      chess.makeMove(from, to);
    }
    const { store, engine, loop } = setup({ playerColor: 'b' }, chess);
    const done = loop.requestEngineMove();
    await vi.advanceTimersByTimeAsync(0);
    engine.calls[0]!.answer('h5f7');
    await done;
    await vi.advanceTimersByTimeAsync(499);
    expect(store.getState().gameOver).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(store.getState().gameOver).toBe('checkmate');
  });
});
