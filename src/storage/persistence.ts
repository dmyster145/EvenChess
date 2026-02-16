/**
 * Game state persistence using localStorage.
 */

import type { DifficultyLevel } from '../state/contracts';

export interface SavedGame {
  fen: string;
  history: string[];
  turn: 'w' | 'b';
  difficulty: DifficultyLevel;
  savedAt: number;
}

const STORAGE_KEY = 'evenchess-save';
const SETTINGS_KEY = 'evenchess-settings';

interface Settings {
  difficulty: DifficultyLevel;
  showBoardMarkers?: boolean;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { difficulty: 'casual', showBoardMarkers: true };
    const settings = JSON.parse(raw) as Settings;
    return {
      difficulty: settings.difficulty ?? 'casual',
      showBoardMarkers: settings.showBoardMarkers ?? true,
    };
  } catch (err) {
    console.error('[Persistence] Failed to load settings:', err);
    return { difficulty: 'casual', showBoardMarkers: true };
  }
}

function saveSettings(update: Partial<Settings>): void {
  try {
    const current = loadSettings();
    const merged: Settings = { ...current, ...update };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  } catch (err) {
    console.error('[Persistence] Failed to save settings:', err);
  }
}

export function saveDifficulty(difficulty: DifficultyLevel): void {
  saveSettings({ difficulty });
}

export function loadDifficulty(): DifficultyLevel {
  return loadSettings().difficulty;
}

export function saveBoardMarkers(showBoardMarkers: boolean): void {
  saveSettings({ showBoardMarkers });
}

export function loadBoardMarkers(): boolean {
  return loadSettings().showBoardMarkers ?? true;
}

export function saveGame(fen: string, history: string[], turn: 'w' | 'b', difficulty: DifficultyLevel = 'casual'): void {
  const saved: SavedGame = {
    fen,
    history,
    turn,
    difficulty,
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    console.log('[Persistence] Game saved');
  } catch (err) {
    console.error('[Persistence] Failed to save game:', err);
  }
}

export function loadGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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

export function clearSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    console.log('[Persistence] Save cleared');
  } catch (err) {
    console.error('[Persistence] Failed to clear save:', err);
  }
}

export function hasSavedGame(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch (err) {
    console.error('[Persistence] Failed to check for saved game:', err);
    return false;
  }
}
