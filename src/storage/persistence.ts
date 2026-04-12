/**
 * Game state persistence.
 *
 * Uses an async storage adapter so the same code works in both local dev
 * (browser localStorage) and the installed Even Hub app (SDK bridge storage).
 * Call initPersistence() with bridge storage before loading any data.
 *
 * Each setting is stored under its own key to avoid read-modify-write races.
 */

import type { DifficultyLevel, BoardAlignment, BoardSize } from '../state/contracts';

export interface SavedGame {
  fen: string;
  history: string[];
  turn: 'w' | 'b';
  difficulty: DifficultyLevel;
  savedAt: number;
}

const GAME_KEY         = 'evenchess-save';
const DIFFICULTY_KEY   = 'evenchess-difficulty';
const MARKERS_KEY      = 'evenchess-board-markers';
const ALIGNMENT_KEY    = 'evenchess-board-alignment';
const SIZE_KEY         = 'evenchess-board-size';

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

// --- Public API ---

export async function saveDifficulty(difficulty: DifficultyLevel): Promise<void> {
  await _set(DIFFICULTY_KEY, difficulty);
}

export async function loadDifficulty(): Promise<DifficultyLevel> {
  const value = await _get(DIFFICULTY_KEY);
  return (value as DifficultyLevel | null) ?? 'casual';
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
  return (value as BoardAlignment | null) ?? 'right';
}

export async function saveBoardSize(boardSize: BoardSize): Promise<void> {
  await _set(SIZE_KEY, boardSize);
}

export async function loadBoardSize(): Promise<BoardSize> {
  const value = await _get(SIZE_KEY);
  return (value as BoardSize | null) ?? 'small';
}

export async function saveGame(fen: string, history: string[], turn: 'w' | 'b', difficulty: DifficultyLevel = 'casual'): Promise<void> {
  const saved: SavedGame = { fen, history, turn, difficulty, savedAt: Date.now() };
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
    const parsed = JSON.parse(raw) as SavedGame;
    if (typeof parsed.fen !== 'string' || !Array.isArray(parsed.history)) {
      console.warn('[Persistence] Invalid save data, ignoring');
      return null;
    }
    if (!parsed.difficulty) {
      parsed.difficulty = 'casual';
    }
    return parsed;
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
