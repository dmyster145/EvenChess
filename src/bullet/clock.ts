/**
 * Bullet mode timer logic.
 *
 * Provides timer tick calculations and increment application for speed chess.
 */

import type { GameState } from '../state/contracts';

/**
 * Calculate the timer tick update for the active player.
 * Returns partial state with updated timers.
 */
export function tickTimer(state: GameState): Partial<GameState> {
  if (!state.timerActive || !state.timers) return {};

  const now = Date.now();
  const elapsed = state.lastTickTime ? now - state.lastTickTime : 0;
  const activeColor = state.turn;
  const key = activeColor === 'w' ? 'whiteMs' : 'blackMs';
  const newTime = Math.max(0, state.timers[key] - elapsed);

  return {
    timers: { ...state.timers, [key]: newTime },
    lastTickTime: now,
  };
}

/**
 * Apply the time increment to a player's clock after they make a move.
 */
export function applyIncrement(state: GameState, color: 'w' | 'b'): Partial<GameState> {
  if (!state.timers) return {};
  const key = color === 'w' ? 'whiteMs' : 'blackMs';
  return {
    timers: {
      ...state.timers,
      [key]: state.timers[key] + state.timers.incrementMs,
    },
  };
}

/**
 * Check if a player has run out of time.
 */
export function isTimeExpired(state: GameState, color: 'w' | 'b'): boolean {
  if (!state.timers) return false;
  const key = color === 'w' ? 'whiteMs' : 'blackMs';
  return state.timers[key] <= 0;
}

/**
 * Format milliseconds as MM:SS string.
 */
export function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}
