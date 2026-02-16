/**
 * StockfishBridge — Web Worker wrapper for Stockfish WASM.
 * Falls back to random moves if WASM is unavailable.
 */

import { Chess } from 'chess.js';
import type { EngineProfile } from '../state/contracts';

export class StockfishBridge {
  private worker: Worker | null = null;
  private ready = false;
  private workerFailed = false;
  private pendingResolve: ((bestmove: string) => void) | null = null;
  private boundOnBestMove = this.onBestMove.bind(this);
  private fallbackChess: Chess | null = null;

  async init(): Promise<void> {
    try {
      this.worker = new Worker(
        new URL('./stockfish-worker.js', import.meta.url),
        { type: 'classic' },
      );

      await this.waitForReady();
      this.ready = true;
      console.log('[StockfishBridge] Engine ready (WASM).');
    } catch (err) {
      console.warn('[StockfishBridge] WASM init failed, using fallback mode:', err);
      this.worker = null;
      this.ready = false;
    }
  }

  async getBestMove(fen: string, profile: EngineProfile): Promise<string | null> {
    if (!this.worker || !this.ready || this.workerFailed) {
      return this.fallbackMove(fen, profile);
    }

    const workerMove = await new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingResolve = null;
        resolve(null);
      }, profile.movetime + 2000);

      this.pendingResolve = (bestmove: string) => {
        clearTimeout(timeout);
        resolve(bestmove || null);
      };

      this.send(`setoption name Skill Level value ${profile.skillLevel}`);
      this.send(`position fen ${fen}`);
      this.send(`go depth ${profile.depth} movetime ${profile.movetime}`);
    });

    if (workerMove) {
      return workerMove;
    }

    this.workerFailed = true;
    console.log('[StockfishBridge] Worker non-functional, switching to fallback permanently.');
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

      const timeout = setTimeout(() => {
        reject(new Error('Stockfish init timeout'));
      }, 10_000);

      const onMessage = (event: MessageEvent) => {
        const line = String(event.data);
        if (line.includes('uciok') || line.includes('readyok')) {
          clearTimeout(timeout);
          this.worker?.removeEventListener('message', onMessage);
          this.worker?.addEventListener('message', this.boundOnBestMove);
          resolve();
        }
      };

      this.worker.addEventListener('message', onMessage);
      this.send('uci');
    });
  }

  private onBestMove(event: MessageEvent): void {
    const line = String(event.data);
    if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      const move = parts[1] ?? null;
      const isValidMove = move && move !== '0000' && move !== '(none)';
      if (this.pendingResolve) {
        this.pendingResolve(isValidMove ? move : '');
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
