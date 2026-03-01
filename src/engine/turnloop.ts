/**
 * TurnLoop — orchestrates player move → engine reply flow.
 */

import type { EngineProfile, CarouselMove, Action } from '../state/contracts';
import type { Store } from '../state/store';
import type { ChessService } from '../chess/chessservice';
import { StockfishBridge } from './stockfishbridge';
import { recordPerfDispatch, type PerfDispatchSource } from '../perf/dispatch-trace';

export class TurnLoop {
  private engine: StockfishBridge;
  private chess: ChessService;
  private store: Store;
  private profile: EngineProfile;
  private busy = false;
  private pendingTimeout: ReturnType<typeof setTimeout> | null = null;
  private requestSeq = 0;

  constructor(chess: ChessService, store: Store, profile: EngineProfile) {
    this.chess = chess;
    this.store = store;
    this.profile = profile;
    this.engine = new StockfishBridge();
  }

  async init(): Promise<void> {
    await this.engine.init();
  }

  setProfile(profile: EngineProfile): void {
    this.profile = profile;
  }

  private dispatch(action: Action, source: PerfDispatchSource): void {
    recordPerfDispatch(source, action);
    this.store.dispatch(action);
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
      this.dispatch({ type: 'ENGINE_ERROR' }, 'engine');
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
        this.dispatch({ type: 'PLAYER_MOVE_SAN', san }, 'player');
      }

      this.dispatchRefresh();

      const state = this.store.getState();
      if (state.mode === 'bullet' && state.timerActive && state.timers) {
        const playerColor = state.turn === 'b' ? 'w' : 'b';
        this.dispatch({ type: 'APPLY_INCREMENT', color: playerColor }, 'player');
      }

      if (this.chess.isGameOver()) {
        const reason = this.chess.getGameOverReason() ?? 'unknown';
        this.dispatch({ type: 'GAME_OVER', reason }, 'player');
        return;
      }

      this.dispatch({ type: 'ENGINE_THINKING' }, 'engine');

      let bestMoveUci: string | null = null;
      try {
        const fen = this.chess.getFen();
        bestMoveUci = await this.engine.getBestMove(fen, this.profile);
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

      this.dispatch({
        type: 'ENGINE_MOVE',
        uci: bestMoveUci,
        san: engineSan,
        ...this.chess.getStateSnapshot(),
      }, 'engine');

      const stateAfterEngine = this.store.getState();
      if (stateAfterEngine.mode === 'bullet' && stateAfterEngine.timerActive && stateAfterEngine.timers) {
        this.dispatch({ type: 'APPLY_INCREMENT', color: 'b' }, 'engine');
      }

      if (this.chess.isGameOver()) {
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
          this.dispatch({ type: 'GAME_OVER', reason }, 'engine');
        }, 500);
      }
    } finally {
      this.busy = false;
    }
  }

  private dispatchRefresh(): void {
    this.dispatch({
      type: 'REFRESH',
      ...this.chess.getStateSnapshot(),
    }, 'player');
  }

  private clearEngineThinking(): void {
    this.dispatch({ type: 'ENGINE_ERROR' }, 'engine');
    this.dispatchRefresh();
  }

  destroy(): void {
    this.requestSeq++;
    this.clearPendingGameOverTimeout();
    this.engine.destroy();
  }
}
