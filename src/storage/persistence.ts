/**
 * Game state persistence.
 *
 * Uses an async storage adapter so the same code works in both local dev
 * (browser localStorage) and the installed Even Hub app (SDK bridge storage).
 * Call initPersistence() with bridge storage before loading any data.
 *
 * Each setting is stored under its own key to avoid read-modify-write races.
 */

import type { DifficultyLevel, BoardAlignment, BoardSize, BoardPosition, PlayAs, PlayerColor } from '../state/contracts';
import { CUSTOM_SKILL_LEVEL_DEFAULT, clampCustomSkillLevel } from '../state/contracts';
import { DIFFICULTY_OPTIONS, PLAY_AS_OPTIONS } from '../state/constants';

export interface SavedGame {
  fen: string;
  history: string[];
  turn: 'w' | 'b';
  difficulty: DifficultyLevel;
  /** Picker value (0..9) for Custom difficulty; absent on saves written before this field existed. */
  customSkillLevel?: number;
  /** Resolved human color for the saved game (so a restore keeps orientation/engine ownership). */
  playerColor?: PlayerColor;
  savedAt: number;
}

const GAME_KEY              = 'evenchess-save';
const DIFFICULTY_KEY        = 'evenchess-difficulty';
const CUSTOM_SKILL_KEY      = 'evenchess-custom-skill-level';
const MARKERS_KEY           = 'evenchess-board-markers';
const ALIGNMENT_KEY         = 'evenchess-board-alignment';
const SIZE_KEY              = 'evenchess-board-size';
const POSITION_KEY          = 'evenchess-board-position';
const PLAY_AS_KEY           = 'evenchess-play-as';

// --- Storage adapter ---

type StorageGetter = (key: string) => Promise<string | null>;
type StorageSetter = (key: string, value: string) => Promise<void>;

const browserGet: StorageGetter = async (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const browserSet: StorageSetter = async (key, value) => {
  try { localStorage.setItem(key, value); } catch (err) {
    console.error('[Persistence] localStorage.setItem failed:', err);
  }
};

let _get: StorageGetter = browserGet;
let _set: StorageSetter = browserSet;

export function initPersistence(get: StorageGetter, set: StorageSetter): void {
  _get = get;
  _set = set;
}

// --- Validation ---
// Everything read back is untrusted (older builds, hand edits, a partly written value), so each
// field is checked against its type and falls back to a default rather than entering state.


function asDifficulty(value: unknown): DifficultyLevel {
  return DIFFICULTY_OPTIONS.includes(value as DifficultyLevel) ? (value as DifficultyLevel) : 'casual';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Side to move, read from the FEN itself (the authority; a separate stored copy could disagree). */
function sideToMoveFromFen(fen: string): 'w' | 'b' | null {
  const side = fen.trim().split(/\s+/)[1];
  return side === 'w' || side === 'b' ? side : null;
}

// --- Public API ---

export async function saveDifficulty(difficulty: DifficultyLevel): Promise<void> {
  await _set(DIFFICULTY_KEY, difficulty);
}

export async function loadDifficulty(): Promise<DifficultyLevel> {
  return asDifficulty(await _get(DIFFICULTY_KEY));
}

export async function saveCustomSkillLevel(level: number): Promise<void> {
  await _set(CUSTOM_SKILL_KEY, String(level));
}

export async function loadCustomSkillLevel(): Promise<number> {
  const raw = await _get(CUSTOM_SKILL_KEY);
  if (raw == null) return CUSTOM_SKILL_LEVEL_DEFAULT;
  return clampCustomSkillLevel(Number.parseInt(raw, 10));
}

export async function saveBoardMarkers(showBoardMarkers: boolean): Promise<void> {
  await _set(MARKERS_KEY, showBoardMarkers ? '1' : '0');
}

export async function loadBoardMarkers(): Promise<boolean> {
  const value = await _get(MARKERS_KEY);
  return value === null ? true : value !== '0';
}

export async function saveBoardAlignment(boardAlignment: BoardAlignment): Promise<void> {
  await _set(ALIGNMENT_KEY, boardAlignment);
}

export async function loadBoardAlignment(): Promise<BoardAlignment> {
  const value = await _get(ALIGNMENT_KEY);
  return value === 'center' ? 'center' : 'right';
}

export async function saveBoardSize(boardSize: BoardSize): Promise<void> {
  await _set(SIZE_KEY, boardSize);
}

export async function loadBoardSize(): Promise<BoardSize> {
  const value = await _get(SIZE_KEY);
  return value === 'large' ? 'large' : 'small';
}

export async function saveBoardPosition(boardPosition: BoardPosition): Promise<void> {
  await _set(POSITION_KEY, boardPosition);
}

export async function loadBoardPosition(): Promise<BoardPosition> {
  const value = await _get(POSITION_KEY);
  return value === 'top' ? 'top' : 'bottom';
}

export async function savePlayAs(playAs: PlayAs): Promise<void> {
  await _set(PLAY_AS_KEY, playAs);
}

export async function loadPlayAs(): Promise<PlayAs> {
  const value = await _get(PLAY_AS_KEY);
  return PLAY_AS_OPTIONS.includes(value as PlayAs) ? (value as PlayAs) : 'white';
}

export async function saveGame(
  fen: string,
  history: string[],
  turn: 'w' | 'b',
  difficulty: DifficultyLevel = 'casual',
  playerColor: PlayerColor = 'w',
  customSkillLevel?: number,
): Promise<void> {
  const saved: SavedGame = { fen, history, turn, difficulty, playerColor, customSkillLevel, savedAt: Date.now() };
  try {
    await _set(GAME_KEY, JSON.stringify(saved));
    console.log('[Persistence] Game saved');
  } catch (err) {
    console.error('[Persistence] Failed to save game:', err);
  }
}

export async function loadGame(): Promise<SavedGame | null> {
  try {
    const raw = await _get(GAME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    const fen = parsed?.fen;
    const turn = typeof fen === 'string' ? sideToMoveFromFen(fen) : null;
    if (!parsed || typeof fen !== 'string' || !turn || !isStringArray(parsed.history)) {
      console.warn('[Persistence] Invalid save data, ignoring');
      return null;
    }
    return {
      fen,
      history: parsed.history,
      turn,
      difficulty: asDifficulty(parsed.difficulty),
      customSkillLevel: typeof parsed.customSkillLevel === 'number' ? clampCustomSkillLevel(parsed.customSkillLevel) : undefined,
      playerColor: parsed.playerColor === 'w' || parsed.playerColor === 'b' ? parsed.playerColor : undefined,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch (err) {
    console.error('[Persistence] Failed to load game:', err);
    return null;
  }
}

export async function clearSave(): Promise<void> {
  try {
    // SDK bridge has no removeItem; empty string is treated as "no save" by loadGame.
    await _set(GAME_KEY, '');
    console.log('[Persistence] Save cleared');
  } catch (err) {
    console.error('[Persistence] Failed to clear save:', err);
  }
}
