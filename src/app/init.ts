/**
 * init.ts — startup helpers used by app.ts's `initApp()` orchestrator.
 *
 * Three responsibilities, exported as separate functions so each can be tested in isolation:
 * 1. `loadInitialAppState` — read persisted settings + saved game from storage and build the
 *    initial GameState.
 * 2. `setupTextOnlyStartup` — text-first BLE bring-up (createStartUpPageContainer with text only;
 *    image containers are deferred until first user input proves the BLE link is live).
 * 3. `upgradeToFullLayout` — tear-down the text-only page and rebuild with the full layout
 *    (text + 2 board halves + brand). Idempotent.
 */

import type { Store } from '../state/store';
import type { GameState } from '../state/contracts';
import type { ChessService } from '../chess/chessservice';
import type { EvenHubBridge } from '../evenhub/bridge';
import type { FlushController } from './flush';
import type { BrandingController } from './branding';
import { buildInitialState } from '../state/contracts';
import {
  loadDifficulty,
  loadCustomSkillLevel,
  loadBoardMarkers,
  loadBoardAlignment,
  loadBoardSize,
  loadBoardPosition,
  loadPlayAs,
  loadGame,
  clearSave,
} from '../storage/persistence';
import { resolvePlayerColor } from '../state/utils';
import {
  composeTextOnlyStartupPage,
  composePageForState,
  CONTAINER_ID_TEXT,
  CONTAINER_NAME_TEXT,
} from '../render/composer';
import { renderBlankBrandingImage, preloadBrandingImages } from '../render/branding';
import { CONTAINER_ID_BRAND, CONTAINER_NAME_BRAND } from '../render/composer';
import { getCombinedDisplayText } from '../state/selectors';
import { debugLog } from '../debug/logger';

export async function loadInitialAppState(chess: ChessService): Promise<GameState> {
  const [persistedDifficulty, persistedCustomSkillLevel, persistedBoardMarkers, persistedBoardAlignment, persistedBoardSize, persistedBoardPosition, persistedPlayAs, savedGame] = await Promise.all([
    loadDifficulty(),
    loadCustomSkillLevel(),
    loadBoardMarkers(),
    loadBoardAlignment(),
    loadBoardSize(),
    loadBoardPosition(),
    loadPlayAs(),
    loadGame(),
  ]);

  let initialState = buildInitialState(chess);
  initialState = {
    ...initialState,
    difficulty: persistedDifficulty,
    customSkillLevel: persistedCustomSkillLevel,
    showBoardMarkers: persistedBoardMarkers,
    boardAlignment: persistedBoardAlignment,
    boardSize: persistedBoardSize,
    boardPosition: persistedBoardPosition,
    playAs: persistedPlayAs,
    // Fresh start: resolve the human's color now ('random' rolls here). A resumed
    // saved game overrides this below with its own persisted playerColor.
    playerColor: resolvePlayerColor(persistedPlayAs),
  };

  if (savedGame) {
    try {
      // An unreadable position, or a finished one (checkmate, stalemate, or any draw), can't be
      // resumed: it would show the saved move log over the wrong board, or a dead board with no
      // game-over message. Start a new game instead.
      if (!chess.loadFen(savedGame.fen) || chess.isGameOver()) {
        chess.reset();
        void clearSave();
      } else {
        initialState = {
          ...initialState,
          fen: savedGame.fen,
          history: savedGame.history,
          turn: savedGame.turn,
          difficulty: savedGame.difficulty,
          // Older saves predate per-game custom-skill capture; fall back to the persisted setting.
          customSkillLevel: savedGame.customSkillLevel ?? persistedCustomSkillLevel,
          playerColor: savedGame.playerColor ?? 'w',
          pieces: chess.getPiecesWithMoves(),
          inCheck: chess.isInCheck(),
          hasUnsavedChanges: false,
        };
      }
    } catch (err) {
      console.error('[init] Failed to restore saved game:', err);
    }
  }

  debugLog('init initial-state', {
    difficulty: persistedDifficulty,
    markers: persistedBoardMarkers,
    alignment: persistedBoardAlignment,
    size: persistedBoardSize,
    position: persistedBoardPosition,
    savedGame: savedGame ? 'yes' : 'no',
  }, 'INIT');

  return initialState;
}

/**
 * Text-first startup: createStartUpPageContainer with only text + brand containers, send the
 * initial text + brand image. Image containers are added later by `upgradeToFullLayout()` once
 * the BLE link has demonstrated it can carry traffic.
 *
 * Returns true if startup succeeded (the bridge accepted the page); false if it failed (no bridge,
 * setupPage rejected, etc.) — caller decides how to surface the failure.
 */
export async function setupTextOnlyStartup(
  bridge: EvenHubBridge,
  store: Store,
): Promise<boolean> {
  const state = store.getState();
  let ok = await bridge.setupPage(composeTextOnlyStartupPage(state));
  if (!ok) {
    // createStartUpPageContainer was rejected. It is one-shot per native session (not per WebView
    // load), so the host rejects it when it kept the session from an earlier load. Fall back to
    // rebuildPageContainer, which is valid mid-session.
    debugLog('setupPage rejected — falling back to rebuildPageContainer (session already started)', {}, 'INIT');
    ok = await bridge.updatePage(composePageForState(state));
    if (!ok) return false;
  }

  void preloadBrandingImages();
  const text = getCombinedDisplayText(state, { boardReady: false });
  void bridge.updateText(CONTAINER_ID_TEXT, CONTAINER_NAME_TEXT, text);
  // Branding disabled: blank strip at startup (captured pieces fill it once a capture happens).
  bridge.updateImage(CONTAINER_ID_BRAND, CONTAINER_NAME_BRAND, renderBlankBrandingImage());
  return true;
}

/**
 * Switch from the text-only startup page to the full layout (text + 2 board halves + brand). Calls
 * rebuildPageContainer internally (the bridge serializes against image sends so it doesn't crash
 * the connection). After the page is up, sets `imageContainersActive` and triggers a force-flush
 * so the board paints from the current store state in one round.
 *
 * Idempotent — safe to call multiple times; the `imageContainersActive` getter gates re-entry.
 */
export async function upgradeToFullLayout(opts: {
  bridge: EvenHubBridge;
  store: Store;
  flush: FlushController;
  branding: BrandingController;
  imageContainersActive: () => boolean;
  setImageContainersActive: (active: boolean) => void;
}): Promise<void> {
  if (opts.imageContainersActive()) return;
  try {
    void preloadBrandingImages();
    const ok = await opts.bridge.updatePage(composePageForState(opts.store.getState()));
    if (!ok) {
      console.error('[init] upgradeToFullLayout: rebuildPageContainer returned false');
      return;
    }
    opts.setImageContainersActive(true);
    opts.flush.setForceFullRefresh();
    opts.branding.forceNextRefresh();
    await opts.flush.flushNow({ force: true });
    opts.branding.syncNow();
    debugLog('init full-layout active', {}, 'INIT');
  } catch (err) {
    console.error('[init] upgradeToFullLayout error:', err);
  }
}

/**
 * Storage durability probe. Writes a launch-stamp every cold start; the value read back on the
 * next launch tells which backing store (localStorage vs SDK) actually persists across iOS app
 * restarts. Logged for diagnostics; does not affect runtime behavior.
 */
export async function runStorageProbe(bridge: EvenHubBridge): Promise<void> {
  try {
    const probeNow = String(Date.now());
    const localPrev = (() => {
      try {
        return localStorage.getItem('evenchess-probe');
      } catch {
        return null;
      }
    })();
    const sdkPrev = await bridge.rawSdkGet('evenchess-probe');
    debugLog('storage probe previous', { localPrev, sdkPrev, now: probeNow }, 'STG');
    void bridge.storageSet('evenchess-probe', probeNow);
  } catch (err) {
    debugLog('storage probe failed', { err: String(err) }, 'STG');
  }
}
