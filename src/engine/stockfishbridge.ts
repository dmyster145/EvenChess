/**
 * StockfishBridge — Web Worker wrapper for Stockfish WASM.
 * Falls back to random moves if WASM is unavailable.
 */

import { Chess } from 'chess.js';
import type { EngineProfile } from '../state/contracts';

const MULTIPV_COUNT = 5;
/** A search that fails this many times in a row switches the session to random moves. */
const MAX_CONSECUTIVE_FAILURES = 3;
const WORKER_URL = '/stockfish/stockfish.wasm.js';

export type WorkerFactory = (url: string) => Worker;

export class StockfishBridge {
  private worker: Worker | null = null;
  private ready = false;
  private workerFailed = false;
  private consecutiveFailures = 0;
  /** Set after a timed-out search: its late `bestmove` must not answer the next search. */
  private discardNextBestmove = false;
  private pendingResolve: ((bestmove: string) => void) | null = null;
  private pendingAddVariety = false;
  private topMovesByMultipv: Record<number, string> = {};
  private boundOnBestMove = this.onBestMove.bind(this);
  private fallbackChess: Chess | null = null;

  constructor(private readonly createWorker: WorkerFactory = (url) => new Worker(url, { type: 'classic' })) {}

  async init(): Promise<void> {
    try {
      if (typeof WebAssembly !== 'object') {
        throw new Error('WebAssembly not supported');
      }
      this.worker = this.createWorker(WORKER_URL);
      await this.waitForReady();
      this.ready = true;
      console.log('[StockfishBridge] Engine ready (WASM).');
    } catch (err) {
      console.warn('[StockfishBridge] WASM init failed, using fallback mode:', err);
      this.worker?.terminate();
      this.worker = null;
      this.ready = false;
    }
  }

  async getBestMove(fen: string, profile: EngineProfile): Promise<string | null> {
    if (!this.worker || !this.ready || this.workerFailed) {
      return this.fallbackMove(fen, profile);
    }

    this.topMovesByMultipv = {};
    this.pendingAddVariety = profile.addVariety;

    const workerMove = await new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => {
        // Stop the overdue search; its eventual bestmove is stale and must be ignored.
        this.pendingResolve = null;
        this.discardNextBestmove = true;
        this.send('stop');
        resolve(null);
      }, profile.movetime + 2000);

      this.pendingResolve = (bestmove: string) => {
        clearTimeout(timeout);
        resolve(bestmove || null);
      };

      if (profile.addVariety) {
        this.send(`setoption name MultiPV value ${MULTIPV_COUNT}`);
      } else {
        this.send('setoption name MultiPV value 1');
      }
      this.send(`setoption name Skill Level value ${profile.skillLevel}`);
      this.send(`position fen ${fen}`);
      this.send(`go depth ${profile.depth} movetime ${profile.movetime}`);
    });

    if (workerMove) {
      this.consecutiveFailures = 0;
      return workerMove;
    }

    // A single slow or empty search is treated as transient: play a random move this turn and
    // try the engine again next time. Only repeated failures give up on it for the session.
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.workerFailed = true;
      console.warn(
        `[StockfishBridge] Stockfish failed ${MAX_CONSECUTIVE_FAILURES} searches in a row; using random ` +
        `moves for the rest of the session. Check that ${WORKER_URL} and its .wasm are served ` +
        '(the postinstall script copies them into public/stockfish/).',
      );
    } else {
      console.warn(
        `[StockfishBridge] Search returned no move (${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}); ` +
        'playing a random move this turn.',
      );
    }
    return this.fallbackMove(fen, profile);
  }

  stop(): void {
    this.send('stop');
  }

  destroy(): void {
    if (this.worker) {
      this.worker.removeEventListener('message', this.boundOnBestMove);
      this.send('quit');
      this.worker.terminate();
      this.worker = null;
      this.ready = false;
    }
    this.fallbackChess = null;
  }

  private send(msg: string): void {
    this.worker?.postMessage(msg);
  }

  private waitForReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('No worker'));
        return;
      }

      const cleanup = () => {
        clearTimeout(timeout);
        this.worker?.removeEventListener('message', onMessage);
        this.worker?.removeEventListener('error', onError);
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Stockfish init timeout'));
      }, 10_000);

      const onMessage = (event: MessageEvent) => {
        if (String(event.data).includes('uciok')) {
          cleanup();
          this.worker?.addEventListener('message', this.boundOnBestMove);
          resolve();
        }
      };
      // A missing or broken worker script fails immediately instead of waiting out the timeout.
      const onError = (event: Event) => {
        cleanup();
        reject(new Error(`Stockfish worker failed to load: ${(event as ErrorEvent).message ?? 'error'}`));
      };

      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', onError);
      this.send('uci');
    });
  }

  private onBestMove(event: MessageEvent): void {
    const line = String(event.data);

    if (line.startsWith('info ')) {
      if (this.pendingAddVariety && line.includes(' multipv ') && line.includes(' pv ')) {
        const multipvMatch = line.match(/ multipv (\d+) /);
        const pvIdx = line.indexOf(' pv ');
        if (multipvMatch && multipvMatch[1] != null && pvIdx !== -1) {
          const multipvNum = parseInt(multipvMatch[1], 10);
          const afterPv = line.slice(pvIdx + 4);
          const firstMove = afterPv.split(/\s/)[0]?.trim() ?? '';
          if (firstMove && firstMove !== '0000' && firstMove !== '(none)') {
            this.topMovesByMultipv[multipvNum] = firstMove;
          }
        }
      }
      return;
    }

    if (line.startsWith('bestmove')) {
      if (this.discardNextBestmove) {
        this.discardNextBestmove = false;
        return;
      }
      const parts = line.split(' ');
      const move = parts[1] ?? null;
      const isValidMove = move && move !== '0000' && move !== '(none)';
      if (this.pendingResolve) {
        if (this.pendingAddVariety) {
          const collected = Object.values(this.topMovesByMultipv);
          if (collected.length > 1) {
            const randomMove = collected[Math.floor(Math.random() * collected.length)]!;
            this.pendingResolve(randomMove);
          } else {
            this.pendingResolve(isValidMove ? move : '');
          }
        } else {
          this.pendingResolve(isValidMove ? move : '');
        }
        this.pendingResolve = null;
      }
    }
  }

  // Delay allows player move to render before engine response
  private async fallbackMove(fen: string, profile: EngineProfile): Promise<string | null> {
    const thinkTime = Math.min(profile.movetime, 300);
    await new Promise((r) => setTimeout(r, thinkTime));

    try {
      if (!this.fallbackChess) {
        this.fallbackChess = new Chess(fen);
      } else {
        this.fallbackChess.load(fen);
      }
      const moves = this.fallbackChess.moves({ verbose: true });
      if (moves.length === 0) return null;

      const idx = Math.floor(Math.random() * moves.length);
      const move = moves[idx]!;
      return `${move.from}${move.to}${move.promotion ?? ''}`;
    } catch {
      return null;
    }
  }
}
