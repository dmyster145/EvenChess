/**
 * Shared constants for state management.
 */

import type { MenuOption, DisplayOption, DifficultyLevel, GameMode, DrillType, PlayAs } from './contracts';

/**
 * One menu's rows, in display order. Options, labels and indexes are all derived from a single
 * list so they can't drift apart.
 */
function optionTable<K extends string>(rows: readonly { key: K; label: string }[]) {
  return {
    keys: rows.map((r) => r.key) as readonly K[],
    labels: rows.map((r) => r.label) as readonly string[],
    index: Object.fromEntries(rows.map((r, i) => [r.key, i])) as Record<K, number>,
  };
}

const MENU = optionTable<MenuOption>([
  { key: 'playAs', label: 'Play As' },
  { key: 'mode', label: 'Mode' },
  { key: 'viewLog', label: 'View Log' },
  { key: 'difficulty', label: 'Difficulty' },
  { key: 'displayOptions', label: 'Display Options' },
  { key: 'reset', label: 'Reset' },
  { key: 'exit', label: 'Exit' },
]);
export const MENU_OPTIONS = MENU.keys;
export const MENU_LABELS = MENU.labels;
export const MENU_OPTION_COUNT = MENU_OPTIONS.length;
export const MENU_INDEX = MENU.index;

/** Display Options rows. Each is a binary toggle flipped in place by a tap (no sub-menu). */
const DISPLAY_OPTIONS = optionTable<DisplayOption>([
  { key: 'alignment', label: 'Alignment' },
  { key: 'size', label: 'Size' },
  { key: 'markers', label: 'Board Markers' },
  { key: 'position', label: 'Position' },
]);
export const DISPLAY_OPTIONS_OPTIONS = DISPLAY_OPTIONS.keys;
export const DISPLAY_OPTIONS_LABELS = DISPLAY_OPTIONS.labels;
export const DISPLAY_OPTIONS_OPTION_COUNT = DISPLAY_OPTIONS_OPTIONS.length;
export const DISPLAY_OPTIONS_INDEX = DISPLAY_OPTIONS.index;

const MODES = optionTable<GameMode>([
  { key: 'play', label: 'Play vs AI' },
  { key: 'bullet', label: 'Bullet Blitz' },
  { key: 'academy', label: 'Academy' },
]);
export const MODE_OPTIONS = MODES.keys;
export const MODE_LABELS = MODES.labels;
export const MODE_OPTION_COUNT = MODE_OPTIONS.length;
export const MODE_INDEX = MODES.index;

/** Rows of the reset confirmation screen. */
export const RESET_CONFIRM_INDEX = { confirm: 0, cancel: 1 } as const;

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
export const PROMOTION_OPTION_COUNT = PROMOTION_PIECE_KEYS.length;

const DRILLS = optionTable<DrillType>([
  { key: 'coordinate', label: 'Coordinates' },
  { key: 'tactics', label: 'Tactics' },
  { key: 'mate', label: 'Checkmate' },
  { key: 'knightPath', label: 'Knight Path' },
  { key: 'pgn', label: 'PGN Study' },
]);
export const DRILL_OPTIONS = DRILLS.keys;
export const DRILL_LABELS = DRILLS.labels;
export const DRILL_OPTION_COUNT = DRILL_OPTIONS.length;

const DIFFICULTIES = optionTable<DifficultyLevel>([
  { key: 'easy', label: 'Easy' },
  { key: 'casual', label: 'Casual' },
  { key: 'serious', label: 'Serious' },
  { key: 'custom', label: 'Custom' },
]);
export const DIFFICULTY_OPTIONS = DIFFICULTIES.keys;
export const DIFFICULTY_LABELS = DIFFICULTIES.labels;
export const DIFFICULTY_OPTION_COUNT = DIFFICULTY_OPTIONS.length;

const PLAY_AS = optionTable<PlayAs>([
  { key: 'white', label: 'White' },
  { key: 'black', label: 'Black' },
  { key: 'random', label: 'Random' },
]);
export const PLAY_AS_OPTIONS = PLAY_AS.keys;
export const PLAY_AS_LABELS = PLAY_AS.labels;
export const PLAY_AS_OPTION_COUNT = PLAY_AS_OPTIONS.length;

/** Move pairs shown at once in View Log; scrolling moves this window through the game. */
export const LOG_MAX_VISIBLE = 5;

export const DISPLAY_WIDTH = 576;
export const DISPLAY_HEIGHT = 288;

/**
 * Gesture disambiguation: a double-tap within this time of a rowSelect tap entering pieceSelect is
 * treated as one quick double-tap whose first half was read as that tap, so it opens the menu
 * instead of backing up to rowSelect (see handleDoubleTap 'pieceSelect').
 */
export const GESTURE_DISAMBIGUATION_MS = 200;
