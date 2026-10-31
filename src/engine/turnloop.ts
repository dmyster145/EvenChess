/**
 * TurnLoop — orchestrates player move → engine reply flow.
 */

import type { EngineProfile, CarouselMove } from '../state/contracts';
import type { Store } from '../state/store';
import type { ChessService } from '../chess/chessservice';
import { StockfishBridge } from './stockfishbridge';

/** The engine surface TurnLoop uses (StockfishBridge in the app; a fake in tests). */
export interface ChessEngine {
  init(): Promise<void>;
  getBestMove(fen: string, profile: EngineProfile): Promise<string | null>;
  stop(): void;
  destroy(): void;
}

export class TurnLoop {
  private engine: ChessEngine;
  private chess: ChessService;
  private store: Store;
  private profile: EngineProfile;
  private busy = false;
  private pendingTimeout: ReturnType<typeof setTimeout> | null = null;
  private requestSeq = 0;
  /** An engine move was requested while busy; run it once the current turn finishes. */
  private engineRequestQueued = false;

  constructor(chess: ChessService, store: Store, profile: EngineProfile, engine: ChessEngine = new StockfishBridge()) {
    this.chess = chess;
    this.store = store;
    this.profile = profile;
    this.engine = engine;
  }

  async init(): Promise<void> {
    await this.engine.init();
  }

  setProfile(profile: EngineProfile): void {
    this.profile = profile;
  }

  private clearPendingGameOverTimeout(): void {
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
  }

  private clearEngineThinkingIfActive(): void {
    const state = this.store.getState();
    if (!state.gameOver && state.engineThinking) {
      this.store.dispatch({ type: 'ENGINE_ERROR' });
    }
  }

  async onPlayerMoved(move: CarouselMove): Promise<void> {
    if (this.busy) {
      console.warn('[TurnLoop] Ignoring concurrent onPlayerMoved call');
      return;
    }
    this.clearPendingGameOverTimeout();
    const requestSeq = ++this.requestSeq;
    this.busy = true;

    try {
      const san = this.chess.makeMove(move.from, move.to, move.promotion);
      if (!san) {
        console.error('[TurnLoop] Player move was illegal:', move);
        return;
      }

      if (san !== move.san) {
        this.store.dispatch({ type: 'PLAYER_MOVE_SAN', san });
      }

      this.dispatchRefresh();

      const state = this.store.getState();
      if (state.mode === 'bullet' && state.timerActive && state.timers) {
        const playerColor = state.turn === 'b' ? 'w' : 'b';
        this.store.dispatch({ type: 'APPLY_INCREMENT', color: playerColor });
      }

      if (this.chess.isGameOver()) {
        const reason = this.chess.getGameOverReason() ?? 'unknown';
        this.store.dispatch({ type: 'GAME_OVER', reason });
        return;
      }

      await this.runEngineTurn(requestSeq);
    } finally {
      this.finishTurn();
    }
  }

  /**
   * Ask the engine to move at the current position: the opening move when the human plays Black,
   * or a resumed game on the engine's turn. Mirrors the engine half of onPlayerMoved.
   *
   * If a turn is still in flight (e.g. a new game started while the old game's search runs), that
   * search is invalidated and stopped, and this request runs as soon as it returns, rather than
   * being dropped and leaving the new game waiting on an engine move that never comes.
   */
  async requestEngineMove(): Promise<void> {
    if (this.busy) {
      this.engineRequestQueued = true;
      this.requestSeq++;
      this.engine.stop();
      return;
    }
    this.clearPendingGameOverTimeout();
    const requestSeq = ++this.requestSeq;
    this.busy = true;
    try {
      const state = this.store.getState();
      if (state.gameOver || this.chess.isGameOver()) return;
      await this.runEngineTurn(requestSeq);
    } finally {
      this.finishTurn();
    }
  }

  private finishTurn(): void {
    this.busy = false;
    if (this.engineRequestQueued) {
      this.engineRequestQueued = false;
      void this.requestEngineMove();
    }
  }

  /**
   * The profile for this search. In Bullet the engine must not think longer than its clock
   * allows: about 1/30 of its remaining time plus half the increment, and never longer than the
   * difficulty's own movetime.
   */
  private searchProfile(): EngineProfile {
    const s = this.store.getState();
    if (s.mode !== 'bullet' || !s.timers) return this.profile;
    const remaining = s.turn === 'w' ? s.timers.whiteMs : s.timers.blackMs;
    const budget = Math.max(100, Math.floor(remaining / 30 + s.timers.incrementMs / 2));
    return budget < this.profile.movetime ? { ...this.profile, movetime: budget } : this.profile;
  }

  private async runEngineTurn(requestSeq: number): Promise<void> {
    this.store.dispatch({ type: 'ENGINE_THINKING' });

      let bestMoveUci: string | null = null;
      try {
        const fen = this.chess.getFen();
        bestMoveUci = await this.engine.getBestMove(fen, this.searchProfile());
        if (requestSeq !== this.requestSeq) {
          return;
        }
        const stateAfterAwait = this.store.getState();
        if (stateAfterAwait.gameOver || this.chess.getFen() !== fen) {
          this.clearEngineThinkingIfActive();
          return;
        }
      } catch (err) {
        console.error('[TurnLoop] Engine error:', err);
        this.clearEngineThinking();
        return;
      }

      if (!bestMoveUci) {
        console.error('[TurnLoop] Engine returned no move.');
        this.clearEngineThinking();
        return;
      }

      let engineSan: string | null = null;
      try {
        if (requestSeq !== this.requestSeq) {
          return;
        }
        const stateBeforeApply = this.store.getState();
        if (stateBeforeApply.gameOver) {
          this.clearEngineThinkingIfActive();
          return;
        }
        engineSan = this.chess.makeMoveUci(bestMoveUci);
      } catch (err) {
        console.error('[TurnLoop] Error applying engine move:', err);
        this.clearEngineThinking();
        return;
      }

      if (!engineSan) {
        console.error('[TurnLoop] Engine move was illegal:', bestMoveUci);
        this.clearEngineThinking();
        return;
      }

      const endsGame = this.chess.isGameOver();
      const engineColor = this.chess.getTurn() === 'w' ? 'b' : 'w'; // the side that just moved
      this.store.dispatch({
        type: 'ENGINE_MOVE',
        uci: bestMoveUci,
        san: engineSan,
        ...this.chess.getStateSnapshot(),
        // Stops the bullet clock at once: GAME_OVER below is delayed 500ms so the move shows first,
        // and the human's clock must not run (and flag) during that pause.
        endsGame,
      });

      const stateAfterEngine = this.store.getState();
      if (!endsGame && stateAfterEngine.mode === 'bullet' && stateAfterEngine.timerActive && stateAfterEngine.timers) {
        this.store.dispatch({ type: 'APPLY_INCREMENT', color: engineColor });
      }

      if (endsGame) {
        const reason = this.chess.getGameOverReason() ?? 'unknown';
        const expectedFen = this.chess.getFen();
        const timeoutSeq = requestSeq;
        this.pendingTimeout = setTimeout(() => {
          this.pendingTimeout = null;
          if (timeoutSeq !== this.requestSeq) return;
          const current = this.store.getState();
          if (current.gameOver || current.fen !== expectedFen || this.chess.getFen() !== expectedFen) {
            return;
          }
          this.store.dispatch({ type: 'GAME_OVER', reason });
        }, 500);
      }
  }

  private dispatchRefresh(): void {
    this.store.dispatch({
      type: 'REFRESH',
      ...this.chess.getStateSnapshot(),
    });
  }

  private clearEngineThinking(): void {
    this.store.dispatch({ type: 'ENGINE_ERROR' });
    this.dispatchRefresh();
  }

  destroy(): void {
    this.requestSeq++;
    this.clearPendingGameOverTimeout();
    this.engine.destroy();
  }
}
