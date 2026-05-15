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
  loadBoardMarkers,
  loadBoardAlignment,
  loadBoardSize,
  loadGame,
  clearSave,
} from '../storage/persistence';
import {
  composeTextOnlyStartupPage,
  composePageForState,
  CONTAINER_ID_TEXT,
  CONTAINER_NAME_TEXT,
} from '../render/composer';
import { renderBrandingImage, preloadBrandingImages } from '../render/branding';
import { CONTAINER_ID_BRAND, CONTAINER_NAME_BRAND } from '../render/composer';
import { getCombinedDisplayText } from '../state/selectors';
import { debugLog } from '../debug/logger';

export async function loadInitialAppState(chess: ChessService): Promise<GameState> {
  const [persistedDifficulty, persistedBoardMarkers, persistedBoardAlignment, persistedBoardSize, savedGame] = await Promise.all([
    loadDifficulty(),
    loadBoardMarkers(),
    loadBoardAlignment(),
    loadBoardSize(),
    loadGame(),
  ]);

  let initialState = buildInitialState(chess);
  initialState = {
    ...initialState,
    difficulty: persistedDifficulty,
    showBoardMarkers: persistedBoardMarkers,
    boardAlignment: persistedBoardAlignment,
    boardSize: persistedBoardSize,
  };

  if (savedGame) {
    try {
      chess.loadFen(savedGame.fen);
      if (chess.isCheckmate()) {
        // Resuming into a finished position confuses the user and the branding/state recovery
        // code; start a new game instead.
        chess.reset();
        void clearSave();
      } else {
        initialState = {
          ...initialState,
          fen: savedGame.fen,
          history: savedGame.history,
          turn: savedGame.turn,
          difficulty: savedGame.difficulty,
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
  const ok = await bridge.setupPage(composeTextOnlyStartupPage(state));
  if (!ok) return false;

  void preloadBrandingImages();
  const text = getCombinedDisplayText(state, { boardReady: false });
  void bridge.updateText(CONTAINER_ID_TEXT, CONTAINER_NAME_TEXT, text);
  bridge.updateImage(CONTAINER_ID_BRAND, CONTAINER_NAME_BRAND, renderBrandingImage());
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
