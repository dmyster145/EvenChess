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
  saveBoardPosition,
  loadBoardPosition,
  savePlayAs,
  loadPlayAs,
  saveCustomSkillLevel,
  loadCustomSkillLevel,
  initPersistence,
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
  };
})();

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

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
      await saveGame(START_FEN, [], 'w');
      const loaded = await loadGame();
      expect(loaded!.difficulty).toBe('casual');
    });

    it('saves serious difficulty', async () => {
      await saveGame(START_FEN, ['e4', 'e5'], 'w', 'serious');
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
      localStorageMock.setItem('evenchess-save', JSON.stringify({ fen: START_FEN, history: [], turn: 'w', savedAt: 0 }));
      const loaded = await loadGame();
      expect(loaded!.difficulty).toBe('casual');
    });

    it('rejects a save without a readable side to move or with non-string history', async () => {
      localStorageMock.setItem('evenchess-save', JSON.stringify({ fen: 'nonsense', history: [], turn: 'w' }));
      expect(await loadGame()).toBeNull();
      localStorageMock.setItem('evenchess-save', JSON.stringify({ fen: START_FEN, history: ['e4', 5], turn: 'w' }));
      expect(await loadGame()).toBeNull();
    });

    it('takes the side to move from the FEN and replaces invalid fields with defaults', async () => {
      const blackToMove = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
      localStorageMock.setItem('evenchess-save', JSON.stringify({
        fen: blackToMove, history: ['e4'], turn: 'w', difficulty: 'hard', playerColor: 'black', customSkillLevel: 42,
      }));
      const loaded = await loadGame();
      expect(loaded!.turn).toBe('b');            // the FEN wins over the stored copy
      expect(loaded!.difficulty).toBe('casual');
      expect(loaded!.playerColor).toBeUndefined();
      expect(loaded!.customSkillLevel).toBe(9);  // clamped to the picker range
    });

    it('round-trips playerColor and customSkillLevel', async () => {
      await saveGame(START_FEN, [], 'w', 'custom', 'b', 7);
      const loaded = await loadGame();
      expect(loaded!.difficulty).toBe('custom');
      expect(loaded!.playerColor).toBe('b');
      expect(loaded!.customSkillLevel).toBe(7);
    });

    it('returns null for empty string (cleared save)', async () => {
      localStorageMock.setItem('evenchess-save', '');
      expect(await loadGame()).toBeNull();
    });
  });

  describe('clearSave', () => {
    it('clears saved game so loadGame returns null', async () => {
      await saveGame(START_FEN, ['e4'], 'b', 'casual');
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

    it('saves and loads custom', async () => {
      await saveDifficulty('custom');
      expect(await loadDifficulty()).toBe('custom');
    });

    it('falls back to casual for an unknown stored value', async () => {
      localStorageMock.setItem('evenchess-difficulty', 'grandmaster');
      expect(await loadDifficulty()).toBe('casual');
    });

    it('uses its own key independently of other settings', async () => {
      await saveDifficulty('serious');
      await saveBoardMarkers(false);
      expect(await loadDifficulty()).toBe('serious');
      expect(await loadBoardMarkers()).toBe(false);
    });
  });

  describe('saveCustomSkillLevel / loadCustomSkillLevel', () => {
    it('returns the default level 5 when not set', async () => {
      expect(await loadCustomSkillLevel()).toBe(5);
    });

    it('saves and loads a level', async () => {
      await saveCustomSkillLevel(2);
      expect(await loadCustomSkillLevel()).toBe(2);
    });

    it('clamps stored levels into the 0..9 picker range', async () => {
      localStorageMock.setItem('evenchess-custom-skill-level', '-3');
      expect(await loadCustomSkillLevel()).toBe(0);
      localStorageMock.setItem('evenchess-custom-skill-level', '42');
      expect(await loadCustomSkillLevel()).toBe(9);
    });

    it('returns the default level for a non-numeric stored value', async () => {
      localStorageMock.setItem('evenchess-custom-skill-level', 'hard');
      expect(await loadCustomSkillLevel()).toBe(5);
    });
  });

  describe('savePlayAs / loadPlayAs', () => {
    it('returns white when not set', async () => {
      expect(await loadPlayAs()).toBe('white');
    });

    it('saves and loads black', async () => {
      await savePlayAs('black');
      expect(await loadPlayAs()).toBe('black');
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

  describe('unknown stored setting values fall back to defaults', () => {
    it('board alignment and size accept only their known values', async () => {
      localStorageMock.setItem('evenchess-board-alignment', 'diagonal');
      localStorageMock.setItem('evenchess-board-size', 'medium');
      expect(await loadBoardAlignment()).toBe('right');
      expect(await loadBoardSize()).toBe('small');
    });

    it('Play As keeps a valid stored choice', async () => {
      localStorageMock.setItem('evenchess-play-as', 'random');
      expect(await loadPlayAs()).toBe('random');
    });

    it('Play As and Position accept only their known values', async () => {
      localStorageMock.setItem('evenchess-play-as', 'purple');
      localStorageMock.setItem('evenchess-board-position', 'sideways');
      expect(await loadPlayAs()).toBe('white');
      expect(await loadBoardPosition()).toBe('bottom');
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

  describe('saveBoardPosition / loadBoardPosition', () => {
    it('returns bottom when not set', async () => {
      expect(await loadBoardPosition()).toBe('bottom');
    });

    it('saves and loads top', async () => {
      await saveBoardPosition('top');
      expect(await loadBoardPosition()).toBe('top');
    });

    it('saves and loads bottom', async () => {
      await saveBoardPosition('bottom');
      expect(await loadBoardPosition()).toBe('bottom');
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
      await saveGame(START_FEN, ['e4'], 'b', 'casual');
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

  describe('initPersistence', () => {
    it('routes every read and write through the given adapter instead of localStorage', async () => {
      const store = new Map<string, string>();
      initPersistence(
        async (key) => store.get(key) ?? null,
        async (key, value) => { store.set(key, value); },
      );
      try {
        await saveBoardSize('large');
        await saveGame(START_FEN, ['e4'], 'w');
        expect(await loadBoardSize()).toBe('large');
        expect((await loadGame())!.history).toEqual(['e4']);
        expect([...store.keys()]).toEqual(['evenchess-board-size', 'evenchess-save']);
        expect(localStorageMock.setItem).not.toHaveBeenCalled();
        expect(localStorageMock.getItem).not.toHaveBeenCalled();
      } finally {
        // Module-level adapter: put a localStorage-backed one back for any later tests.
        initPersistence(
          async (key) => localStorage.getItem(key),
          async (key, value) => { localStorage.setItem(key, value); },
        );
      }
    });
  });
});
