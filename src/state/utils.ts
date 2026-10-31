/**
 * Utility functions for state calculations.
 *
 * Centralizes commonly repeated calculations to avoid duplication.
 */

import type { PlayAs, PlayerColor, UIPhase } from './contracts';

/**
 * Every phase belongs to exactly one group. `satisfies` makes the compiler reject a new UIPhase
 * until it is classified here.
 */
const PHASE_GROUP = {
  idle: 'game',
  rowSelect: 'game',
  pieceSelect: 'game',
  destSelect: 'game',
  promotionSelect: 'game',
  menu: 'menu',
  viewLog: 'submenu',
  difficultySelect: 'submenu',
  customDifficultySelect: 'submenu',
  displayOptionsSelect: 'submenu',
  playAsSelect: 'submenu',
  resetConfirm: 'submenu',
  modeSelect: 'submenu',
  bulletSetup: 'submenu',
  academySelect: 'submenu',
  coordinateDrill: 'drill',
  tacticsDrill: 'drill',
  mateDrill: 'drill',
  knightPathDrill: 'drill',
  pgnStudy: 'drill',
} as const satisfies Record<UIPhase, 'game' | 'menu' | 'submenu' | 'drill'>;

type PhaseGroup = (typeof PHASE_GROUP)[UIPhase];

function phasesIn(...groups: PhaseGroup[]): ReadonlySet<UIPhase> {
  return new Set((Object.keys(PHASE_GROUP) as UIPhase[]).filter((p) => groups.includes(PHASE_GROUP[p])));
}

/** Playing a game: idle and the move-selection screens. */
export const GAME_PHASES = phasesIn('game');
/** Screens opened from the menu (including View Log), not the menu itself. */
export const SUBMENU_PHASES = phasesIn('submenu');
/** The menu and every screen opened from it. */
export const MENU_PHASES = phasesIn('menu', 'submenu');
/**
 * Where scrolling runs opposite to gameplay. View Log is the exception among menu screens: it
 * keeps the gameplay direction ('down' shows later moves).
 */
export const INVERTED_SCROLL_PHASES: ReadonlySet<UIPhase> = new Set([...MENU_PHASES].filter((p) => p !== 'viewLog'));

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
