/**
 * Unit tests for game persistence and settings storage.
 * Uses mocked localStorage for testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  saveGame,
  loadGame,
  clearSave,
  hasSavedGame,
  saveDifficulty,
  loadDifficulty,
  saveBoardMarkers,
  loadBoardMarkers,
} from '../../src/storage/persistence';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    // Helper to access the store directly for assertions
    _getStore: () => store,
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('persistence', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('saveGame', () => {
    it('saves game state to localStorage', () => {
      saveGame('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', ['e4'], 'b', 'casual');

      expect(localStorageMock.setItem).toHaveBeenCalled();
      const savedData = JSON.parse(localStorageMock._getStore()['evenchess-save']);
      expect(savedData.fen).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
      expect(savedData.history).toEqual(['e4']);
      expect(savedData.turn).toBe('b');
      expect(savedData.difficulty).toBe('casual');
      expect(savedData.savedAt).toBeDefined();
    });

    it('saves with default difficulty', () => {
      saveGame('fen', [], 'w');

      const savedData = JSON.parse(localStorageMock._getStore()['evenchess-save']);
      expect(savedData.difficulty).toBe('casual');
    });

    it('saves serious difficulty', () => {
      saveGame('fen', ['e4', 'e5'], 'w', 'serious');

      const savedData = JSON.parse(localStorageMock._getStore()['evenchess-save']);
      expect(savedData.difficulty).toBe('serious');
    });
  });

  describe('loadGame', () => {
    it('returns null when no saved game exists', () => {
      expect(loadGame()).toBeNull();
    });

    it('returns saved game data', () => {
      const saved = {
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        history: ['e4'],
        turn: 'b',
        difficulty: 'casual',
        savedAt: Date.now(),
      };
      localStorageMock.setItem('evenchess-save', JSON.stringify(saved));

      const loaded = loadGame();

      expect(loaded).not.toBeNull();
      expect(loaded!.fen).toBe(saved.fen);
      expect(loaded!.history).toEqual(['e4']);
      expect(loaded!.turn).toBe('b');
      expect(loaded!.difficulty).toBe('casual');
    });

    it('returns null for invalid JSON', () => {
      localStorageMock.setItem('evenchess-save', 'not valid json');

      expect(loadGame()).toBeNull();
    });

    it('returns null for invalid save structure (missing fen)', () => {
      localStorageMock.setItem('evenchess-save', JSON.stringify({
        history: ['e4'],
        turn: 'b',
      }));

      expect(loadGame()).toBeNull();
    });

    it('returns null for invalid save structure (history not array)', () => {
      localStorageMock.setItem('evenchess-save', JSON.stringify({
        fen: 'some-fen',
        history: 'not-an-array',
        turn: 'b',
      }));

      expect(loadGame()).toBeNull();
    });

    it('defaults difficulty to casual for older saves', () => {
      const saved = {
        fen: 'fen',
        history: [],
        turn: 'w',
        savedAt: Date.now(),
        // No difficulty field (older save format)
      };
      localStorageMock.setItem('evenchess-save', JSON.stringify(saved));

      const loaded = loadGame();

      expect(loaded!.difficulty).toBe('casual');
    });
  });

  describe('clearSave', () => {
    it('removes saved game from localStorage', () => {
      localStorageMock.setItem('evenchess-save', JSON.stringify({ fen: 'test' }));

      clearSave();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('evenchess-save');
      expect(localStorageMock._getStore()['evenchess-save']).toBeUndefined();
    });
  });

  describe('hasSavedGame', () => {
    it('returns false when no saved game exists', () => {
      expect(hasSavedGame()).toBe(false);
    });

    it('returns true when saved game exists', () => {
      localStorageMock.setItem('evenchess-save', JSON.stringify({ fen: 'test' }));

      expect(hasSavedGame()).toBe(true);
    });
  });

  describe('saveDifficulty', () => {
    it('saves difficulty to settings', () => {
      saveDifficulty('serious');

      const settings = JSON.parse(localStorageMock._getStore()['evenchess-settings']);
      expect(settings.difficulty).toBe('serious');
    });

    it('merges with existing settings', () => {
      localStorageMock.setItem('evenchess-settings', JSON.stringify({
        showBoardMarkers: false,
      }));

      saveDifficulty('serious');

      const settings = JSON.parse(localStorageMock._getStore()['evenchess-settings']);
      expect(settings.difficulty).toBe('serious');
      expect(settings.showBoardMarkers).toBe(false);
    });
  });

  describe('loadDifficulty', () => {
    it('returns casual when no settings exist', () => {
      expect(loadDifficulty()).toBe('casual');
    });

    it('returns saved difficulty', () => {
      localStorageMock.setItem('evenchess-settings', JSON.stringify({
        difficulty: 'serious',
      }));

      expect(loadDifficulty()).toBe('serious');
    });

    it('returns casual when difficulty not in settings', () => {
      localStorageMock.setItem('evenchess-settings', JSON.stringify({
        showBoardMarkers: true,
      }));

      expect(loadDifficulty()).toBe('casual');
    });
  });

  describe('saveBoardMarkers', () => {
    it('saves board markers setting to true', () => {
      saveBoardMarkers(true);

      const settings = JSON.parse(localStorageMock._getStore()['evenchess-settings']);
      expect(settings.showBoardMarkers).toBe(true);
    });

    it('saves board markers setting to false', () => {
      saveBoardMarkers(false);

      const settings = JSON.parse(localStorageMock._getStore()['evenchess-settings']);
      expect(settings.showBoardMarkers).toBe(false);
    });

    it('merges with existing settings', () => {
      localStorageMock.setItem('evenchess-settings', JSON.stringify({
        difficulty: 'serious',
      }));

      saveBoardMarkers(false);

      const settings = JSON.parse(localStorageMock._getStore()['evenchess-settings']);
      expect(settings.showBoardMarkers).toBe(false);
      expect(settings.difficulty).toBe('serious');
    });
  });

  describe('loadBoardMarkers', () => {
    it('returns true when no settings exist', () => {
      expect(loadBoardMarkers()).toBe(true);
    });

    it('returns saved value when false', () => {
      localStorageMock.setItem('evenchess-settings', JSON.stringify({
        showBoardMarkers: false,
      }));

      expect(loadBoardMarkers()).toBe(false);
    });

    it('returns saved value when true', () => {
      localStorageMock.setItem('evenchess-settings', JSON.stringify({
        showBoardMarkers: true,
      }));

      expect(loadBoardMarkers()).toBe(true);
    });

    it('returns true when not in settings', () => {
      localStorageMock.setItem('evenchess-settings', JSON.stringify({
        difficulty: 'casual',
      }));

      expect(loadBoardMarkers()).toBe(true);
    });
  });

  describe('roundtrip integration', () => {
    it('saves and loads game correctly', () => {
      const fen = 'rnbqkbnr/pppppppp/8/8/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
      const history = ['e4', 'e5', 'Nf3'];
      const turn = 'b' as const;
      const difficulty = 'serious' as const;

      saveGame(fen, history, turn, difficulty);
      const loaded = loadGame();

      expect(loaded).not.toBeNull();
      expect(loaded!.fen).toBe(fen);
      expect(loaded!.history).toEqual(history);
      expect(loaded!.turn).toBe(turn);
      expect(loaded!.difficulty).toBe(difficulty);
    });

    it('settings roundtrip correctly', () => {
      saveDifficulty('serious');
      saveBoardMarkers(false);

      expect(loadDifficulty()).toBe('serious');
      expect(loadBoardMarkers()).toBe(false);
    });

    it('game and settings are independent', () => {
      saveGame('fen', ['e4'], 'b', 'casual');
      saveDifficulty('serious');
      saveBoardMarkers(false);

      const game = loadGame();
      expect(game!.difficulty).toBe('casual'); // Game has its own difficulty

      expect(loadDifficulty()).toBe('serious'); // Settings has different difficulty
      expect(loadBoardMarkers()).toBe(false);

      clearSave();
      expect(loadGame()).toBeNull();
      expect(loadDifficulty()).toBe('serious'); // Settings unaffected
    });
  });
});
