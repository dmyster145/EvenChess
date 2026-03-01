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
import { renderBrandingImage, renderCheckBrandingImage, renderCheckmateBrandingImage } from './render/branding';
import { EvenHubBridge } from './evenhub/bridge';
import { TurnLoop } from './engine/turnloop';
import { PROFILE_BY_DIFFICULTY } from './engine/profiles';
import { saveGame, loadGame, clearSave, saveDifficulty, loadDifficulty, saveBoardMarkers, loadBoardMarkers } from './storage/persistence';
import { ImageRawDataUpdate, OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { MENU_OPTIONS } from './state/constants';
import { STARTING_FEN } from './academy/pgn';
import { moveCursorAxis } from './academy/drills';
import { getFileIndex, getRankIndex } from './chess/square-utils';
import { perfLogLazy } from './perf/log';
import { getLastPerfDispatchTrace, recordPerfDispatch } from './perf/dispatch-trace';
import type { Action } from './state/contracts';
import { debugLog, attachDebugCopyApi, markRunStart } from './debug/logger';
import { activateKeepAlive, isKeepAliveActive, deactivateKeepAlive } from './utils/keep-alive';

type BoardImageSendMeta = {
  kind?: 'board' | 'branding' | 'other';
  priority?: 'high' | 'low';
  interruptProtected?: boolean;
};
type BrandingMode = 'normal' | 'check' | 'checkmate';

// Simple "send everything in order" helper used by correctness-first paths.
// EvenHubBridge still serializes image transport internally because the SDK/device does not support parallel sends.
async function sendImages(
  hub: EvenHubBridge,
  images: ImageRawDataUpdate[],
  meta?: BoardImageSendMeta,
): Promise<void> {
  for (const img of images) {
    await hub.updateBoardImage(img, meta);
  }
}

// Speed-first helper for 2-half updates:
// send the most important half now, then queue the rest as low-priority tail work.
// This improves perceived responsiveness on G2 when one image send can take ~0.7–3s.
async function sendImagesSpeedFirstTail(
  hub: EvenHubBridge,
  images: ImageRawDataUpdate[],
  meta?: BoardImageSendMeta,
): Promise<void> {
  if (images.length === 0) return;
  const first = images[0];
  if (!first) return;
  await hub.updateBoardImage(first, meta);
  for (let i = 1; i < images.length; i++) {
    const tail = images[i];
    if (!tail) continue;
    hub.updateBoardImage(tail, { ...meta, priority: 'low' }).catch((err) => {
      console.error('[EvenChess] Low-priority tail image send failed:', err);
    });
  }
}

function perfNowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// Performance feature toggles kept as explicit flags so the behavior can be reused/tuned in other G2 apps.
// These are intentional UX tradeoffs (perceived latency vs visual completeness).
// Off by default for production use. Enable temporarily when profiling end-to-end input->render latency on G2.
const PERF_FLUSH_LOGGING = false;
const SPEED_FIRST_CROSS_HALF_SELECTION = true;
const SPEED_FIRST_CROSS_HALF_MOVE_COMMIT = true;

const SUSPENSION_GUARD_ENABLED = true;
const HEARTBEAT_INTERVAL_MS = 1000;
const HEARTBEAT_SUSPENSION_THRESHOLD_MS = 5000;
const HEARTBEAT_BRIDGE_REINIT_THRESHOLD_MS = 30000;
const FLUSH_TRANSPORT_ONLY_HANG_PROBE_MS = 1400;
const FLUSH_TRANSPORT_ONLY_HANG_MIN_INFLIGHT_AGE_MS = 5000;
const FLUSH_TRANSPORT_ONLY_HANG_MAX_QUEUE_DEPTH = 2;
const DEAD_LINK_CONSECUTIVE_RESETS_FOR_REINIT = 3;
const BRIDGE_REINIT_COOLDOWN_MS = 30000;
const BRIDGE_REINIT_FAILED_COOLDOWN_MS = 2000;
const BRIDGE_REINIT_MAX_CONSECUTIVE_FAILURES = 2;
const BRIDGE_REINIT_MAX_PAGE_RELOADS = 2;
const BRIDGE_REINIT_SLOW_RETRY_INTERVAL_MS = 8000;
const BRIDGE_REINIT_SETUP_PAGE_TIMEOUT_MS = 3000;
const BRIDGE_REINIT_SHUTDOWN_SETTLE_MS = 1500;
const NON_OK_DEAD_LINK_THRESHOLD = 2;
const VISIBILITY_RECENT_RECOVERY_WINDOW_MS = 10000;

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

let storeUnsubscribe: (() => void) | null = null;
let pendingUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let pendingRecoveryRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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
      if (chess.isCheckmate()) {
        // Finished games are a poor resume experience and can confuse startup branding/state restoration.
        console.log('[EvenChess] Saved game was checkmate; starting a new game instead.');
        chess.reset();
        clearSave();
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
      console.error('[EvenChess] Failed to restore saved game:', err);
    }
  }

  const store = createStore(initialState);
  const hub = new EvenHubBridge();
  const boardRenderer = new BoardRenderer();
  const initialProfile = PROFILE_BY_DIFFICULTY[initialState.difficulty] ?? PROFILE_BY_DIFFICULTY['casual'];
  const turnLoop = new TurnLoop(chess, store, initialProfile);

  attachDebugCopyApi();
  markRunStart();

  let perfLastInputAtMs = 0;
  let perfLastInputSeq = 0;
  let perfLastInputLabel = '';
  let startupFlushArmed = false;
  let startupPendingFlush = false;

  // G2 image transport can take seconds; prevent overlapping flushes and replay only the newest state afterward.
  let flushInProgress = false;
  let pendingFlushState: GameState | null = null;
  let forceNextDisplayRefresh = false;

  // Autosave is deferred so localStorage writes and MARK_SAVED state churn do not compete with board-image sends.
  const AUTOSAVE_IDLE_DELAY_MS = 180;
  let pendingAutosaveTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingAutosaveSnapshot: Pick<GameState, 'fen' | 'history' | 'turn' | 'difficulty'> | null = null;
  let lastQueuedBrandingMode: BrandingMode = 'normal';
  let pendingBrandingMode: BrandingMode | null = null;
  let exitInProgress = false;
  let transportHangProbe: ReturnType<typeof setTimeout> | null = null;
  let transportHangProbeSeq = 0;
  let visibilityListener: (() => void) | null = null;
  let lastHeartbeatAtMs = 0;
  let consecutiveForceResetsWithNoSends = 0;
  let lastObservedSuccessfulSendAtMs = 0;
  let bridgeReinitInProgress = false;
  let lastBridgeReinitAtMs = 0;
  let consecutiveBridgeReinitFailures = 0;
  let inSlowRetryMode = false;
  let pageReloadCount = (() => {
    try {
      const stored = sessionStorage.getItem('__ec_reload_count');
      if (stored) return parseInt(stored, 10) || 0;
    } catch {
      // sessionStorage unavailable in some webviews.
    }
    try {
      const match = window.name.match(/__ec_rc=(\d+)/);
      const value = match?.[1];
      if (value) return parseInt(value, 10) || 0;
    } catch {
      // window.name unavailable.
    }
    return 0;
  })();
  let recentHangRecoveryTimestamps: number[] = [];
  let earlyShutdownFiredAtMs = 0;
  let earlyShutdownSettled = false;
  let earlyShutdownInFlight = false;

  function rememberHangRecovery(): void {
    const now = perfNowMs();
    recentHangRecoveryTimestamps.push(now);
    while (
      recentHangRecoveryTimestamps.length > 0 &&
      now - (recentHangRecoveryTimestamps[0] ?? 0) > VISIBILITY_RECENT_RECOVERY_WINDOW_MS
    ) {
      recentHangRecoveryTimestamps.shift();
    }
  }

  function refreshSuccessfulSendCounters(): void {
    const snapshot = hub.getImageTransportSnapshot();
    if (snapshot.lastSuccessfulSendAtMs > lastObservedSuccessfulSendAtMs) {
      lastObservedSuccessfulSendAtMs = snapshot.lastSuccessfulSendAtMs;
      consecutiveForceResetsWithNoSends = 0;
    }
  }

  function persistReloadCount(count: number): void {
    try {
      sessionStorage.setItem('__ec_reload_count', String(count));
    } catch {
      // noop
    }
    try {
      window.name = `__ec_rc=${count}`;
    } catch {
      // noop
    }
  }

  function clearReloadCountPersistence(): void {
    try {
      sessionStorage.removeItem('__ec_reload_count');
    } catch {
      // noop
    }
    try {
      window.name = '';
    } catch {
      // noop
    }
  }

  function dispatchWithPerfSource(source: 'input' | 'timer' | 'app', action: Action): void {
    recordPerfDispatch(source, action);
    store.dispatch(action);
  }

  function desiredBrandingModeForState(state: GameState): BrandingMode {
    if (state.gameOver?.toLowerCase() === 'checkmate') return 'checkmate';
    if (state.inCheck) return 'check';
    return 'normal';
  }

  function renderBrandingMode(mode: BrandingMode): ImageRawDataUpdate {
    switch (mode) {
      case 'checkmate':
        return renderCheckmateBrandingImage();
      case 'check':
        return renderCheckBrandingImage();
      default:
        return renderBrandingImage();
    }
  }

  function sendBrandingMode(mode: BrandingMode): void {
    pendingBrandingMode = null;
    lastQueuedBrandingMode = mode;
    hub.updateBoardImage(renderBrandingMode(mode), { priority: 'low', kind: 'branding' }).catch((err) => {
      const label = mode === 'checkmate' ? 'checkmate' : mode === 'check' ? 'check' : 'normal';
      console.error(`[EvenChess] Failed to update ${label} branding:`, err);
    });
  }

  function trySyncBrandingMode(state: GameState): void {
    const desiredMode = desiredBrandingModeForState(state);
    const brandingHealth = hub.getBoardSendHealth();
    // Branding is non-critical compared with board images. We only suppress entering CHECK! while the link is busy/degraded.
    // CHECKMATE and restoring to normal are treated as correctness/clarity-critical.
    const suppressNonCriticalBranding =
      desiredMode === 'check' && (brandingHealth.degraded || brandingHealth.boardBusy);

    // Drop stale pending branding targets (e.g. delayed CHECK! after state already returned to normal).
    if (pendingBrandingMode && pendingBrandingMode !== desiredMode) {
      pendingBrandingMode = null;
    }

    if (desiredMode !== lastQueuedBrandingMode) {
      if (suppressNonCriticalBranding) {
        pendingBrandingMode = desiredMode;
        return;
      }
      sendBrandingMode(desiredMode);
      return;
    }

    if (
      pendingBrandingMode &&
      pendingBrandingMode !== lastQueuedBrandingMode &&
      (
        pendingBrandingMode !== 'check' ||
        (!brandingHealth.degraded && !brandingHealth.boardBusy)
      )
    ) {
      sendBrandingMode(pendingBrandingMode);
    }
  }

  function clearDeferredAutosave(): void {
    pendingAutosaveSnapshot = null;
    if (pendingAutosaveTimeout) {
      clearTimeout(pendingAutosaveTimeout);
      pendingAutosaveTimeout = null;
    }
  }

  function scheduleDeferredAutosave(delayMs = AUTOSAVE_IDLE_DELAY_MS): void {
    if (pendingAutosaveTimeout) return;
    pendingAutosaveTimeout = setTimeout(() => {
      pendingAutosaveTimeout = null;
      flushDeferredAutosave();
    }, delayMs);
  }

  function queueDeferredAutosave(state: GameState): void {
    if (state.history.length === 0) return;
    pendingAutosaveSnapshot = {
      fen: state.fen,
      history: [...state.history],
      turn: state.turn,
      difficulty: state.difficulty,
    };
    scheduleDeferredAutosave();
  }

  function flushDeferredAutosave(options?: { dispatchMarkSaved?: boolean }): void {
    const snapshot = pendingAutosaveSnapshot;
    if (!snapshot) return;
    if (flushInProgress || pendingFlushState || hub.hasPendingBoardImageWork()) {
      scheduleDeferredAutosave(120);
      return;
    }

    pendingAutosaveSnapshot = null;
    saveGame(snapshot.fen, snapshot.history, snapshot.turn, snapshot.difficulty);

    if (options?.dispatchMarkSaved === false) return;

    const current = latestState;
    const savedCurrentState =
      current.fen === snapshot.fen &&
      current.turn === snapshot.turn &&
      current.difficulty === snapshot.difficulty &&
      current.history.length === snapshot.history.length &&
      current.history.every((move, idx) => move === snapshot.history[idx]);

    if (savedCurrentState && current.hasUnsavedChanges) {
      dispatchWithPerfSource('app', { type: 'MARK_SAVED' });
      return;
    }

    if (current.hasUnsavedChanges && current.history.length > 0) {
      queueDeferredAutosave(current);
    }
  }

  function formatSysEventName(eventType: number | null | undefined): string {
    if (eventType == null) return 'undefined';
    const enumMap = OsEventTypeList as unknown as Record<number, string>;
    return enumMap[eventType] ?? String(eventType);
  }

  function clearTransportHangProbe(): void {
    if (transportHangProbe) {
      clearTimeout(transportHangProbe);
      transportHangProbe = null;
    }
    transportHangProbeSeq += 1;
  }

  async function sendInitialDisplaySnapshot(state: GameState): Promise<void> {
    const initialImages = boardRenderer.renderFull(state, chess);
    await hub.updateBoardImages(initialImages, { kind: 'board', priority: 'high', interruptProtected: true });
    const mode = desiredBrandingModeForState(state);
    pendingBrandingMode = null;
    lastQueuedBrandingMode = mode;
    hub.updateBoardImage(renderBrandingMode(mode), { priority: 'low', kind: 'branding' }).catch((err) =>
      console.error('[EvenChess] Branding image failed:', err),
    );
  }

  function fireEarlyShutdown(reason: string): void {
    if (earlyShutdownInFlight || earlyShutdownSettled || exitInProgress) return;
    earlyShutdownInFlight = true;
    earlyShutdownFiredAtMs = perfNowMs();
    if (PERF_FLUSH_LOGGING) {
      perfLogLazy(() => `[Perf][Heartbeat][EarlyShutdown] fired reason=${reason}`);
    }
    void (async () => {
      try {
        await hub.shutdown();
      } catch {
        // Keep reinit progressing even if shutdown fails.
      }
      setTimeout(() => {
        earlyShutdownSettled = true;
        earlyShutdownInFlight = false;
        if (PERF_FLUSH_LOGGING) {
          perfLogLazy(() => `[Perf][Heartbeat][EarlyShutdown] settled reason=${reason}`);
        }
      }, BRIDGE_REINIT_SHUTDOWN_SETTLE_MS);
    })();
  }

  async function attemptBridgeReinit(reason: string): Promise<void> {
    if (bridgeReinitInProgress || exitInProgress) return;
    const now = perfNowMs();
    const effectiveCooldown = inSlowRetryMode
      ? BRIDGE_REINIT_SLOW_RETRY_INTERVAL_MS
      : consecutiveBridgeReinitFailures > 0
        ? BRIDGE_REINIT_FAILED_COOLDOWN_MS
        : BRIDGE_REINIT_COOLDOWN_MS;
    if (lastBridgeReinitAtMs > 0 && now - lastBridgeReinitAtMs < effectiveCooldown) {
      if (PERF_FLUSH_LOGGING) {
        perfLogLazy(
          () =>
            `[Perf][Heartbeat][Reinit] cooldown reason=${reason} elapsed=${(now - lastBridgeReinitAtMs).toFixed(1)}ms ` +
            `effective=${effectiveCooldown}ms failures=${consecutiveBridgeReinitFailures}`,
        );
      }
      return;
    }

    bridgeReinitInProgress = true;
    lastBridgeReinitAtMs = now;
    if (PERF_FLUSH_LOGGING) {
      perfLogLazy(
        () =>
          `[Perf][Heartbeat][Reinit] start reason=${reason} attempt=${consecutiveBridgeReinitFailures + 1}/${BRIDGE_REINIT_MAX_CONSECUTIVE_FAILURES}`,
      );
    }

    try {
      if (pendingUpdateTimeout) {
        clearTimeout(pendingUpdateTimeout);
        pendingUpdateTimeout = null;
      }
      clearTransportHangProbe();
      flushInProgress = false;

      if (earlyShutdownSettled) {
        // Settled already, nothing to wait.
      } else if (earlyShutdownInFlight) {
        const elapsedSinceShutdown = perfNowMs() - earlyShutdownFiredAtMs;
        const remainingMs = Math.max(0, BRIDGE_REINIT_SHUTDOWN_SETTLE_MS - elapsedSinceShutdown);
        await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
      } else {
        try {
          await hub.shutdown();
        } catch {
          // Ignore shutdown errors and continue.
        }
        await new Promise<void>((resolve) => setTimeout(resolve, BRIDGE_REINIT_SHUTDOWN_SETTLE_MS));
      }
      earlyShutdownFiredAtMs = 0;
      earlyShutdownSettled = false;
      earlyShutdownInFlight = false;

      await hub.init();
      hub.subscribeEvents(handleHubEvent);

      const startupPage = composeStartupPage(store.getState());
      const setupOk = await Promise.race<boolean>([
        hub.setupPage(startupPage),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), BRIDGE_REINIT_SETUP_PAGE_TIMEOUT_MS)),
      ]);
      if (!setupOk) {
        consecutiveBridgeReinitFailures += 1;
        if (consecutiveBridgeReinitFailures >= BRIDGE_REINIT_MAX_CONSECUTIVE_FAILURES) {
          const snap = hub.getImageTransportSnapshot();
          const transportAlive =
            snap.lastSuccessfulSendAtMs > 0 &&
            (perfNowMs() - snap.lastSuccessfulSendAtMs) < 10000;
          if (transportAlive || pageReloadCount >= BRIDGE_REINIT_MAX_PAGE_RELOADS) {
            consecutiveBridgeReinitFailures = 0;
            inSlowRetryMode = true;
            bridgeReinitInProgress = false;
            setTimeout(() => {
              void attemptBridgeReinit(`slow-retry-${reason}`);
            }, BRIDGE_REINIT_SLOW_RETRY_INTERVAL_MS);
            return;
          }
          pageReloadCount += 1;
          persistReloadCount(pageReloadCount);
          bridgeReinitInProgress = false;
          window.location.reload();
          return;
        }

        bridgeReinitInProgress = false;
        setTimeout(() => {
          void attemptBridgeReinit(`retry-${reason}`);
        }, BRIDGE_REINIT_FAILED_COOLDOWN_MS);
        return;
      }

      consecutiveBridgeReinitFailures = 0;
      inSlowRetryMode = false;
      pageReloadCount = 0;
      clearReloadCountPersistence();
      consecutiveForceResetsWithNoSends = 0;
      recentHangRecoveryTimestamps = [];
      await sendInitialDisplaySnapshot(store.getState());
      forceNextDisplayRefresh = true;
      latestState = store.getState();
      scheduleDisplayFlush();
    } catch (err) {
      console.error('[EvenChess] Bridge reinit failed:', err);
      consecutiveBridgeReinitFailures += 1;
      if (consecutiveBridgeReinitFailures >= BRIDGE_REINIT_MAX_CONSECUTIVE_FAILURES) {
        if (pageReloadCount >= BRIDGE_REINIT_MAX_PAGE_RELOADS) {
          consecutiveBridgeReinitFailures = 0;
          inSlowRetryMode = true;
          bridgeReinitInProgress = false;
          setTimeout(() => {
            void attemptBridgeReinit(`slow-retry-${reason}`);
          }, BRIDGE_REINIT_SLOW_RETRY_INTERVAL_MS);
          return;
        }
        pageReloadCount += 1;
        persistReloadCount(pageReloadCount);
        bridgeReinitInProgress = false;
        window.location.reload();
        return;
      }
      bridgeReinitInProgress = false;
      setTimeout(() => {
        void attemptBridgeReinit(`retry-${reason}`);
      }, BRIDGE_REINIT_FAILED_COOLDOWN_MS);
      return;
    } finally {
      bridgeReinitInProgress = false;
    }
  }

  function armTransportOnlyHangProbe(reason: string): void {
    if (transportHangProbe || exitInProgress || bridgeReinitInProgress) return;
    const probeSeq = transportHangProbeSeq;
    transportHangProbe = setTimeout(() => {
      if (probeSeq !== transportHangProbeSeq) return;
      transportHangProbe = null;
      refreshSuccessfulSendCounters();
      const health = hub.getBoardSendHealth();
      const transport = hub.getImageTransportSnapshot();
      const blockedByAppFlow = exitInProgress || bridgeReinitInProgress;
      const transportOnlyCandidate =
        !blockedByAppFlow &&
        health.interrupted &&
        transport.busy &&
        transport.queueDepth <= FLUSH_TRANSPORT_ONLY_HANG_MAX_QUEUE_DEPTH;
      const stuckByAge =
        transport.hasInFlight && transport.inFlightAgeMs >= FLUSH_TRANSPORT_ONLY_HANG_MIN_INFLIGHT_AGE_MS;
      const shouldRecover = transportOnlyCandidate && (transport.wedged || stuckByAge);

      if (shouldRecover) {
        hub.forceResetImageTransport(`transport-only-${reason}`);
        rememberHangRecovery();
        consecutiveForceResetsWithNoSends += 1;
        forceNextDisplayRefresh = true;
        latestState = store.getState();
        scheduleDisplayFlush();
      }

      if (
        !blockedByAppFlow &&
        (
          transport.consecutiveNonOkSends >= NON_OK_DEAD_LINK_THRESHOLD ||
          consecutiveForceResetsWithNoSends >= DEAD_LINK_CONSECUTIVE_RESETS_FOR_REINIT
        )
      ) {
        fireEarlyShutdown('transport-dead-link');
        void attemptBridgeReinit('transport-dead-link');
        return;
      }

      if (!blockedByAppFlow && health.interrupted && transport.busy) {
        armTransportOnlyHangProbe(reason);
      }
    }, FLUSH_TRANSPORT_ONLY_HANG_PROBE_MS);
  }

  function startHeartbeat(): void {
    if (heartbeatTimer || !SUSPENSION_GUARD_ENABLED) return;
    lastHeartbeatAtMs = perfNowMs();
    heartbeatTimer = setInterval(() => {
      const now = perfNowMs();
      const elapsedMs = now - lastHeartbeatAtMs;
      lastHeartbeatAtMs = now;

      if (exitInProgress || bridgeReinitInProgress) return;
      refreshSuccessfulSendCounters();

      if (elapsedMs >= HEARTBEAT_SUSPENSION_THRESHOLD_MS) {
        hub.notifySystemLifecycleEvent('foreground-enter');
        hub.forceResetImageTransport('suspension-detected');
        forceNextDisplayRefresh = true;
        latestState = store.getState();
        scheduleDisplayFlush();

        const recentRecoveryCount = recentHangRecoveryTimestamps.filter(
          (ts) => now - ts < VISIBILITY_RECENT_RECOVERY_WINDOW_MS,
        ).length;

        if (
          elapsedMs >= HEARTBEAT_BRIDGE_REINIT_THRESHOLD_MS ||
          recentRecoveryCount > 0 ||
          consecutiveForceResetsWithNoSends >= DEAD_LINK_CONSECUTIVE_RESETS_FOR_REINIT
        ) {
          fireEarlyShutdown('heartbeat-suspension');
          void attemptBridgeReinit('heartbeat-suspension');
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat(): void {
    if (!heartbeatTimer) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function setupVisibilityListener(): void {
    if (!SUSPENSION_GUARD_ENABLED || typeof document === 'undefined' || visibilityListener) return;
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        hub.notifySystemLifecycleEvent('foreground-exit');
      } else if (document.visibilityState === 'visible') {
        triggerForegroundEnterRecoveryRefresh('visibility-visible');
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    visibilityListener = () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  function teardownVisibilityListener(): void {
    visibilityListener?.();
    visibilityListener = null;
  }

  function triggerForegroundEnterRecoveryRefresh(source: 'foreground-enter' | 'visibility-visible'): void {
    if (pendingRecoveryRefreshTimeout) return;
    hub.notifySystemLifecycleEvent('foreground-enter');
    refreshSuccessfulSendCounters();
    if (SUSPENSION_GUARD_ENABLED) {
      const transport = hub.getImageTransportSnapshot();
      if (transport.wedged || transport.interrupted) {
        hub.forceResetImageTransport(`visibility-recovery-${source}`);
      }
      const recentRecoveryCount = recentHangRecoveryTimestamps.filter(
        (ts) => perfNowMs() - ts < VISIBILITY_RECENT_RECOVERY_WINDOW_MS,
      ).length;
      if (
        transport.consecutiveNonOkSends >= 1 ||
        recentRecoveryCount > 0 ||
        consecutiveForceResetsWithNoSends >= DEAD_LINK_CONSECUTIVE_RESETS_FOR_REINIT
      ) {
        fireEarlyShutdown(`visibility-dead-link-${source}`);
        void attemptBridgeReinit(`visibility-dead-link-${source}`);
        return;
      }
    }
    pendingRecoveryRefreshTimeout = setTimeout(() => {
      pendingRecoveryRefreshTimeout = null;
      // Force a full repaint of text + board after resume. This repairs stale/lost frames without changing layout.
      forceNextDisplayRefresh = true;
      latestState = store.getState();
      scheduleDisplayFlush();
    }, 0);
    if (PERF_FLUSH_LOGGING) {
      perfLogLazy(() => `[Perf][Bridge][Lifecycle] ${source} force-refresh=y`);
    }
  }

  function handleSystemLifecycleSysEvent(event: EvenHubEvent): void {
    const sysEvent = event.sysEvent;
    if (!sysEvent) return;
    const rawType = sysEvent.eventType;
    perfLogLazy(
      () => `[Perf][SysEvent] eventType=${formatSysEventName(rawType)} raw=${rawType == null ? 'undefined' : String(rawType)}`,
    );

    if (rawType === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
      hub.notifySystemLifecycleEvent('foreground-exit');
      return;
    }

    const abnormalExitType = (OsEventTypeList as unknown as { ABNORMAL_EXIT_EVENT?: number }).ABNORMAL_EXIT_EVENT;
    if (typeof abnormalExitType === 'number' && rawType === abnormalExitType) {
      hub.notifySystemLifecycleEvent('abnormal-exit');
      return;
    }

    if (rawType === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
      triggerForegroundEnterRecoveryRefresh('foreground-enter');
    }
  }

  function handleHubEvent(event: EvenHubEvent): void {
    handleSystemLifecycleSysEvent(event);
    const eventReceivedAtMs = perfNowMs();
    const action = mapEvenHubEvent(event, store.getState());
    if (action) {
      if (SUSPENSION_GUARD_ENABLED && !isKeepAliveActive()) {
        activateKeepAlive();
      }
      switch (action.type) {
        case 'SCROLL':
          perfLastInputAtMs = eventReceivedAtMs;
          perfLastInputSeq++;
          perfLastInputLabel = `SCROLL:${action.direction}`;
          break;
        case 'TAP':
        case 'DOUBLE_TAP':
          perfLastInputAtMs = eventReceivedAtMs;
          perfLastInputSeq++;
          perfLastInputLabel = action.type;
          break;
      }
      dispatchWithPerfSource('input', action);
    }
  }

  // Debounced to the next tick only: coalesces same-tick reducer churn while keeping input latency low.
  const DISPLAY_DEBOUNCE_MS = 0;
  let latestState = store.getState();

  function scheduleDisplayFlush(): void {
    if (exitInProgress || bridgeReinitInProgress) return;
    if (!startupFlushArmed) {
      startupPendingFlush = true;
      return;
    }
    if (pendingUpdateTimeout !== null) return;
    pendingUpdateTimeout = setTimeout(() => {
      pendingUpdateTimeout = null;
      void flushDisplayUpdate();
    }, DISPLAY_DEBOUNCE_MS);
  }

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

    if (state.history.length === 0 && prevState.history.length > 0) {
      clearDeferredAutosave();
    }

    // Auto-save after moves
    if (state.history.length > prevState.history.length && state.history.length > 0) {
      queueDeferredAutosave(state);
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

    // Branding is synced to desired state (normal/check/checkmate); non-critical updates may be deferred while busy.
    trySyncBrandingMode(state);

    handleMenuSideEffects(state, prevState, chess, hub);

    // Bullet mode timer
    if (state.mode === 'bullet' && state.timerActive && !timerInterval) {
      timerInterval = setInterval(() => {
        dispatchWithPerfSource('timer', { type: 'TIMER_TICK' });
      }, 100);
    } else if ((!state.timerActive || state.mode !== 'bullet') && timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    // Schedule debounced display update
    scheduleDisplayFlush();
  });

  hub.subscribeImageInterruption((active) => {
    if (active) {
      const recentRecoveryCount = recentHangRecoveryTimestamps.filter(
        (ts) => perfNowMs() - ts < VISIBILITY_RECENT_RECOVERY_WINDOW_MS,
      ).length;
      if (SUSPENSION_GUARD_ENABLED && recentRecoveryCount > 0 && !bridgeReinitInProgress && !exitInProgress) {
        fireEarlyShutdown('interrupt-after-recent-recovery');
        void attemptBridgeReinit('interrupt-after-recent-recovery');
        return;
      }
      armTransportOnlyHangProbe('image-interruption');
      return;
    }
    clearTransportHangProbe();
    forceNextDisplayRefresh = true;
    latestState = store.getState();
    scheduleDisplayFlush();
  });

  try {
    // Only block first paint on hub; engine init runs in background (fallback moves until ready).
    // Store + input subscriptions are already installed, but startupFlushArmed keeps runtime flushes from racing startup paint.
    await hub.init();
    hub.subscribeEvents(handleHubEvent);
    void turnLoop.init();

    const startupPage = composeStartupPage(store.getState());
    const setupOk = await Promise.race<boolean>([
      hub.setupPage(startupPage),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), BRIDGE_REINIT_SETUP_PAGE_TIMEOUT_MS)),
    ]);
    if (!setupOk) {
      if (SUSPENSION_GUARD_ENABLED) {
        fireEarlyShutdown('startup-setupPage-failed');
        setTimeout(() => {
          void attemptBridgeReinit('startup-setupPage-failed');
        }, BRIDGE_REINIT_FAILED_COOLDOWN_MS);
      }
      return;
    }

    // Keep startup fast: render immediately in parallel with setupPage, then re-check state before send.
    const renderState = store.getState();
    let initialImages = boardRenderer.renderFull(renderState, chess);

    const latestBeforeInitialSend = store.getState();
    latestState = latestBeforeInitialSend;
    if (latestBeforeInitialSend !== renderState) {
      // Early input can change selection/menu state during startup. Re-render so the first frame matches latest state.
      initialImages = boardRenderer.renderFull(latestBeforeInitialSend, chess);
    }

    console.log('[EvenChess] Sending initial board images:', initialImages.length);
    // Queue both halves immediately after page setup; SDK still serializes transfer, but this removes extra app-side handoff delay.
    await hub.updateBoardImages(initialImages, { kind: 'board' });
    hub.updateBoardImage(renderBrandingImage(), { priority: 'low', kind: 'branding' }).catch((err) =>
      console.error('[EvenChess] Branding image failed:', err),
    );
  } catch (err) {
    console.error('[EvenChess] Initialization failed:', err);
  } finally {
    if (SUSPENSION_GUARD_ENABLED) {
      setupVisibilityListener();
      startHeartbeat();
    }
    startupFlushArmed = true;
    if (startupPendingFlush) {
      startupPendingFlush = false;
      scheduleDisplayFlush();
    }
  }

  /** Reducer handles state transitions; this handles external side effects. */
  function handleMenuSideEffects(
    state: GameState,
    prevState: GameState,
    chess: ChessService,
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
      dispatchWithPerfSource('app', { type: 'NEW_GAME' });
      dispatchWithPerfSource('app', {
        type: 'REFRESH',
        ...chess.getStateSnapshot(),
      });
      console.log('[EvenChess] Game reset');
    }

    if (prevState.gameOver && !state.gameOver) {
      chess.reset();
      dispatchWithPerfSource('app', {
        type: 'REFRESH',
        ...chess.getStateSnapshot(),
      });
    }

    if (prevState.phase === 'bulletSetup' && state.phase === 'idle' && state.mode === 'bullet') {
      chess.reset();
      dispatchWithPerfSource('app', {
        type: 'REFRESH',
        ...chess.getStateSnapshot(),
      });
    }

    if (prevState.phase === 'exitConfirm' && state.phase === 'idle') {
      if (prevState.hasUnsavedChanges && !state.hasUnsavedChanges) {
        clearDeferredAutosave();
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
    if (exitInProgress) return;
    exitInProgress = true;
    console.log('[EvenChess] Shutting down...');
    startupFlushArmed = false;
    startupPendingFlush = false;
    stopHeartbeat();
    teardownVisibilityListener();
    clearTransportHangProbe();
    deactivateKeepAlive();

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
    if (pendingAutosaveTimeout) {
      clearTimeout(pendingAutosaveTimeout);
      pendingAutosaveTimeout = null;
    }
    if (pendingRecoveryRefreshTimeout) {
      clearTimeout(pendingRecoveryRefreshTimeout);
      pendingRecoveryRefreshTimeout = null;
    }
    flushDeferredAutosave({ dispatchMarkSaved: false });

    turnLoop.destroy();

    try {
      await hub.shutdown();
    } catch (err) {
      console.error('[EvenChess] Shutdown error:', err);
    } finally {
      exitInProgress = false;
    }
  }

  let lastSentState = store.getState();
  let lastSentText = '';

  /** Speculative cache: pre-rendered next/prev selection so scrolls can reuse already-encoded halves. */
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
  let drillCacheRefillSeq = 0;
  let boardCacheRefillSeq = 0;

  // Drill cache refill runs opportunistically during idle time and drops stale work via sequence/state checks.
  function scheduleDrillCacheRefill(state: GameState): void {
    const academy = state.academyState;
    if (state.phase !== 'coordinateDrill' || !academy) return;
    const seq = ++drillCacheRefillSeq;
    const f = academy.cursorFile;
    const r = academy.cursorRank;
    const axis = academy.navAxis;
    const nextPos = moveCursorAxis(f, r, axis, 'down');
    const prevPos = moveCursorAxis(f, r, axis, 'up');
    const run = (): void => {
      if (seq !== drillCacheRefillSeq || flushInProgress || state !== latestState) return;
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

  /** For two-half updates in selection phases:
   * - Usually send the half WITH the destination X first (faster perceived tap/scroll feedback).
   * - On cross-half destination transitions, optionally send the clear half first to avoid transient double-X artifacts.
   * - In pieceSelect (no destination X), send the selected-piece half first.
   * - On cross-half piece selection transitions, optionally clear the old selection half first to avoid duplicate squares. */
  function orderImagesSelectionFirst(
    images: ImageRawDataUpdate[],
    state: GameState,
    clearMarkerHalfFirst = false,
  ): ImageRawDataUpdate[] {
    if (images.length !== 2) return images;
    const topId = images.find((u) => u.containerID === CONTAINER_ID_IMAGE_TOP);
    const bottomId = images.find((u) => u.containerID === CONTAINER_ID_IMAGE_BOTTOM);
    if (!topId || !bottomId) return images;
    const piece = getSelectedPiece(state);
    const move = getSelectedMove(state);
    const destSquare =
      (state.phase === 'promotionSelect' && state.pendingPromotionMove
        ? state.pendingPromotionMove.to
        : state.phase === 'destSelect'
          ? move?.to
          : null);
    if (destSquare) {
      const displayRank = 8 - parseInt(destSquare[1] ?? '1', 10);
      const halfWithX = rankHalf(displayRank);
      if (clearMarkerHalfFirst) {
        // Cross-half destination change: clear the old-X half first to avoid transient double-X.
        return halfWithX === 'top' ? [bottomId, topId] : [topId, bottomId];
      }
      // Normal case: show the new destination X as early as possible.
      return halfWithX === 'top' ? [topId, bottomId] : [bottomId, topId];
    }
    const square = piece?.square ?? 'e4';
    const displayRank = 8 - parseInt(square[1] ?? '1', 10);
    const half = rankHalf(displayRank);
    if (clearMarkerHalfFirst) {
      // Cross-half selected-piece change: clear the old selection square first to avoid transient duplicates.
      return half === 'top' ? [bottomId, topId] : [topId, bottomId];
    }
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

  /** For 2-half move commits (player or engine), send the destination half first for faster perceived piece movement. */
  function orderImagesMoveDestinationFirst(images: ImageRawDataUpdate[], state: GameState): ImageRawDataUpdate[] {
    if (images.length !== 2) return images;
    const lastMoveTo = state.lastMoveToSquare;
    if (!lastMoveTo) return images;
    const top = images.find((u) => u.containerID === CONTAINER_ID_IMAGE_TOP);
    const bottom = images.find((u) => u.containerID === CONTAINER_ID_IMAGE_BOTTOM);
    if (!top || !bottom) return images;
    const displayRank = 8 - parseInt(lastMoveTo[1] ?? '1', 10);
    return rankHalf(displayRank) === 'top' ? [top, bottom] : [bottom, top];
  }

  /** True when destination X moved from one board half to the other (e.g. B5→B1). Device may show both X's during update. */
  function isCrossHalfDestTransition(prev: GameState, state: GameState): boolean {
    if (state.phase !== 'destSelect' && state.phase !== 'promotionSelect') return false;
    const prevDest = prev.phase === 'destSelect' ? getSelectedMove(prev)?.to : prev.pendingPromotionMove?.to;
    const currDest = state.phase === 'destSelect' ? getSelectedMove(state)?.to : state.pendingPromotionMove?.to;
    if (!prevDest || !currDest || prevDest === currDest) return false;
    const prevRank = 8 - parseInt(prevDest[1] ?? '1', 10);
    const currRank = 8 - parseInt(currDest[1] ?? '1', 10);
    const prevHalf = rankHalf(prevRank);
    const currHalf = rankHalf(currRank);
    return prevHalf !== currHalf;
  }

  /** True when selected piece highlight moved between board halves during piece selection. */
  function isCrossHalfPieceSelectionTransition(prev: GameState, state: GameState): boolean {
    if (prev.phase !== 'pieceSelect' || state.phase !== 'pieceSelect') return false;
    const prevSquare = getSelectedPiece(prev)?.square;
    const currSquare = getSelectedPiece(state)?.square;
    if (!prevSquare || !currSquare || prevSquare === currSquare) return false;
    const prevRank = 8 - parseInt(prevSquare[1] ?? '1', 10);
    const currRank = 8 - parseInt(currSquare[1] ?? '1', 10);
    return rankHalf(prevRank) !== rankHalf(currRank);
  }

  /** Hook for temporary artifact workarounds (kept as a no-op now for clarity/documentation). */
  function maybeDuplicateClearHalf(
    images: ImageRawDataUpdate[],
    _state: GameState,
    _prev: GameState,
  ): ImageRawDataUpdate[] {
    return images;
  }

  function scheduleBoardCacheRefill(state: GameState): void {
    if (state.phase !== 'pieceSelect' && state.phase !== 'destSelect') return;
    const seq = ++boardCacheRefillSeq;
    const pieces = state.pieces;
    if (pieces.length === 0) return;
    const run = async (): Promise<void> => {
      if (seq !== boardCacheRefillSeq || flushInProgress || state !== latestState) return;
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
      // Serialize refill renders because BoardRenderer is stateful and shares working buffers.
      // (A dedicated renderer instance would be cleaner but this keeps memory/complexity lower.)
      const nextImages = await boardRenderer.renderPngAsync(nextState, chess, 2);
      const prevImages = await boardRenderer.renderPngAsync(prevState, chess, 2);
      if (seq !== boardCacheRefillSeq) return;
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
    if (exitInProgress || bridgeReinitInProgress) return;
    // Flush is the hot path from reducer state to G2 containers.
    // We serialize it because BLE/image transport is slow and out-of-order image sends cause visual artifacts.
    if (flushInProgress) {
      pendingFlushState = latestState;
      return;
    }
    flushInProgress = true;

    // #region agent log
    const flushStartMs = perfNowMs();
    debugLog('flush start', { queueDepth: hub.getImageQueueDepth() }, 'H4');
    // #endregion

    try {
      const state = latestState;
      const prev = lastSentState;
      const forceRecoveryRefresh = forceNextDisplayRefresh;
      const flushStartedAtMs = perfNowMs();
      const perfInputAtMs = perfLastInputAtMs;
      const perfInputSeq = perfLastInputSeq;
      const perfInputLabel = perfLastInputLabel;
      const perfDispatch = getLastPerfDispatchTrace();
      const flushStartBoardHealth = hub.getBoardSendHealth();
      let perfTextSendMs = 0;
      let perfImageBuildMs = 0;
      let perfImageSendMs = 0;
      let perfImageCount = 0;
      let perfImageSource = 'none';
      let textChanged = false;
      let perfLinkState = flushStartBoardHealth.degraded ? 'degraded' : 'healthy';
      let perfBoardBusyState = flushStartBoardHealth.boardBusy ? 'y' : 'n';

      // Display diff is intentionally broader than board/FEN changes because text-only updates (menus/timers/engine state)
      // must not be dropped while a long image flush is in flight.
      const displayChanged =
        forceRecoveryRefresh ||
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
        forceRecoveryRefresh ||
        state.fen !== prev.fen ||
        state.showBoardMarkers !== prev.showBoardMarkers ||
        state.selectedPieceId !== prev.selectedPieceId ||
        state.selectedMoveIndex !== prev.selectedMoveIndex ||
        state.phase !== prev.phase ||
        drillCursorChanged;

      const text = getCombinedDisplayText(state);
      let textPromise: Promise<boolean> | undefined;
      if (forceRecoveryRefresh || text !== lastSentText) {
        lastSentText = text;
        textChanged = true;
        const textSendStartedAtMs = perfNowMs();
        textPromise = hub.updateText(CONTAINER_ID_TEXT, CONTAINER_NAME_TEXT, text).then(
          (result) => {
            perfTextSendMs = perfNowMs() - textSendStartedAtMs;
            // #region agent log
            debugLog('flush text sent', { sendMs: perfTextSendMs }, 'H4b');
            // #endregion
            return result;
          },
          (err) => {
            perfTextSendMs = perfNowMs() - textSendStartedAtMs;
            throw err;
          },
        );
      }

      try {
        const imagePromise = boardMayHaveChanged
          ? (async () => {
              const imageBuildStartedAtMs = perfNowMs();
              let dirtyImages: ImageRawDataUpdate[];
              let crossHalfSelectionTransition = false;
              if (forceRecoveryRefresh) {
                perfImageSource = 'recovery-full';
                dirtyImages = boardRenderer.renderFull(state, chess);
              } else if (isCoordDrill && state.academyState) {
                perfImageSource = 'drill-coord';
                const cf = state.academyState.cursorFile;
                const cr = state.academyState.cursorRank;
                const key = drillCacheKey(cf, cr);
                const useNext = drillCache.nextKey === key && drillCache.nextImages.length > 0;
                const usePrev = drillCache.prevKey === key && drillCache.prevImages.length > 0;
                if (useNext) {
                  perfImageSource = 'drill-coord-cache-next';
                  dirtyImages = drillCache.nextImages;
                } else if (usePrev) {
                  perfImageSource = 'drill-coord-cache-prev';
                  dirtyImages = drillCache.prevImages;
                } else {
                  dirtyImages = boardRenderer.renderDrillBoard(cf, cr);
                }
                if (!useNext && !usePrev) scheduleDrillCacheRefill(state);
              } else if (isKnightDrill && state.academyState?.knightPath) {
                perfImageSource = 'drill-knight';
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
                perfImageSource = 'drill-fen';
                dirtyImages = boardRenderer.renderFromFen(state.academyState.tacticsPuzzle.fen);
              } else if (isPgnStudy && state.academyState?.pgnStudy) {
                perfImageSource = 'pgn-fen';
                const pgn = state.academyState.pgnStudy;
                const pgnFen = getPgnPositionFen(chess, pgn.moves.slice(0, pgn.currentMoveIndex));
                dirtyImages = boardRenderer.renderFromFen(pgnFen);
              } else if (wasDrillMode && !isDrillMode) {
                perfImageSource = 'drill-exit-full';
                dirtyImages = boardRenderer.renderFull(state, chess);
              } else {
                const key = boardCacheKey(state);
                const crossHalfDest = isCrossHalfDestTransition(prev, state);
                const crossHalfPieceSelection = isCrossHalfPieceSelectionTransition(prev, state);
                // When cross-half, skip cache so we get both halves (cache/refill can have only the dirty half).
                crossHalfSelectionTransition = crossHalfDest || crossHalfPieceSelection;
                const useNext = !crossHalfSelectionTransition && boardCache.nextKey === key && boardCache.nextImages.length > 0;
                const usePrev = !crossHalfSelectionTransition && boardCache.prevKey === key && boardCache.prevImages.length > 0;
                const speedFirstCrossHalfSelection =
                  SPEED_FIRST_CROSS_HALF_SELECTION &&
                  crossHalfDest &&
                  (state.phase === 'destSelect' || state.phase === 'promotionSelect');
                if (useNext || usePrev) {
                  perfImageSource = useNext ? 'board-cache-next' : 'board-cache-prev';
                  dirtyImages = useNext ? boardCache.nextImages : boardCache.prevImages;
                  boardRenderer.setStateForCache(state);
                } else {
                  if (speedFirstCrossHalfSelection) {
                    perfImageSource = 'board-png-crosshalf-speed';
                    dirtyImages = await boardRenderer.renderPngAsync(state, chess, 0);
                  } else if (crossHalfSelectionTransition) {
                    perfImageSource = 'board-bmp-force-both';
                    // Use render with forceBothHalves (no buffer re-init) instead of renderFull for less delay.
                    dirtyImages = boardRenderer.render(state, chess, true);
                  } else {
                    perfImageSource = 'board-png-live';
                    // Prefer PNG for live board updates to reduce BLE payload; BoardRenderer falls back to BMP when needed.
                    dirtyImages = await boardRenderer.renderPngAsync(state, chess, 0);
                  }
                }
                // Fallback: if we still have only one image on cross-half (e.g. stale cache path), force both halves.
                if (crossHalfSelectionTransition && !speedFirstCrossHalfSelection && dirtyImages.length === 1) {
                  perfImageSource = 'board-bmp-force-both-fallback';
                  dirtyImages = boardRenderer.render(state, chess, true);
                }
                if (state.phase === 'pieceSelect' || state.phase === 'destSelect' || state.phase === 'promotionSelect') {
                  // Cross-half selection marker transitions (selected piece or destination X) must clear the old marker half first.
                  dirtyImages = orderImagesSelectionFirst(dirtyImages, state, crossHalfSelectionTransition);
                  dirtyImages = maybeDuplicateClearHalf(dirtyImages, state, prev);
                } else {
                  dirtyImages = orderImagesTopFirst(dirtyImages);
                }
                scheduleBoardCacheRefill(state);
              }
              perfImageCount = dirtyImages.length;
              perfImageBuildMs = perfNowMs() - imageBuildStartedAtMs;
              // #region agent log
              debugLog('flush images built', { buildMs: perfImageBuildMs, imageCount: dirtyImages.length }, 'H4b');
              // #endregion
              const imageSendStartedAtMs = perfNowMs();
              // Sample current transport health right before sending images. This drives adaptive tradeoffs below.
              const boardSendHealth = hub.getBoardSendHealth();
              const boardLinkDegraded = boardSendHealth.degraded;
              perfLinkState = boardLinkDegraded ? 'degraded' : 'healthy';
              perfBoardBusyState = boardSendHealth.boardBusy ? 'y' : 'n';
              // When queue already has unsent images, do not enqueue more: avoids out-of-order delivery
              // (double X when selection moves top half → bottom half) and queue buildup that can freeze the app.
              const queueDepth = hub.getImageQueueDepth();
              if (queueDepth > 0 && !forceRecoveryRefresh) {
                perfImageSendMs = 0;
                // #region agent log
                debugLog('flush images skipped (queue busy)', { queueDepth, imageCount: dirtyImages.length }, 'H4b');
                // #endregion
              } else {
              const boardSendMeta: BoardImageSendMeta = forceRecoveryRefresh
                ? { kind: 'board', priority: 'high', interruptProtected: true }
                : { kind: 'board' };
              const isTwoHalfSelectionScroll =
                perfDispatch.source === 'input' &&
                perfDispatch.actionType === 'SCROLL' &&
                (state.phase === 'pieceSelect' || state.phase === 'destSelect' || state.phase === 'promotionSelect') &&
                dirtyImages.length === 2;
              const selectionScrollBoardBusy = isTwoHalfSelectionScroll && boardSendHealth.boardBusy;
              // Cross-half marker transitions are ordered "clear old half first"; head-only would hide the marker entirely.
              const selectionScrollPreferHeadOnly =
                isTwoHalfSelectionScroll &&
                !crossHalfSelectionTransition &&
                (selectionScrollBoardBusy || boardLinkDegraded);
              // Cross-half destination X transitions benefit from "show new X half first", but only when not already congested.
              const useSpeedFirstTail =
                SPEED_FIRST_CROSS_HALF_SELECTION &&
                isCrossHalfDestTransition(prev, state) &&
                (state.phase === 'destSelect' || state.phase === 'promotionSelect') &&
                dirtyImages.length === 2 &&
                !selectionScrollPreferHeadOnly;
              // Selection scrolls can use the same speed-first tail strategy when both halves changed.
              const useSpeedFirstSelectionScrollTail =
                isTwoHalfSelectionScroll &&
                !selectionScrollPreferHeadOnly;
              // When the link is busy/degraded, selection scrolls can send only the priority half (except cross-half marker moves).
              const useSpeedFirstSelectionScrollHeadOnly =
                isTwoHalfSelectionScroll &&
                selectionScrollPreferHeadOnly;
              // 2-half move commits (player/engine) send the destination half first to make the piece appear sooner.
              const useSpeedFirstMoveCommit =
                SPEED_FIRST_CROSS_HALF_MOVE_COMMIT &&
                !boardLinkDegraded &&
                state.phase === 'idle' &&
                state.fen !== prev.fen &&
                state.lastMoveToSquare !== prev.lastMoveToSquare &&
                !!state.lastMoveToSquare &&
                dirtyImages.length === 2;
              if (useSpeedFirstMoveCommit) {
                dirtyImages = orderImagesMoveDestinationFirst(dirtyImages, state);
              }
              if (useSpeedFirstSelectionScrollHeadOnly) {
                const reason = selectionScrollBoardBusy ? 'busy' : 'degraded';
                perfImageSource = `${perfImageSource}+head-only-${reason}`;
                const [firstImage] = dirtyImages;
                if (firstImage) {
                  perfImageCount = 1;
                  await sendImages(hub, [firstImage], boardSendMeta);
                } else {
                  perfImageCount = 0;
                }
              } else if (useSpeedFirstTail || useSpeedFirstSelectionScrollTail || useSpeedFirstMoveCommit) {
                perfImageSource = `${perfImageSource}+tail-low`;
                await sendImagesSpeedFirstTail(hub, dirtyImages, boardSendMeta);
              } else {
                await sendImages(hub, dirtyImages, boardSendMeta);
              }
              perfImageSendMs = perfNowMs() - imageSendStartedAtMs;
              // #region agent log
              debugLog('flush images sent', { sendMs: perfImageSendMs }, 'H4b');
              // #endregion
              }
            })()
          : Promise.resolve();

        // Do not await text or image: when BLE is slow, blocking freezes the UI (scroll/tap only set
        // pendingFlushState until the flush returns). Both are still sent in order; we just allow the next flush to run.
        void imagePromise?.catch((err: unknown) => console.error('[EvenChess] Image send failed:', err));
        if (textPromise) void textPromise.catch((err: unknown) => console.error('[EvenChess] Text send failed:', err));
        lastSentState = state;
        if (forceRecoveryRefresh) {
          forceNextDisplayRefresh = false;
        }

        if (PERF_FLUSH_LOGGING && (boardMayHaveChanged || textChanged)) {
          const flushEndedAtMs = perfNowMs();
          const flushTotalMs = flushEndedAtMs - flushStartedAtMs;
          const fromInputToFlushStartMs = perfInputAtMs > 0 ? flushStartedAtMs - perfInputAtMs : -1;
          const fromInputToFlushEndMs = perfInputAtMs > 0 ? flushEndedAtMs - perfInputAtMs : -1;
          perfLogLazy(
            () =>
              `[Perf][Flush] phase=${state.phase} board=${boardMayHaveChanged ? 'y' : 'n'} text=${textChanged ? 'y' : 'n'} ` +
              `source=${perfDispatch.source} action=${perfDispatch.actionType} ` +
              `link=${perfLinkState} boardBusy=${perfBoardBusyState} ` +
              `deferred=n ` +
              `imgSource=${perfImageSource} imgCount=${perfImageCount} imgBuild=${perfImageBuildMs.toFixed(1)}ms ` +
              `imgSend=${perfImageSendMs.toFixed(1)}ms textSend=${perfTextSendMs.toFixed(1)}ms ` +
              `flush=${flushTotalMs.toFixed(1)}ms input=${perfInputLabel || '-'}#${perfInputSeq} ` +
              `input->flushStart=${fromInputToFlushStartMs.toFixed(1)}ms input->flushEnd=${fromInputToFlushEndMs.toFixed(1)}ms`,
          );
        }
      } catch (err) {
        console.error('[EvenChess] Display update failed:', err);
      }
    } finally {
      flushInProgress = false;
      refreshSuccessfulSendCounters();

      // #region agent log
      const flushDurationMs = perfNowMs() - flushStartMs;
      debugLog('flush end', { durationMs: flushDurationMs, queueDepth: hub.getImageQueueDepth() }, 'H4');
      // #endregion

      // Retry any deferred branding sync after board/image work completes.
      trySyncBrandingMode(latestState);

      if (pendingFlushState) {
        const pending = pendingFlushState;
        pendingFlushState = null;
        // Re-run for the newest state reference only; intermediate states are intentionally coalesced under slow transport.
        if (pending !== lastSentState) {
          latestState = pending;
          void flushDisplayUpdate();
        }
      }
    }
  }

  console.log('[EvenChess] Initialized — ready to play.');
}
