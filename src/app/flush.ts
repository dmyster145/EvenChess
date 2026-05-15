/**
 * flush.ts — single render function from store state to glasses containers.
 *
 * Replaces the v1 `flushDisplayUpdate` (~400 lines), the per-flush lock
 * (`flushInProgress`/`pendingFlushState`), the speed-first/tail/cross-half ordering helpers, and
 * the board/drill pre-render caches with a minimal "build text + 2 board halves, hand to bridge"
 * pipeline. Coalescing is delegated to the bridge — every `bridge.updateImage` and
 * `bridge.updateText` overwrites the per-container pending slot so concurrent flushes naturally
 * merge to the latest state.
 *
 * The flush has no Promise.race timeouts and no fire-and-forget paths — handing a payload to the
 * bridge is synchronous from the caller's perspective. The bridge's serial sender drains them in
 * order at BLE pace.
 */

import type { Store } from '../state/store';
import type { GameState } from '../state/contracts';
import type { ChessService } from '../chess/chessservice';
import type { BoardRenderer } from '../render/boardimage';
import type { EvenHubBridge } from '../evenhub/bridge';
import { ImageRawDataUpdate } from '@evenrealities/even_hub_sdk';
import { CONTAINER_ID_TEXT, CONTAINER_NAME_TEXT } from '../render/composer';
import { getCombinedDisplayText } from '../state/selectors';
import { getFileIndex, getRankIndex } from '../chess/square-utils';
import { Chess } from 'chess.js';
import { STARTING_FEN } from '../academy/pgn';

/**
 * One frame at 60Hz. Replaces the v1 `0` debounce that fired one flush per microtask. Coalescing
 * inside this 16ms window collapses store-subscription churn (a single user input often dispatches
 * multiple actions) into one render.
 */
const DISPLAY_DEBOUNCE_MS = 16;

export interface FlushDeps {
  bridge: EvenHubBridge;
  store: Store;
  chess: ChessService;
  getRenderer: () => BoardRenderer;
  isWearingGlasses: () => boolean;
  isDeviceConnected: () => boolean;
  imageContainersActive: () => boolean;
}

export interface FlushController {
  /** Schedule a debounced flush. Idempotent within the debounce window. */
  schedule(): void;
  /** Flush immediately, bypassing the debounce. Used by visibility-resume and bridge reinit. */
  flushNow(opts?: { force?: boolean }): Promise<void>;
  /** Cancel any pending debounced flush. Used at shutdown. */
  cancel(): void;
  /**
   * Mark the next flush as "force full refresh" — bypass diffs, re-render text + both board
   * halves. Used on layout changes, wearing-resume, and after bridge reinit so the glasses always
   * reflect the latest store state in one round.
   */
  setForceFullRefresh(): void;
}

export function createFlush(deps: FlushDeps): FlushController {
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let forceNext = false;

  // Last successfully-handed-to-bridge text, keyed by `boardReady` (the imageContainersActive flag
  // affects the text container width — see composer.ts). Keying by boardReady ensures the first
  // flush after the layout upgrades from text-only → full layout always re-sends text at the new
  // narrower width. Race #10 fix.
  let lastSentTextWhenBoardReady = '';
  let lastSentTextWhenBoardNotReady = '';

  function getCachedText(boardReady: boolean): string {
    return boardReady ? lastSentTextWhenBoardReady : lastSentTextWhenBoardNotReady;
  }
  function setCachedText(boardReady: boolean, text: string): void {
    if (boardReady) lastSentTextWhenBoardReady = text;
    else lastSentTextWhenBoardNotReady = text;
  }

  function schedule(): void {
    if (pendingTimer !== null) return;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      void doFlush(false);
    }, DISPLAY_DEBOUNCE_MS);
  }

  function cancel(): void {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  function setForceFullRefresh(): void {
    forceNext = true;
  }

  async function flushNow(opts?: { force?: boolean }): Promise<void> {
    cancel();
    if (opts?.force) forceNext = true;
    await doFlush(opts?.force === true);
  }

  async function doFlush(forceArg: boolean): Promise<void> {
    const force = forceArg || forceNext;
    forceNext = false;

    const state = deps.store.getState();
    const wearing = deps.isWearingGlasses();
    const connected = deps.isDeviceConnected();

    // Wearing/connected gate: skip BLE work when the display is invisible. `force` always wins —
    // recovery flushes (foreground-enter, wearing-resume, reinit) must run even if the gate is
    // closed, so we don't get stuck on a stale `isWearingGlasses` flag.
    if (!force && (!wearing || !connected)) {
      return;
    }

    const boardReady = deps.imageContainersActive();
    const text = getCombinedDisplayText(state, { boardReady });
    if (force || text !== getCachedText(boardReady)) {
      setCachedText(boardReady, text);
      void deps.bridge.updateText(CONTAINER_ID_TEXT, CONTAINER_NAME_TEXT, text);
    }

    if (!boardReady) return;

    // Yield once before the synchronous render path so a queued tap can drain through the input
    // handler ahead of a multi-millisecond render. Race #1 fix. The yield is cheap when no input
    // is queued and crucial when one is.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const images = await renderImagesForState(state, deps.chess, deps.getRenderer(), force);
    for (const img of images) {
      if (img.containerID === undefined || img.containerID === null) continue;
      deps.bridge.updateImage(img.containerID, img.containerName ?? '', img);
    }
  }

  return { schedule, flushNow, cancel, setForceFullRefresh };
}

// ---------------------------------------------------------------------------
// Render selection — picks the right BoardRenderer entry point per phase.
// ---------------------------------------------------------------------------

async function renderImagesForState(
  state: GameState,
  chess: ChessService,
  renderer: BoardRenderer,
  forceFullRefresh: boolean,
): Promise<ImageRawDataUpdate[]> {
  const academy = state.academyState;

  if (state.phase === 'coordinateDrill' && academy) {
    return renderer.renderDrillBoard(academy.cursorFile, academy.cursorRank);
  }
  if (state.phase === 'knightPathDrill' && academy?.knightPath) {
    const kp = academy.knightPath;
    return renderer.renderKnightPathBoard(
      getFileIndex(kp.currentSquare),
      getRankIndex(kp.currentSquare),
      getFileIndex(kp.targetSquare),
      getRankIndex(kp.targetSquare),
      academy.cursorFile,
      academy.cursorRank,
    );
  }
  if ((state.phase === 'tacticsDrill' || state.phase === 'mateDrill') && academy?.tacticsPuzzle) {
    return renderer.renderFromFen(academy.tacticsPuzzle.fen);
  }
  if (state.phase === 'pgnStudy' && academy?.pgnStudy) {
    const pgn = academy.pgnStudy;
    const fen = computePgnPositionFen(pgn.moves.slice(0, pgn.currentMoveIndex));
    return renderer.renderFromFen(fen);
  }

  if (forceFullRefresh) {
    return renderer.renderFull(state, chess);
  }

  // Live play: PNG-first for smaller BLE payload. PNG returns [] on encoder failure → BMP fallback.
  const png = await renderer.renderPngAsync(state, chess);
  if (png.length > 0) return png;
  return renderer.render(state, chess);
}

function computePgnPositionFen(moves: string[]): string {
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
