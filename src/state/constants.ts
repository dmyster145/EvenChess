/**
 * Shared constants for state management.
 */

import type { MenuOption, DifficultyLevel, GameMode, DrillType } from './contracts';

// Menu options and labels are parallel arrays
export const MENU_OPTIONS: MenuOption[] = ['playAs', 'mode', 'boardMarkers', 'viewLog', 'difficulty', 'displayOptions', 'reset', 'exit'];
export const MENU_LABELS: readonly string[] = ['Play As', 'Mode', 'Board Markers', 'View Log', 'Difficulty', 'Display Options', 'Reset', 'Exit Menu'];
export const MENU_OPTION_COUNT = MENU_OPTIONS.length;

export const MENU_INDEX = {
  PLAY_AS: 0,
  MODE: 1,
  BOARD_MARKERS: 2,
  VIEW_LOG: 3,
  DIFFICULTY: 4,
  DISPLAY_OPTIONS: 5,
  RESET: 6,
  EXIT: 7,
} as const;

export const DISPLAY_OPTIONS_OPTIONS: readonly string[] = ['alignment', 'size'];
export const DISPLAY_OPTIONS_LABELS: readonly string[] = ['Alignment', 'Size'];
export const DISPLAY_OPTIONS_OPTION_COUNT = DISPLAY_OPTIONS_OPTIONS.length;

export const BOARD_ALIGNMENT_OPTIONS: readonly ('center' | 'right')[] = ['center', 'right'];
export const BOARD_ALIGNMENT_LABELS: readonly string[] = ['Center', 'Right'];
export const BOARD_ALIGNMENT_OPTION_COUNT = BOARD_ALIGNMENT_OPTIONS.length;

export const BOARD_SIZE_OPTIONS: readonly ('small' | 'large')[] = ['small', 'large'];
export const BOARD_SIZE_LABELS: readonly string[] = ['Small', 'Large'];
export const BOARD_SIZE_OPTION_COUNT = BOARD_SIZE_OPTIONS.length;

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

export const DIFFICULTY_OPTIONS: DifficultyLevel[] = ['easy', 'casual', 'serious', 'custom'];
export const DIFFICULTY_LABELS: readonly string[] = ['Easy', 'Casual', 'Serious', 'Custom'];
export const DIFFICULTY_OPTION_COUNT = DIFFICULTY_OPTIONS.length;

export const PLAY_AS_OPTIONS: readonly ('white' | 'black' | 'random')[] = ['white', 'black', 'random'];
export const PLAY_AS_LABELS: readonly string[] = ['White', 'Black', 'Random'];
export const PLAY_AS_OPTION_COUNT = PLAY_AS_OPTIONS.length;

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
