import { describe, it, expect, vi, afterEach } from 'vitest';
import { StockfishBridge } from '../../src/engine/stockfishbridge';
import { CASUAL, EASY } from '../../src/engine/profiles';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const UCI_MOVE_REGEX = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** A scripted stand-in for the Stockfish Web Worker. */
class FakeWorker extends EventTarget {
  posted: string[] = [];
  terminated = false;
  /** Reply to 'uci' with 'uciok' (a working engine). */
  answerUci = true;
  /** Reply to 'go' with this bestmove; null = never reply (a hung search). */
  bestmove: string | null = 'e2e4';
  /** `info` lines sent in reply to 'go', before the bestmove. */
  info: string[] = [];

  postMessage(msg: string): void {
    this.posted.push(msg);
    if (msg === 'uci' && this.answerUci) this.emit('uciok');
    if (msg.startsWith('go') && this.bestmove) {
      for (const line of this.info) this.emit(line);
      this.emit(`bestmove ${this.bestmove}`);
    }
  }
  emit(line: string): void {
    queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: line })));
  }
  terminate(): void { this.terminated = true; }
  goCount(): number { return this.posted.filter((m) => m.startsWith('go')).length; }
}

function bridgeWith(worker: FakeWorker): StockfishBridge {
  return new StockfishBridge(() => worker as unknown as Worker);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('StockfishBridge', () => {
  describe('fallback when worker not used', () => {
    it('returns a valid UCI move from fallback when init() was not called', async () => {
      vi.useFakeTimers();
      const bridge = new StockfishBridge();
      // Do not call init() — worker stays null, so getBestMove uses fallback.
      const pending = bridge.getBestMove(STARTING_FEN, CASUAL);
      await vi.advanceTimersByTimeAsync(300); // the fallback's short "thinking" pause
      const move = await pending;
      bridge.destroy();

      expect(move).toMatch(UCI_MOVE_REGEX);
    });
  });

  it('uses the worker\'s bestmove once ready', async () => {
    const worker = new FakeWorker();
    const bridge = bridgeWith(worker);
    await bridge.init();
    expect(await bridge.getBestMove(STARTING_FEN, CASUAL)).toBe('e2e4');
  });

  it('a worker that fails to load is terminated and rejected at once, not after the 10s timeout', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    worker.answerUci = false;
    const bridge = bridgeWith(worker);
    const init = bridge.init();
    worker.dispatchEvent(new Event('error'));
    await init; // resolves without advancing the 10s timer
    expect(worker.terminated).toBe(true);
    const move = bridge.getBestMove(STARTING_FEN, CASUAL);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await move).toMatch(UCI_MOVE_REGEX); // fallback
    expect(worker.goCount()).toBe(0);
  });

  it('one timed-out search plays a fallback move but keeps using the engine next time', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const bridge = bridgeWith(worker);
    const init = bridge.init();
    await vi.advanceTimersByTimeAsync(0);
    await init;

    worker.bestmove = null; // hung search
    const first = bridge.getBestMove(STARTING_FEN, CASUAL);
    await vi.advanceTimersByTimeAsync(CASUAL.movetime + 2000 + 1000);
    expect(await first).toMatch(UCI_MOVE_REGEX);
    expect(worker.posted).toContain('stop');

    worker.bestmove = 'd2d4';
    worker.emit('bestmove g1f3'); // the stale reply to the stopped search
    const second = bridge.getBestMove(STARTING_FEN, CASUAL);
    await vi.advanceTimersByTimeAsync(0);
    expect(await second).toBe('d2d4'); // not the stale g1f3
    expect(worker.goCount()).toBe(2);
  });

  it('three failed searches in a row switch the session to fallback moves', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const bridge = bridgeWith(worker);
    const init = bridge.init();
    await vi.advanceTimersByTimeAsync(0);
    await init;

    worker.bestmove = '(none)';
    for (let i = 0; i < 3; i++) {
      const m = bridge.getBestMove(STARTING_FEN, CASUAL);
      await vi.advanceTimersByTimeAsync(1000);
      await m;
    }
    expect(worker.goCount()).toBe(3);
    worker.bestmove = 'e2e4';
    const after = bridge.getBestMove(STARTING_FEN, CASUAL);
    await vi.advanceTimersByTimeAsync(1000);
    await after;
    expect(worker.goCount()).toBe(3); // no longer asks the engine
  });

  describe('parsing the worker\'s replies', () => {
    async function readyBridge(worker: FakeWorker): Promise<StockfishBridge> {
      vi.useFakeTimers();
      const bridge = bridgeWith(worker);
      const init = bridge.init();
      await vi.advanceTimersByTimeAsync(0);
      await init;
      return bridge;
    }
    const MULTIPV_INFO = [
      'info depth 6 seldepth 8 multipv 1 score cp 30 nodes 900 pv e2e4 e7e5 g1f3',
      'info depth 6 seldepth 8 multipv 2 score cp 25 nodes 900 pv d2d4 d7d5',
      'info depth 6 seldepth 8 multipv 3 score cp 20 nodes 900 pv g1f3 g8f6',
    ];

    it('with addVariety, asks for 5 lines and plays a random one of the collected first moves', async () => {
      const worker = new FakeWorker();
      worker.info = MULTIPV_INFO;
      const bridge = await readyBridge(worker);
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.5); // index 1 of 3 → multipv 2
      try {
        const move = bridge.getBestMove(STARTING_FEN, EASY);
        await vi.advanceTimersByTimeAsync(0);
        expect(await move).toBe('d2d4');
      } finally {
        random.mockRestore();
      }
      expect(worker.posted).toContain('setoption name MultiPV value 5');
    });

    it('without addVariety, plays the bestmove and ignores multipv info lines', async () => {
      const worker = new FakeWorker();
      worker.info = MULTIPV_INFO;
      worker.bestmove = 'g1f3';
      const bridge = await readyBridge(worker);
      const move = bridge.getBestMove(STARTING_FEN, CASUAL);
      await vi.advanceTimersByTimeAsync(0);
      expect(await move).toBe('g1f3');
      expect(worker.posted).toContain('setoption name MultiPV value 1');
    });

    it('sends the search as setoption, position and go lines with the profile\'s values', async () => {
      const worker = new FakeWorker();
      const bridge = await readyBridge(worker);
      const move = bridge.getBestMove(STARTING_FEN, CASUAL);
      await vi.advanceTimersByTimeAsync(0);
      await move;
      expect(worker.posted.slice(1)).toEqual([
        'setoption name MultiPV value 1',
        `setoption name Skill Level value ${CASUAL.skillLevel}`,
        `position fen ${STARTING_FEN}`,
        `go depth ${CASUAL.depth} movetime ${CASUAL.movetime}`,
      ]);
    });

    it('treats "bestmove 0000" as no move and plays a legal fallback move instead', async () => {
      const worker = new FakeWorker();
      worker.bestmove = '0000';
      const bridge = await readyBridge(worker);
      const move = bridge.getBestMove(STARTING_FEN, CASUAL);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await move).toMatch(UCI_MOVE_REGEX);
      expect(worker.goCount()).toBe(1);
    });
  });
});
