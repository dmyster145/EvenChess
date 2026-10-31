import { describe, it, expect, beforeEach } from 'vitest';
import { loadInitialAppState, setupTextOnlyStartup, upgradeToFullLayout } from '../../src/app/init';
import {
  initPersistence,
  saveGame,
  loadGame,
  saveDifficulty,
  saveCustomSkillLevel,
  saveBoardMarkers,
  saveBoardAlignment,
  saveBoardSize,
  saveBoardPosition,
  savePlayAs,
} from '../../src/storage/persistence';
import { ChessService } from '../../src/chess/chessservice';
import { createStore } from '../../src/state/store';
import type { EvenHubBridge } from '../../src/evenhub/bridge';
import { baseGameState } from '../helpers/game-state';

const START_FEN = new ChessService().getFen();
// Black to move with no legal moves and not in check.
const STALEMATE_FEN = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
// 1. f3 e5 2. g4 Qh4# — White is checkmated.
const FOOLS_MATE_FEN = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';

describe('loadInitialAppState (saved game)', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    initPersistence(
      async (key) => storage.get(key) ?? null,
      async (key, value) => { storage.set(key, value); },
    );
  });

  it('resumes a game in progress', async () => {
    const chess = new ChessService();
    chess.makeMove('e2', 'e4');
    await saveGame(chess.getFen(), ['e4'], 'b');
    const state = await loadInitialAppState(new ChessService());
    expect(state.history).toEqual(['e4']);
    expect(state.turn).toBe('b');
  });

  it('starts a new game instead of resuming a stalemate', async () => {
    await saveGame(STALEMATE_FEN, ['e4', 'e5'], 'b');
    const chess = new ChessService();
    const state = await loadInitialAppState(chess);
    expect(state.history).toEqual([]);
    expect(state.fen).toBe(START_FEN);
    expect(state.pieces.length).toBeGreaterThan(0);
    await Promise.resolve();
    expect(await loadGame()).toBeNull(); // the dead save is cleared
  });

  it('starts a new game instead of showing a saved log over the wrong board', async () => {
    await saveGame('not a fen', ['e4', 'e5', 'Nf3'], 'b');
    const state = await loadInitialAppState(new ChessService());
    expect(state.history).toEqual([]);
    expect(state.fen).toBe(START_FEN);
  });

  it('starts a new game instead of resuming a checkmate', async () => {
    await saveGame(FOOLS_MATE_FEN, ['f3', 'e5', 'g4', 'Qh4#'], 'w');
    const chess = new ChessService();
    const state = await loadInitialAppState(chess);
    expect(state.history).toEqual([]);
    expect(state.fen).toBe(START_FEN);
    expect(chess.getFen()).toBe(START_FEN);
    await Promise.resolve();
    expect(await loadGame()).toBeNull();
  });

  it('a resumed game keeps its own difficulty, custom level and side, with the engine to move', async () => {
    // After 1. e4 e5 it is White's turn, and the saved human side is Black, so the engine moves next.
    const chess = new ChessService();
    chess.makeMove('e2', 'e4');
    chess.makeMove('e7', 'e5');
    await saveDifficulty('easy');
    await saveCustomSkillLevel(2);
    await saveGame(chess.getFen(), ['e4', 'e5'], 'w', 'custom', 'b', 8);
    const state = await loadInitialAppState(new ChessService());
    expect(state.fen).toBe(chess.getFen());
    expect(state.turn).toBe('w');
    expect(state.playerColor).toBe('b');
    expect(state.difficulty).toBe('custom');
    expect(state.customSkillLevel).toBe(8);
    expect(state.hasUnsavedChanges).toBe(false);
  });

  it('a save from before per-game custom levels falls back to the stored custom level', async () => {
    await saveCustomSkillLevel(3);
    await saveGame(new ChessService().getFen(), [], 'w', 'custom', 'w');
    const state = await loadInitialAppState(new ChessService());
    expect(state.customSkillLevel).toBe(3);
  });
});

describe('loadInitialAppState (settings)', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    initPersistence(
      async (key) => storage.get(key) ?? null,
      async (key, value) => { storage.set(key, value); },
    );
  });

  it('applies every stored setting to a fresh start', async () => {
    await saveDifficulty('serious');
    await saveCustomSkillLevel(6);
    await saveBoardMarkers(false);
    await saveBoardAlignment('center');
    await saveBoardSize('large');
    await saveBoardPosition('top');
    await savePlayAs('black');
    const state = await loadInitialAppState(new ChessService());
    expect({
      difficulty: state.difficulty,
      customSkillLevel: state.customSkillLevel,
      showBoardMarkers: state.showBoardMarkers,
      boardAlignment: state.boardAlignment,
      boardSize: state.boardSize,
      boardPosition: state.boardPosition,
      playAs: state.playAs,
      playerColor: state.playerColor,
    }).toEqual({
      difficulty: 'serious',
      customSkillLevel: 6,
      showBoardMarkers: false,
      boardAlignment: 'center',
      boardSize: 'large',
      boardPosition: 'top',
      playAs: 'black',
      playerColor: 'b',
    });
    expect(state.history).toEqual([]);
  });
});

/** A bridge that records page and text calls; setupPage/updatePage results are set per test. */
function makeStartupBridge(results: { setupPage: boolean; updatePage: boolean }) {
  const calls: string[] = [];
  const bridge = {
    setupPage: async () => { calls.push('setupPage'); return results.setupPage; },
    updatePage: async () => { calls.push('updatePage'); return results.updatePage; },
    updateText: async () => { calls.push('updateText'); return true; },
    updateImage: () => { calls.push('updateImage'); },
  } as unknown as EvenHubBridge;
  return { bridge, calls };
}

describe('setupTextOnlyStartup', () => {
  it('creates the startup page and sends the first text and brand strip', async () => {
    const { bridge, calls } = makeStartupBridge({ setupPage: true, updatePage: true });
    const ok = await setupTextOnlyStartup(bridge, createStore(baseGameState()));
    expect(ok).toBe(true);
    expect(calls).toEqual(['setupPage', 'updateText', 'updateImage']);
  });

  it('falls back to rebuilding the page when the host already has a startup page', async () => {
    const { bridge, calls } = makeStartupBridge({ setupPage: false, updatePage: true });
    const ok = await setupTextOnlyStartup(bridge, createStore(baseGameState()));
    expect(ok).toBe(true);
    expect(calls).toEqual(['setupPage', 'updatePage', 'updateText', 'updateImage']);
  });

  it('returns false and sends nothing else when both page calls fail', async () => {
    const { bridge, calls } = makeStartupBridge({ setupPage: false, updatePage: false });
    const ok = await setupTextOnlyStartup(bridge, createStore(baseGameState()));
    expect(ok).toBe(false);
    expect(calls).toEqual(['setupPage', 'updatePage']);
  });
});

describe('upgradeToFullLayout', () => {
  function setupUpgrade(updatePageOk: boolean, initiallyActive = false) {
    const { bridge, calls } = makeStartupBridge({ setupPage: true, updatePage: updatePageOk });
    let active = initiallyActive;
    const flushNowArgs: unknown[] = [];
    const opts = {
      bridge,
      store: createStore(baseGameState()),
      flush: {
        schedule: () => {},
        cancel: () => {},
        setForceFullRefresh: () => { calls.push('flush.setForceFullRefresh'); },
        flushNow: async (o?: { force?: boolean }) => { flushNowArgs.push(o); },
      },
      branding: {
        schedule: () => {},
        cancel: () => {},
        forceNextRefresh: () => {},
        syncNow: () => { calls.push('branding.syncNow'); },
      },
      imageContainersActive: () => active,
      setImageContainersActive: (v: boolean) => { active = v; },
    };
    return { opts, calls, flushNowArgs, isActive: () => active };
  }

  it('rebuilds the page, marks the board containers active and force-flushes once', async () => {
    const { opts, calls, flushNowArgs, isActive } = setupUpgrade(true);
    await upgradeToFullLayout(opts);
    expect(isActive()).toBe(true);
    expect(calls).toEqual(['updatePage', 'flush.setForceFullRefresh', 'branding.syncNow']);
    expect(flushNowArgs).toEqual([{ force: true }]);
  });

  it('does nothing when the full layout is already active', async () => {
    const { opts, calls, flushNowArgs } = setupUpgrade(true, true);
    await upgradeToFullLayout(opts);
    expect(calls).toEqual([]);
    expect(flushNowArgs).toEqual([]);
  });

  it('stays on the text-only layout when the rebuild is rejected', async () => {
    const { opts, calls, flushNowArgs, isActive } = setupUpgrade(false);
    await upgradeToFullLayout(opts);
    expect(isActive()).toBe(false);
    expect(calls).toEqual(['updatePage']);
    expect(flushNowArgs).toEqual([]);
  });
});
