/**
 * Utility functions for state calculations.
 *
 * Centralizes commonly repeated calculations to avoid duplication.
 */

import type { UIPhase, PlayAs, PlayerColor } from './contracts';

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

/** Menu-related phases where the menu overlay is active. */
const MENU_PHASES: UIPhase[] = [
  'menu',
  'viewLog',
  'difficultySelect',
  'resetConfirm',
  'exitConfirm',
  'modeSelect',
  'bulletSetup',
  'academySelect',
  'coordinateDrill',
  'tacticsDrill',
  'mateDrill',
  'knightPathDrill',
  'pgnStudy',
];

/**
 * Check if the given phase is a menu-related phase.
 * Menu phases show overlay UI instead of the normal game display.
 */
export function isMenuPhase(phase: UIPhase): boolean {
  return MENU_PHASES.includes(phase);
}

/**
 * Check if the given phase is a confirmation phase.
 */
export function isConfirmPhase(phase: UIPhase): boolean {
  return phase === 'resetConfirm' || phase === 'exitConfirm';
}
