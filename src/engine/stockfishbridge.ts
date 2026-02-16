/**
 * StockfishBridge — Web Worker wrapper for Stockfish WASM.
 * Falls back to random moves if WASM is unavailable.
 */

import { Chess } from 'chess.js';
import type { EngineProfile } from '../state/contracts';

const MULTIPV_COUNT = 5;

export class StockfishBridge {
  private worker: Worker | null = null;
  private ready = false;
  private workerFailed = false;
  private pendingResolve: ((bestmove: string) => void) | null = null;
  private pendingAddVariety = false;
  private topMovesByMultipv: Record<number, string> = {};
  private boundOnBestMove = this.onBestMove.bind(this);
  private fallbackChess: Chess | null = null;

  async init(): Promise<void> {
    const workerUrl = '/stockfish/stockfish.wasm.js';
    try {
      if (typeof WebAssembly !== 'object') {
        throw new Error('WebAssembly not supported');
      }
      this.worker = new Worker(workerUrl, { type: 'classic' });
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

    this.topMovesByMultipv = {};
    this.pendingAddVariety = profile.addVariety;

    const workerMove = await new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingResolve = null;
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
      return workerMove;
    }

    this.workerFailed = true;
    console.warn(
      '[StockfishBridge] Engine returned no valid move (placeholder or missing Stockfish WASM). ' +
      'Using random moves; difficulty (Easy/Casual/Serious) has no effect. ' +
      'See stockfish-worker.js or Stockfish WASM docs to enable real engine strength.'
    );
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
