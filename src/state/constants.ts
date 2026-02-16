/**
 * Shared constants for state management.
 */

import type { MenuOption, DifficultyLevel, GameMode, DrillType } from './contracts';

// Menu options and labels are parallel arrays
export const MENU_OPTIONS: MenuOption[] = ['mode', 'boardMarkers', 'viewLog', 'difficulty', 'reset', 'exit'];
export const MENU_LABELS: readonly string[] = ['Mode', 'Board Markers', 'View Log', 'Difficulty', 'Reset', 'Exit'];
export const MENU_OPTION_COUNT = MENU_OPTIONS.length;

export const MENU_INDEX = {
  MODE: 0,
  BOARD_MARKERS: 1,
  VIEW_LOG: 2,
  DIFFICULTY: 3,
  RESET: 4,
  EXIT: 5,
} as const;

export const BOARD_MARKERS_OPTIONS: readonly ('on' | 'off')[] = ['on', 'off'];
export const BOARD_MARKERS_LABELS: readonly string[] = ['On', 'Off'];
export const BOARD_MARKERS_OPTION_COUNT = BOARD_MARKERS_OPTIONS.length;

export const MODE_OPTIONS: GameMode[] = ['play', 'bullet', 'academy'];
export const MODE_LABELS: readonly string[] = ['Play vs AI', 'Bullet Blitz', 'Academy'];
export const MODE_OPTION_COUNT = MODE_OPTIONS.length;

export const TIME_CONTROLS = [
  { label: '1+0', initialMs: 60000, incrementMs: 0 },
  { label: '1+5', initialMs: 60000, incrementMs: 5000 },
  { label: '3+0', initialMs: 180000, incrementMs: 0 },
  { label: '3+5', initialMs: 180000, incrementMs: 5000 },
  { label: '5+0', initialMs: 300000, incrementMs: 0 },
  { label: '5+5', initialMs: 300000, incrementMs: 5000 },
] as const;
export const TIME_CONTROL_COUNT = TIME_CONTROLS.length;

/** Promotion piece keys (chess.js): q, r, b, n. Order: Queen first. */
export const PROMOTION_PIECE_KEYS: readonly string[] = ['q', 'r', 'b', 'n'];
export const PROMOTION_PIECE_LABELS: readonly string[] = ['Queen', 'Rook', 'Bishop', 'Knight'];
export const PROMOTION_OPTION_COUNT = PROMOTION_PIECE_KEYS.length;

export const DRILL_OPTIONS: DrillType[] = ['coordinate', 'tactics', 'mate', 'knightPath', 'pgn'];
export const DRILL_LABELS: readonly string[] = [
  'Coordinates',
  'Tactics',
  'Checkmate',
  'Knight Path',
  'PGN Study',
];
export const DRILL_OPTION_COUNT = DRILL_OPTIONS.length;

export const DIFFICULTY_OPTIONS: DifficultyLevel[] = ['easy', 'casual', 'serious'];
export const DIFFICULTY_LABELS: readonly string[] = ['Easy', 'Casual', 'Serious'];
export const DIFFICULTY_OPTION_COUNT = DIFFICULTY_OPTIONS.length;

/** SDK text container limit is 2000 chars; 40 move pairs stays well under */
export const MAX_MOVES_DISPLAY = 40;
export const LOG_MAX_VISIBLE = 5;

export const DISPLAY_WIDTH = 576;

export const MAX_HISTORY_LENGTH = 200;

/**
 * Gesture disambiguation: if double-tap arrives within this time after entering
 * pieceSelect from a scroll, treat it as menu open intent (not back from pieceSelect).
 */
export const GESTURE_DISAMBIGUATION_MS = 200;
