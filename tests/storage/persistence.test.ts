/**
 * Unit tests for game persistence and settings storage.
 * Uses mocked localStorage for testing (default browser adapter).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  saveGame,
  loadGame,
  clearSave,
  saveDifficulty,
  loadDifficulty,
  saveBoardMarkers,
  loadBoardMarkers,
  saveBoardAlignment,
  loadBoardAlignment,
  saveBoardSize,
  loadBoardSize,
} from '../../src/storage/persistence';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    _getStore: () => store,
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });

describe('persistence', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('saveGame / loadGame', () => {
    it('saves and loads game state', async () => {
      await saveGame('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', ['e4'], 'b', 'casual');
      const loaded = await loadGame();
      expect(loaded).not.toBeNull();
      expect(loaded!.fen).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
      expect(loaded!.history).toEqual(['e4']);
      expect(loaded!.turn).toBe('b');
      expect(loaded!.difficulty).toBe('casual');
      expect(loaded!.savedAt).toBeDefined();
    });

    it('saves with default difficulty', async () => {
      await saveGame('fen', [], 'w');
      const loaded = await loadGame();
      expect(loaded!.difficulty).toBe('casual');
    });

    it('saves serious difficulty', async () => {
      await saveGame('fen', ['e4', 'e5'], 'w', 'serious');
      const loaded = await loadGame();
      expect(loaded!.difficulty).toBe('serious');
    });

    it('returns null when no saved game exists', async () => {
      expect(await loadGame()).toBeNull();
    });

    it('returns null for invalid JSON', async () => {
      localStorageMock.setItem('evenchess-save', 'not valid json');
      expect(await loadGame()).toBeNull();
    });

    it('returns null for missing fen', async () => {
      localStorageMock.setItem('evenchess-save', JSON.stringify({ history: ['e4'], turn: 'b' }));
      expect(await loadGame()).toBeNull();
    });

    it('returns null for history not array', async () => {
      localStorageMock.setItem('evenchess-save', JSON.stringify({ fen: 'x', history: 'bad', turn: 'b' }));
      expect(await loadGame()).toBeNull();
    });

    it('defaults difficulty to casual for older saves', async () => {
      localStorageMock.setItem('evenchess-save', JSON.stringify({ fen: 'f', history: [], turn: 'w', savedAt: 0 }));
      const loaded = await loadGame();
      expect(loaded!.difficulty).toBe('casual');
    });

    it('returns null for empty string (cleared save)', async () => {
      localStorageMock.setItem('evenchess-save', '');
      expect(await loadGame()).toBeNull();
    });
  });

  describe('clearSave', () => {
    it('clears saved game so loadGame returns null', async () => {
      await saveGame('fen', ['e4'], 'b', 'casual');
      await clearSave();
      expect(await loadGame()).toBeNull();
    });
  });

  describe('saveDifficulty / loadDifficulty', () => {
    it('returns casual when not set', async () => {
      expect(await loadDifficulty()).toBe('casual');
    });

    it('saves and loads serious', async () => {
      await saveDifficulty('serious');
      expect(await loadDifficulty()).toBe('serious');
    });

    it('saves and loads easy', async () => {
      await saveDifficulty('easy');
      expect(await loadDifficulty()).toBe('easy');
    });

    it('uses its own key independently of other settings', async () => {
      await saveDifficulty('serious');
      await saveBoardMarkers(false);
      expect(await loadDifficulty()).toBe('serious');
      expect(await loadBoardMarkers()).toBe(false);
    });
  });

  describe('saveBoardMarkers / loadBoardMarkers', () => {
    it('returns true when not set', async () => {
      expect(await loadBoardMarkers()).toBe(true);
    });

    it('saves and loads false', async () => {
      await saveBoardMarkers(false);
      expect(await loadBoardMarkers()).toBe(false);
    });

    it('saves and loads true', async () => {
      await saveBoardMarkers(true);
      expect(await loadBoardMarkers()).toBe(true);
    });
  });

  describe('saveBoardAlignment / loadBoardAlignment', () => {
    it('returns right when not set', async () => {
      expect(await loadBoardAlignment()).toBe('right');
    });

    it('saves and loads center', async () => {
      await saveBoardAlignment('center');
      expect(await loadBoardAlignment()).toBe('center');
    });

    it('saves and loads right', async () => {
      await saveBoardAlignment('right');
      expect(await loadBoardAlignment()).toBe('right');
    });
  });

  describe('saveBoardSize / loadBoardSize', () => {
    it('returns small when not set', async () => {
      expect(await loadBoardSize()).toBe('small');
    });

    it('saves and loads large', async () => {
      await saveBoardSize('large');
      expect(await loadBoardSize()).toBe('large');
    });

    it('saves and loads small', async () => {
      await saveBoardSize('small');
      expect(await loadBoardSize()).toBe('small');
    });
  });

  describe('roundtrip integration', () => {
    it('saves and loads game correctly', async () => {
      const fen = 'rnbqkbnr/pppppppp/8/8/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
      const history = ['e4', 'e5', 'Nf3'];
      await saveGame(fen, history, 'b', 'serious');
      const loaded = await loadGame();
      expect(loaded!.fen).toBe(fen);
      expect(loaded!.history).toEqual(history);
      expect(loaded!.turn).toBe('b');
      expect(loaded!.difficulty).toBe('serious');
    });

    it('all settings are independent — saving one does not affect others', async () => {
      await saveDifficulty('serious');
      await saveBoardMarkers(false);
      await saveBoardAlignment('center');
      await saveBoardSize('large');

      expect(await loadDifficulty()).toBe('serious');
      expect(await loadBoardMarkers()).toBe(false);
      expect(await loadBoardAlignment()).toBe('center');
      expect(await loadBoardSize()).toBe('large');
    });

    it('game and settings are independent', async () => {
      await saveGame('fen', ['e4'], 'b', 'casual');
      await saveDifficulty('serious');
      await saveBoardAlignment('center');

      const game = await loadGame();
      expect(game!.difficulty).toBe('casual');         // game difficulty is separate
      expect(await loadDifficulty()).toBe('serious');   // settings difficulty is separate
      expect(await loadBoardAlignment()).toBe('center');

      await clearSave();
      expect(await loadGame()).toBeNull();
      expect(await loadDifficulty()).toBe('serious');   // settings unaffected by clearSave
    });
  });
});
