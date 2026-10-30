import { buildInitialState, type GameState } from '../../src/state/contracts';
import { ChessService } from '../../src/chess/chessservice';

/**
 * A complete default GameState for tests, built by the app's own `buildInitialState` so every
 * required field is present. Fixtures spread their scenario-specific fields and overrides on top
 * of it, so adding a GameState field never silently leaves a test fixture incomplete.
 */
export function baseGameState(): GameState {
  return buildInitialState(new ChessService());
}
