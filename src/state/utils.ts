/**
 * Utility functions for state calculations.
 *
 * Centralizes commonly repeated calculations to avoid duplication.
 */

import type { PlayAs, PlayerColor } from './contracts';

/** Resolve the human's color for a new game from the Play As preference. */
export function resolvePlayerColor(playAs: PlayAs): PlayerColor {
  if (playAs === 'white') return 'w';
  if (playAs === 'black') return 'b';
  return Math.random() < 0.5 ? 'w' : 'b';
}

/**
 * Calculate the current move number from history length.
 * Move 1 = moves 0-1 in history (white's first, black's first).
 */
export function getMoveNumber(historyLength: number): number {
  return Math.floor(historyLength / 2) + 1;
}
