/**
 * TurnLoop — orchestrates player move → engine reply flow.
 */

import type { EngineProfile, CarouselMove } from '../state/contracts';
import type { Store } from '../state/store';
import type { ChessService } from '../chess/chessservice';
import { StockfishBridge } from './stockfishbridge';

export class TurnLoop {
  private engine: StockfishBridge;
  private chess: ChessService;
  private store: Store;
  private profile: EngineProfile;
  private busy = false;
  private pendingTimeout: ReturnType<typeof setTimeout> | null = null;

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

  async onPlayerMoved(move: CarouselMove): Promise<void> {
    if (this.busy) {
      console.warn('[TurnLoop] Ignoring concurrent onPlayerMoved call');
      return;
    }
    this.busy = true;

    try {
      const san = this.chess.makeMove(move.from, move.to, move.promotion);
      if (!san) {
        console.error('[TurnLoop] Player move was illegal:', move);
        return;
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

      this.store.dispatch({ type: 'ENGINE_THINKING' });

      let bestMoveUci: string | null = null;
      try {
        const fen = this.chess.getFen();
        bestMoveUci = await this.engine.getBestMove(fen, this.profile);
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

      this.store.dispatch({
        type: 'ENGINE_MOVE',
        uci: bestMoveUci,
        san: engineSan,
        ...this.chess.getStateSnapshot(),
      });

      const stateAfterEngine = this.store.getState();
      if (stateAfterEngine.mode === 'bullet' && stateAfterEngine.timerActive && stateAfterEngine.timers) {
        this.store.dispatch({ type: 'APPLY_INCREMENT', color: 'b' });
      }

      if (this.chess.isGameOver()) {
        const reason = this.chess.getGameOverReason() ?? 'unknown';
        this.pendingTimeout = setTimeout(() => {
          this.pendingTimeout = null;
          this.store.dispatch({ type: 'GAME_OVER', reason });
        }, 500);
      }
    } finally {
      this.busy = false;
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
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    this.engine.destroy();
  }
}
