/**
 * EvenChess — Application entry point.
 *
 * Wires all modules together:
 *   ChessService  →  Store  →  PageComposer  →  EvenHubBridge
 *                      ↑                            |
 *                  InputMapper  ←  SDK Events  ←────┘
 *
 * Update strategy:
 *   - Initial setup → createStartUpPageContainer (once)
 *   - All subsequent updates → textContainerUpgrade + dirty board images
 *   - Text and images sent in parallel (independent containers)
 *   - Board render skipped when only text changed (engineThinking toggle)
 */

import { ChessService } from './chess/chessservice';
import { Chess } from 'chess.js';
import { createStore } from './state/store';
import { buildInitialState } from './state/contracts';
import type { GameState, MenuOption } from './state/contracts';
import { mapEvenHubEvent, extendTapCooldown, TAP_COOLDOWN_MENU_MS, TAP_COOLDOWN_DESTSELECT_MS } from './input/actions';
import {
  composeStartupPage,
  CONTAINER_ID_TEXT,
  CONTAINER_NAME_TEXT,
  CONTAINER_ID_IMAGE_TOP,
  CONTAINER_ID_IMAGE_BOTTOM,
} from './render/composer';
import { BoardRenderer, rankHalf } from './render/boardimage';
import { getCombinedDisplayText, getSelectedPiece, getSelectedMove } from './state/selectors';
import { renderBrandingImage, renderBlankBrandingImage, renderCheckBrandingImage } from './render/branding';
import { EvenHubBridge } from './evenhub/bridge';
import { TurnLoop } from './engine/turnloop';
import { PROFILE_BY_DIFFICULTY } from './engine/profiles';
import { saveGame, loadGame, clearSave, saveDifficulty, loadDifficulty, saveBoardMarkers, loadBoardMarkers } from './storage/persistence';
import type { ImageRawDataUpdate } from '@evenrealities/even_hub_sdk';
import { MENU_OPTIONS } from './state/constants';
import { STARTING_FEN } from './academy/pgn';
import { moveCursorAxis } from './academy/drills';
import { getFileIndex, getRankIndex } from './chess/square-utils';

async function sendImages(hub: EvenHubBridge, images: ImageRawDataUpdate[]): Promise<void> {
  for (const img of images) {
    await hub.updateBoardImage(img);
  }
}

function getPgnPositionFen(_chess: ChessService, moves: string[]): string {
  if (moves.length === 0) return STARTING_FEN;

  const tempChess = new Chess();
  for (const move of moves) {
    try {
      tempChess.move(move);
    } catch {
      break;
    }
  }
  return tempChess.fen();
}

function getBrandingImage(inCheck: boolean): ImageRawDataUpdate {
  return inCheck ? renderCheckBrandingImage() : renderBrandingImage();
}

let storeUnsubscribe: (() => void) | null = null;
let pendingUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;

export async function initApp(): Promise<void> {
  const chess = new ChessService();

  const persistedDifficulty = loadDifficulty();
  const persistedBoardMarkers = loadBoardMarkers();
  const savedGame = loadGame();
  
  let initialState = buildInitialState(chess);
  initialState = { ...initialState, difficulty: persistedDifficulty, showBoardMarkers: persistedBoardMarkers };

  if (savedGame) {
    console.log('[EvenChess] Restoring saved game...');
    try {
      chess.loadFen(savedGame.fen);
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
    } catch (err) {
      console.error('[EvenChess] Failed to restore saved game:', err);
    }
  }

  const store = createStore(initialState);
  const hub = new EvenHubBridge();
  const boardRenderer = new BoardRenderer();
  const initialProfile = PROFILE_BY_DIFFICULTY[initialState.difficulty] ?? PROFILE_BY_DIFFICULTY['casual'];
  const turnLoop = new TurnLoop(chess, store, initialProfile);

  try {
    // Only block first paint on hub; engine init runs in background (fallback moves until ready)
    await hub.init();
    void turnLoop.init(); // don't block first paint on Stockfish load

    const startupPage = composeStartupPage(store.getState());
    const setupPagePromise = hub.setupPage(startupPage);
    const state = store.getState();
    // First paint: BMP (sync) for speed; render runs in parallel with setupPage
    const initialImages = boardRenderer.renderFull(state, chess);
    await setupPagePromise;
    console.log('[EvenChess] Sending initial board images:', initialImages.length);
    await sendImages(hub, initialImages);
    hub.updateBoardImage(renderBrandingImage()).catch((err) => console.error('[EvenChess] Branding image failed:', err));
  } catch (err) {
    console.error('[EvenChess] Initialization failed:', err);
  }

  hub.subscribeEvents((event) => {
    const action = mapEvenHubEvent(event, store.getState());
    if (action) {
      store.dispatch(action);
    }
  });

  // Debounced: rapid state changes coalesce into single SDK update. 0ms = next tick (snappier).
  const DISPLAY_DEBOUNCE_MS = 0;
  let latestState = store.getState();

  storeUnsubscribe = store.subscribe((state, prevState) => {
    latestState = state;

    // Execute pending move immediately (not debounced)
    if (state.pendingMove && !prevState.pendingMove) {
      const move = state.pendingMove;
      queueMicrotask(async () => {
        try {
          await turnLoop.onPlayerMoved(move);
        } catch (err) {
          console.error('[EvenChess] TurnLoop error:', err);
        }
      });
    }

    // Auto-save after moves
    if (state.history.length > prevState.history.length && state.history.length > 0) {
      saveGame(state.fen, state.history, state.turn, state.difficulty);
      store.dispatch({ type: 'MARK_SAVED' });
    }

    if (state.difficulty !== prevState.difficulty) {
      const profile = PROFILE_BY_DIFFICULTY[state.difficulty] ?? PROFILE_BY_DIFFICULTY['casual'];
      turnLoop.setProfile(profile);
      saveDifficulty(state.difficulty);
      if (state.history.length > 0) {
        saveGame(state.fen, state.history, state.turn, state.difficulty);
      }
      console.log('[EvenChess] Difficulty changed to:', state.difficulty);
    }

    if (state.showBoardMarkers !== prevState.showBoardMarkers) {
      saveBoardMarkers(state.showBoardMarkers);
      console.log('[EvenChess] Board markers changed to:', state.showBoardMarkers ? 'on' : 'off');
    }

    // Extend tap cooldown for menu/destSelect to prevent accidental inputs
    if (state.phase === 'menu' && prevState.phase !== 'menu') {
      extendTapCooldown(TAP_COOLDOWN_MENU_MS);
    }
    if (state.phase === 'destSelect' && prevState.phase !== 'destSelect') {
      extendTapCooldown(TAP_COOLDOWN_DESTSELECT_MS);
    }
    if (state.phase === 'promotionSelect' && prevState.phase !== 'promotionSelect') {
      extendTapCooldown(TAP_COOLDOWN_DESTSELECT_MS);
    }

    // Toggle branding visibility for viewLog (hide to make room for text)
    if (state.phase === 'viewLog' && prevState.phase !== 'viewLog') {
      hub.updateBoardImage(renderBlankBrandingImage()).catch((err) => {
        console.error('[EvenChess] Failed to hide branding:', err);
      });
    } else if (state.phase !== 'viewLog' && prevState.phase === 'viewLog') {
      hub.updateBoardImage(getBrandingImage(state.inCheck)).catch((err) => {
        console.error('[EvenChess] Failed to show branding:', err);
      });
    }

    // Update CHECK branding when check state changes
    if (state.phase !== 'viewLog' && state.inCheck !== prevState.inCheck) {
      hub.updateBoardImage(getBrandingImage(state.inCheck)).catch((err) => {
        console.error('[EvenChess] Failed to update check branding:', err);
      });
    }

    handleMenuSideEffects(state, prevState, chess, store, hub);

    // Bullet mode timer
    if (state.mode === 'bullet' && state.timerActive && !timerInterval) {
      timerInterval = setInterval(() => {
        store.dispatch({ type: 'TIMER_TICK' });
      }, 100);
    } else if ((!state.timerActive || state.mode !== 'bullet') && timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    // Schedule debounced display update
    if (pendingUpdateTimeout === null) {
      pendingUpdateTimeout = setTimeout(() => {
        pendingUpdateTimeout = null;
        void flushDisplayUpdate();
      }, DISPLAY_DEBOUNCE_MS);
    }
  });

  /** Reducer handles state transitions; this handles external side effects. */
  function handleMenuSideEffects(
    state: GameState,
    prevState: GameState,
    chess: ChessService,
    store: ReturnType<typeof createStore>,
    hub: EvenHubBridge
  ): void {
    if (prevState.phase === 'menu' && state.phase !== 'menu') {
      const selectedOption = getMenuOptionFromIndex(prevState.menuSelectedIndex);

      if (selectedOption === 'exit' && !prevState.hasUnsavedChanges) {
        void shutdownApp(hub);
      }
    }

    if (prevState.phase === 'resetConfirm' && state.phase === 'idle') {
      chess.reset();
      clearSave();
      store.dispatch({ type: 'NEW_GAME' });
      store.dispatch({
        type: 'REFRESH',
        ...chess.getStateSnapshot(),
      });
      console.log('[EvenChess] Game reset');
    }

    if (prevState.gameOver && !state.gameOver) {
      chess.reset();
      store.dispatch({
        type: 'REFRESH',
        ...chess.getStateSnapshot(),
      });
    }

    if (prevState.phase === 'bulletSetup' && state.phase === 'idle' && state.mode === 'bullet') {
      chess.reset();
      store.dispatch({
        type: 'REFRESH',
        ...chess.getStateSnapshot(),
      });
    }

    if (prevState.phase === 'exitConfirm' && state.phase === 'idle') {
      if (prevState.hasUnsavedChanges && !state.hasUnsavedChanges) {
        saveGame(state.fen, state.history, state.turn, state.difficulty);
        console.log('[EvenChess] Game saved before exit');
      }
      void shutdownApp(hub);
    }
  }

  function getMenuOptionFromIndex(index: number): MenuOption {
    return MENU_OPTIONS[index] ?? 'viewLog';
  }

  async function shutdownApp(hub: EvenHubBridge): Promise<void> {
    console.log('[EvenChess] Shutting down...');

    if (storeUnsubscribe) {
      storeUnsubscribe();
      storeUnsubscribe = null;
    }
    if (pendingUpdateTimeout) {
      clearTimeout(pendingUpdateTimeout);
      pendingUpdateTimeout = null;
    }
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    turnLoop.destroy();

    try {
      await hub.shutdown();
    } catch (err) {
      console.error('[EvenChess] Shutdown error:', err);
    }
  }

  let lastSentState = store.getState();
  let lastSentText = '';

  let flushInProgress = false;
  let pendingFlushState: GameState | null = null;

  /** Speculative cache: pre-rendered next/prev selection for instant scroll. */
  function boardCacheKey(s: GameState): string {
    return `${s.phase}:${s.fen}:${s.selectedPieceId}:${s.selectedMoveIndex}:${s.selectedPromotionIndex}`;
  }
  const boardCache: {
    nextKey: string;
    nextImages: ImageRawDataUpdate[];
    prevKey: string;
    prevImages: ImageRawDataUpdate[];
  } = { nextKey: '', nextImages: [], prevKey: '', prevImages: [] };

  function drillCacheKey(file: number, rank: number): string {
    return `${file},${rank}`;
  }
  const drillCache: {
    nextKey: string;
    nextImages: ImageRawDataUpdate[];
    prevKey: string;
    prevImages: ImageRawDataUpdate[];
  } = { nextKey: '', nextImages: [], prevKey: '', prevImages: [] };

  function scheduleDrillCacheRefill(state: GameState): void {
    const academy = state.academyState;
    if (state.phase !== 'coordinateDrill' || !academy) return;
    const f = academy.cursorFile;
    const r = academy.cursorRank;
    const axis = academy.navAxis;
    const nextPos = moveCursorAxis(f, r, axis, 'down');
    const prevPos = moveCursorAxis(f, r, axis, 'up');
    const run = (): void => {
      drillCache.nextKey = drillCacheKey(nextPos.file, nextPos.rank);
      drillCache.prevKey = drillCacheKey(prevPos.file, prevPos.rank);
      drillCache.nextImages = boardRenderer.renderDrillBoard(nextPos.file, nextPos.rank);
      drillCache.prevImages = boardRenderer.renderDrillBoard(prevPos.file, prevPos.rank);
    };
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(run, { timeout: 80 });
    } else {
      setTimeout(run, 0);
    }
  }

  /** When both halves are sent, put the half containing the selection first so it appears sooner. */
  function orderImagesSelectionFirst(images: ImageRawDataUpdate[], state: GameState): ImageRawDataUpdate[] {
    if (images.length !== 2) return images;
    const piece = getSelectedPiece(state);
    const move = getSelectedMove(state);
    const square =
      (state.phase === 'promotionSelect' && state.pendingPromotionMove
        ? state.pendingPromotionMove.to
        : state.phase === 'destSelect'
          ? move?.to
          : piece?.square) ?? 'e4';
    const displayRank = 8 - parseInt(square[1] ?? '1', 10);
    const half = rankHalf(displayRank);
    const topId = images.find((u) => u.containerID === CONTAINER_ID_IMAGE_TOP);
    const bottomId = images.find((u) => u.containerID === CONTAINER_ID_IMAGE_BOTTOM);
    if (!topId || !bottomId) return images;
    return half === 'top' ? [topId, bottomId] : [bottomId, topId];
  }

  /** Menu / markers toggle: always send top half then bottom so both halves update in display order. */
  function orderImagesTopFirst(images: ImageRawDataUpdate[]): ImageRawDataUpdate[] {
    if (images.length !== 2) return images;
    const top = images.find((u) => u.containerID === CONTAINER_ID_IMAGE_TOP);
    const bottom = images.find((u) => u.containerID === CONTAINER_ID_IMAGE_BOTTOM);
    if (!top || !bottom) return images;
    return [top, bottom];
  }

  function scheduleBoardCacheRefill(state: GameState): void {
    if (state.phase !== 'pieceSelect' && state.phase !== 'destSelect') return;
    const pieces = state.pieces;
    if (pieces.length === 0) return;
    const run = async (): Promise<void> => {
      let nextState: GameState;
      let prevState: GameState;
      if (state.phase === 'pieceSelect') {
        const len = pieces.length;
        const idx = Math.max(0, pieces.findIndex((p) => p.id === state.selectedPieceId));
        const nextId = pieces[(idx + 1) % len]?.id ?? state.selectedPieceId;
        const prevId = pieces[(idx - 1 + len) % len]?.id ?? state.selectedPieceId;
        nextState = { ...state, selectedPieceId: nextId, selectedMoveIndex: 0 };
        prevState = { ...state, selectedPieceId: prevId, selectedMoveIndex: 0 };
      } else {
        const piece = pieces.find((p) => p.id === state.selectedPieceId);
        const moves = piece?.moves ?? [];
        const len = moves.length;
        if (len === 0) return;
        nextState = { ...state, selectedMoveIndex: (state.selectedMoveIndex + 1) % len };
        prevState = { ...state, selectedMoveIndex: (state.selectedMoveIndex - 1 + len) % len };
      }
      boardCache.nextKey = boardCacheKey(nextState);
      boardCache.prevKey = boardCacheKey(prevState);
      const [nextImages, prevImages] = await Promise.all([
        boardRenderer.renderPngAsync(nextState, chess, 0),
        boardRenderer.renderPngAsync(prevState, chess, 2),
      ]);
      boardCache.nextImages = nextImages.length > 0 ? nextImages : boardRenderer.render(nextState, chess);
      boardCache.prevImages = prevImages.length > 0 ? prevImages : boardRenderer.render(prevState, chess);
    };
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(run, { timeout: 80 });
    } else {
      setTimeout(run, 0);
    }
  }

  async function flushDisplayUpdate(): Promise<void> {
    // Mutex: BLE sends can be slow on glasses, prevent concurrent flushes
    if (flushInProgress) {
      pendingFlushState = latestState;
      return;
    }
    flushInProgress = true;

    try {
      const state = latestState;
      const prev = lastSentState;
      lastSentState = state;

      const displayChanged =
        state.phase !== prev.phase ||
        state.fen !== prev.fen ||
        state.engineThinking !== prev.engineThinking ||
        state.gameOver !== prev.gameOver ||
        state.showBoardMarkers !== prev.showBoardMarkers ||
        state.selectedPieceId !== prev.selectedPieceId ||
        state.selectedMoveIndex !== prev.selectedMoveIndex ||
        state.selectedPromotionIndex !== prev.selectedPromotionIndex ||
        state.pendingPromotionMove !== prev.pendingPromotionMove ||
        state.menuSelectedIndex !== prev.menuSelectedIndex ||
        state.selectedTimeControlIndex !== prev.selectedTimeControlIndex ||
        state.timers?.whiteMs !== prev.timers?.whiteMs ||
        state.timers?.blackMs !== prev.timers?.blackMs ||
        state.academyState?.targetSquare !== prev.academyState?.targetSquare ||
        state.academyState?.score.total !== prev.academyState?.score.total ||
        state.academyState?.cursorFile !== prev.academyState?.cursorFile ||
        state.academyState?.cursorRank !== prev.academyState?.cursorRank ||
        state.academyState?.navAxis !== prev.academyState?.navAxis ||
        state.academyState?.feedback !== prev.academyState?.feedback ||
        state.academyState?.pgnStudy?.currentMoveIndex !== prev.academyState?.pgnStudy?.currentMoveIndex ||
        state.academyState?.pgnStudy?.gameName !== prev.academyState?.pgnStudy?.gameName;

      if (!displayChanged) {
        return;
      }

      const isCoordDrill = state.phase === 'coordinateDrill';
      const isKnightDrill = state.phase === 'knightPathDrill';
      const isTacticsDrill = state.phase === 'tacticsDrill' || state.phase === 'mateDrill';
      const isPgnStudy = state.phase === 'pgnStudy';
      const isDrillMode = isCoordDrill || isKnightDrill || isTacticsDrill || isPgnStudy;
      const wasCoordDrill = prev.phase === 'coordinateDrill';
      const wasKnightDrill = prev.phase === 'knightPathDrill';
      const wasTacticsDrill = prev.phase === 'tacticsDrill' || prev.phase === 'mateDrill';
      const wasPgnStudy = prev.phase === 'pgnStudy';
      const wasDrillMode = wasCoordDrill || wasKnightDrill || wasTacticsDrill || wasPgnStudy;

      const drillCursorChanged = isDrillMode && (
        state.academyState?.cursorFile !== prev.academyState?.cursorFile ||
        state.academyState?.cursorRank !== prev.academyState?.cursorRank ||
        state.academyState?.knightPath?.currentSquare !== prev.academyState?.knightPath?.currentSquare ||
        state.academyState?.tacticsPuzzle?.fen !== prev.academyState?.tacticsPuzzle?.fen ||
        state.academyState?.pgnStudy?.currentMoveIndex !== prev.academyState?.pgnStudy?.currentMoveIndex ||
        state.academyState?.pgnStudy?.gameName !== prev.academyState?.pgnStudy?.gameName
      );
      const boardMayHaveChanged =
        state.fen !== prev.fen ||
        state.showBoardMarkers !== prev.showBoardMarkers ||
        state.selectedPieceId !== prev.selectedPieceId ||
        state.selectedMoveIndex !== prev.selectedMoveIndex ||
        state.phase !== prev.phase ||
        drillCursorChanged;

      const text = getCombinedDisplayText(state);
      let textPromise: Promise<boolean> | undefined;
      if (text !== lastSentText) {
        lastSentText = text;
        textPromise = hub.updateText(CONTAINER_ID_TEXT, CONTAINER_NAME_TEXT, text);
      }

      try {
        const imagePromise = boardMayHaveChanged
          ? (async () => {
              let dirtyImages: ImageRawDataUpdate[];
              if (isCoordDrill && state.academyState) {
                const cf = state.academyState.cursorFile;
                const cr = state.academyState.cursorRank;
                const key = drillCacheKey(cf, cr);
                const useNext = drillCache.nextKey === key && drillCache.nextImages.length > 0;
                const usePrev = drillCache.prevKey === key && drillCache.prevImages.length > 0;
                if (useNext) {
                  dirtyImages = drillCache.nextImages;
                } else if (usePrev) {
                  dirtyImages = drillCache.prevImages;
                } else {
                  dirtyImages = boardRenderer.renderDrillBoard(cf, cr);
                }
                if (!useNext && !usePrev) scheduleDrillCacheRefill(state);
              } else if (isKnightDrill && state.academyState?.knightPath) {
                const kp = state.academyState.knightPath;
                const knightFile = getFileIndex(kp.currentSquare);
                const knightRank = getRankIndex(kp.currentSquare);
                const targetFile = getFileIndex(kp.targetSquare);
                const targetRank = getRankIndex(kp.targetSquare);
                dirtyImages = boardRenderer.renderKnightPathBoard(
                  knightFile,
                  knightRank,
                  targetFile,
                  targetRank,
                  state.academyState.cursorFile,
                  state.academyState.cursorRank
                );
              } else if (isTacticsDrill && state.academyState?.tacticsPuzzle) {
                dirtyImages = boardRenderer.renderFromFen(state.academyState.tacticsPuzzle.fen);
              } else if (isPgnStudy && state.academyState?.pgnStudy) {
                const pgn = state.academyState.pgnStudy;
                const pgnFen = getPgnPositionFen(chess, pgn.moves.slice(0, pgn.currentMoveIndex));
                dirtyImages = boardRenderer.renderFromFen(pgnFen);
              } else if (wasDrillMode && !isDrillMode) {
                dirtyImages = boardRenderer.renderFull(state, chess);
              } else {
                const key = boardCacheKey(state);
                const useNext = boardCache.nextKey === key && boardCache.nextImages.length > 0;
                const usePrev = boardCache.prevKey === key && boardCache.prevImages.length > 0;
                if (useNext || usePrev) {
                  dirtyImages = useNext ? boardCache.nextImages : boardCache.prevImages;
                  boardRenderer.setStateForCache(state);
                } else {
                  // Sync BMP for faster update (same as launch/drills); cache refill still uses PNG for smaller payload
                  dirtyImages = boardRenderer.render(state, chess);
                }
                if (state.phase === 'pieceSelect' || state.phase === 'destSelect' || state.phase === 'promotionSelect') {
                  dirtyImages = orderImagesSelectionFirst(dirtyImages, state);
                } else {
                  dirtyImages = orderImagesTopFirst(dirtyImages);
                }
                scheduleBoardCacheRefill(state);
              }
              return sendImages(hub, dirtyImages);
            })()
          : Promise.resolve();

        await Promise.all([imagePromise, textPromise ?? Promise.resolve()]);
      } catch (err) {
        console.error('[EvenChess] Display update failed:', err);
      }
    } finally {
      flushInProgress = false;

      if (pendingFlushState) {
        const pending = pendingFlushState;
        pendingFlushState = null;
        if (pending.fen !== lastSentState.fen || pending.phase !== lastSentState.phase) {
          latestState = pending;
          void flushDisplayUpdate();
        }
      }
    }
  }

  console.log('[EvenChess] Initialized — ready to play.');
}
