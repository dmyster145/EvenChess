/**
 * EvenChess — Application entry point (orchestrator).
 *
 *   ChessService  →  Store  →  flush.ts → bridge.updateImage/updateText → G2 glasses
 *                       ↑                            |
 *                  InputMapper  ←  SDK Events  ←─────┘
 *
 * This file wires the modules together. Each concern lives in its own file under src/app/:
 *   - flush.ts        — single render function, debounced 16ms, latest-wins per container
 *   - branding.ts     — brand image (top of display) sync
 *   - lifecycle.ts    — visibility/foreground/wearing handling
 *   - bullet-timer.ts — TIMER_TICK interval suspend/resume
 *   - autosave.ts     — deferred per-move localStorage writes
 *   - side-effects.ts — non-render store-subscription effects
 *   - init.ts         — startup helpers (load state, text-first setup, layout upgrade)
 *   - bridge-reinit.ts — manual bridge reinit (debug-only, no auto-trigger)
 *
 * The bridge (src/evenhub/bridge.ts) is a single latest-wins per-container serial sender that
 * routes every SDK call through one Promise chain. See that file for the design notes.
 */

import { ChessService } from './chess/chessservice';
import { createStore } from './state/store';
import { buildInitialState } from './state/contracts';
import type { GameState, Action, BoardSize, BoardAlignment, DifficultyLevel } from './state/contracts';
import { mapEvenHubEvent } from './input/actions';
import { BoardRenderer } from './render/boardimage';
import { type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { TurnLoop } from './engine/turnloop';
import { PROFILE_BY_DIFFICULTY } from './engine/profiles';
import { initPersistence } from './storage/persistence';
import { EvenHubBridge } from './evenhub/bridge';
import { setBackgroundState, onBackgroundRestore } from './storage/background-state';
import { attachDebugCopyApi, debugLog, markRunStart } from './debug/logger';
import { activateKeepAlive, isKeepAliveActive } from './utils/keep-alive';
import { recordPerfDispatch } from './perf/dispatch-trace';
import { createFlush } from './app/flush';
import { createBranding } from './app/branding';
import { createBulletTimer } from './app/bullet-timer';
import { createAutosave } from './app/autosave';
import { createLifecycle, type DeviceStatusUpdate, type DeviceStatusFlags } from './app/lifecycle';
import { createSideEffects } from './app/side-effects';
import { createReinit } from './app/bridge-reinit';
import { loadInitialAppState, setupTextOnlyStartup, upgradeToFullLayout, runStorageProbe } from './app/init';

const BACKGROUND_STATE_KEY = 'evenchess';
const BACKGROUND_STATE_VERSION = 2;

type BackgroundSnapshot = {
  version: typeof BACKGROUND_STATE_VERSION;
  fen: string;
  turn: 'w' | 'b';
  difficulty: DifficultyLevel;
  boardAlignment: BoardAlignment;
  boardSize: BoardSize;
  showBoardMarkers: boolean;
};

/**
 * Whether the in-app exit dialog (shutDownPageContainer(1)) is invoked on menu double-tap.
 *
 * ENABLED — this is the ER-required exit affordance: double-tap in the settings menu surfaces the
 * system "End this feature?" dialog via `bridge.requestSystemExit()` → `shutDownPageContainer(1)`.
 *
 * KNOWN ER SDK DEFECT (reported upstream, repro is this exact code path): invoking
 * `shutDownPageContainer(1)` from the SDK's JS binding permanently destroys the
 * `updateImageRawData` BLE channel for the entire native session — `rebuildPageContainer` and
 * text keep working, every image send returns `sendFailed`, and the damage is not recoverable by
 * rebuild, bridge reinit, or WebView reload (the host keeps the BLE session across a reload).
 * The firmware's own long-press exit dialog shows the SAME dialog and does NOT break the image
 * channel — same dialog, same "No", opposite outcome — so the defect is in the SDK's
 * `shutDownPageContainer` binding, not the dialog. Apps cannot invoke the working (firmware)
 * path programmatically, so this required API is currently incompatible with image-rendering
 * apps. The lifecycle controller handles the inverted-polarity dialog events correctly
 * (sys=4 rebuild / sys=5 cancel-keep-running / sys=7 confirm) — see lifecycle.ts — so the
 * implementation is correct and ready the moment ER fixes the SDK binding.
 */
function isExitDialogEnabled(): boolean {
  return true;
}

export async function initApp(): Promise<void> {
  const chess = new ChessService();

  const bridge = new EvenHubBridge();
  await bridge.init();
  initPersistence(
    (key) => bridge.storageGet(key),
    (key, value) => bridge.storageSet(key, value),
  );
  await runStorageProbe(bridge);

  const initialState = await loadInitialAppState(chess);
  const store = createStore(initialState);
  const rendererRef: { current: BoardRenderer } = {
    current: new BoardRenderer({ largeGrid: initialState.boardSize === 'large' }),
  };
  const initialProfile = PROFILE_BY_DIFFICULTY[initialState.difficulty] ?? PROFILE_BY_DIFFICULTY['casual'];
  const turnLoop = new TurnLoop(chess, store, initialProfile);

  // Mutable flag: starts false (text-only startup), flips to true once upgradeToFullLayout
  // succeeds. flush.ts reads it via the closure to decide whether to send board images and to
  // key its text-cache against the right container width.
  let imageContainersActive = false;

  // Mutable device flags shared with lifecycle.ts (it owns the writers, flush.ts reads).
  const deviceFlags: DeviceStatusFlags = {
    isWearingGlasses: true,
    isDeviceConnected: true,
  };

  function dispatchWithPerfSource(source: 'input' | 'timer' | 'app', action: Action): void {
    recordPerfDispatch(source, action);
    store.dispatch(action);
  }

  // Module wiring. Order matters only by reference: each createX returns plain objects with no
  // active timers / subscriptions until the relevant trigger (subscribe, attach, etc.).
  const autosave = createAutosave({ store, dispatch: (a) => dispatchWithPerfSource('app', a) });
  const bulletTimer = createBulletTimer({
    store,
    onTick: () => dispatchWithPerfSource('timer', { type: 'TIMER_TICK' }),
  });
  const flush = createFlush({
    bridge,
    store,
    chess,
    getRenderer: () => rendererRef.current,
    isWearingGlasses: () => deviceFlags.isWearingGlasses,
    isDeviceConnected: () => deviceFlags.isDeviceConnected,
    imageContainersActive: () => imageContainersActive,
  });
  const branding = createBranding({
    bridge,
    store,
    imageContainersActive: () => imageContainersActive,
  });
  const lifecycle = createLifecycle({
    bridge,
    store,
    flush,
    branding,
    bulletTimer,
    autosave,
    deviceFlags,
    imageContainersActive: () => imageContainersActive,
  });
  const sideEffects = createSideEffects({
    store,
    chess,
    turnLoop,
    bridge,
    flush,
    branding,
    bulletTimer,
    autosave,
    rendererRef,
  });

  // Background-state shim. Trimmed to 6 fields per the rework plan — the prior full GameState
  // snapshot blocked the JS thread on background transitions for long games (race #8). The move
  // log is recovered from saveGame() on cold start; mid-session background restore preserves the
  // current position only, which is the right tradeoff for the phone-pickup-and-look-at-glasses
  // workflow this shim exists for.
  setBackgroundState(BACKGROUND_STATE_KEY, () => {
    const s = store.getState();
    return {
      version: BACKGROUND_STATE_VERSION,
      fen: s.fen,
      turn: s.turn,
      difficulty: s.difficulty,
      boardAlignment: s.boardAlignment,
      boardSize: s.boardSize,
      showBoardMarkers: s.showBoardMarkers,
    } satisfies BackgroundSnapshot;
  });
  onBackgroundRestore(BACKGROUND_STATE_KEY, (saved) => {
    const snap = saved as Partial<BackgroundSnapshot> | undefined;
    if (!snap || snap.version !== BACKGROUND_STATE_VERSION || !snap.fen) {
      debugLog('background-restore skipped', { reason: 'version-or-shape', version: snap?.version }, 'BG');
      return;
    }
    try {
      chess.loadFen(snap.fen);
    } catch (err) {
      console.error('[app] background-restore loadFen failed', err);
      return;
    }
    const fresh = buildInitialState(chess);
    const restored: GameState = {
      ...fresh,
      fen: snap.fen,
      turn: snap.turn ?? fresh.turn,
      difficulty: snap.difficulty ?? fresh.difficulty,
      boardAlignment: snap.boardAlignment ?? fresh.boardAlignment,
      boardSize: snap.boardSize ?? fresh.boardSize,
      showBoardMarkers: snap.showBoardMarkers ?? fresh.showBoardMarkers,
      pieces: chess.getPiecesWithMoves(),
      inCheck: chess.isInCheck(),
    };
    if (rendererRef.current.largeGrid !== (restored.boardSize === 'large')) {
      rendererRef.current = new BoardRenderer({ largeGrid: restored.boardSize === 'large' });
    }
    store.dispatch({ type: 'RESTORE_STATE', state: restored });
    flush.setForceFullRefresh();
    branding.forceNextRefresh();
  });

  attachDebugCopyApi();
  markRunStart();
  const versionEl = typeof document !== 'undefined' ? document.getElementById('app-version') : null;
  if (versionEl) versionEl.textContent = `v${__APP_VERSION__}`;

  // Subscribe to store changes — the side-effects module dispatches its own actions, then the
  // flush + branding modules schedule themselves.
  store.subscribe((state, prevState) => {
    sideEffects.onStateChange(state, prevState);
  });

  // Hub event subscription — input handler dispatches actions, lifecycle handler covers sysEvents.
  function handleHubEvent(event: EvenHubEvent): void {
    // Ground-truth raw event stream (ER guidance #7). One compact line per SDK event BEFORE any
    // handling, so a copied log shows the exact sequence + timing instead of us theorizing.
    // `?? 0` per protobuf zero-strip (CLICK/eventType=0 arrives undefined). '-' = channel absent.
    debugLog('raw', {
      sys: event.sysEvent ? (event.sysEvent.eventType ?? 0) : '-',
      text: event.textEvent ? (event.textEvent.eventType ?? 0) : '-',
      list: event.listEvent ? (event.listEvent.eventType ?? 0) : '-',
      exitPending: bridge.isExitDialogPending(),
      phase: store.getState().phase,
    }, 'EVT');

    lifecycle.onHubEvent(event);
    const action = mapEvenHubEvent(event, store.getState());
    debugLog('mapped', { action: action?.type ?? 'null' }, 'EVT');
    if (action) {
      // Menu double-tap = "show the system exit dialog" — the ER-required exit affordance,
      // invoked via bridge.requestSystemExit() → shutDownPageContainer(1). Short-circuit the
      // reducer/side-effects/flush chain so JS work is minimal around the call (mirrors the
      // firmware long-press path). requestSystemExit() arms the bridge's exitDialogPending flag
      // synchronously, so lifecycle.ts interprets the inverted-polarity dialog events correctly
      // (sys=4 dialog-shown / sys=5 cancel-keep-running / sys=7 confirm).
      //
      // See isExitDialogEnabled() above for the known ER SDK defect this code path reproduces:
      // shutDownPageContainer(1) permanently kills the updateImageRawData BLE channel for the
      // native session. The implementation here is correct per ER's spec; the failure is in the
      // SDK binding (the firmware's own long-press dialog does not exhibit it).
      const currentPhase = store.getState().phase;
      if (action.type === 'DOUBLE_TAP' && currentPhase === 'menu') {
        if (isExitDialogEnabled()) {
          debugLog('menu double-tap → requestSystemExit', {}, 'LCY');
          flush.cancel();
          branding.cancel();
          bridge.requestSystemExit();
        } else {
          debugLog('menu double-tap — exit dialog disabled', {}, 'LCY');
        }
        return;
      }

      // First user input upgrades the layout from text-only to full. Async, doesn't block the
      // dispatch — the next render after the upgrade picks up the new layout.
      if (!imageContainersActive) {
        void upgradeToFullLayout({
          bridge,
          store,
          flush,
          branding,
          imageContainersActive: () => imageContainersActive,
          setImageContainersActive: (v) => { imageContainersActive = v; },
        });
      }
      if (!isKeepAliveActive()) {
        activateKeepAlive();
      }
      dispatchWithPerfSource('input', action);
    }
  }

  bridge.subscribeEvents(handleHubEvent);
  let deviceStatusUnsubscribe: (() => void) | null = bridge.subscribeDeviceStatus((status) => {
    lifecycle.onDeviceStatusChanged(status as DeviceStatusUpdate);
  });
  let launchSourceUnsubscribe: (() => void) | null = bridge.subscribeLaunchSource((source) => {
    debugLog('launch-source', { source }, 'LCH');
  });
  void bridge.getDeviceInfo().then((info) => {
    if (info) {
      debugLog('device-info', { model: info.model, sn: info.sn, batteryLevel: info.status?.batteryLevel ?? null }, 'DEV');
    }
  });

  void turnLoop.init();

  // Reinit controller is exposed via the debug menu only. Holds references to the unsubscribe
  // setters so it can replace them after a reinit without leaking listeners.
  const reinit = createReinit({
    bridge,
    store,
    flush,
    branding,
    lifecycle,
    imageContainersActive: () => imageContainersActive,
    setImageContainersActive: (v) => { imageContainersActive = v; },
    hubEventHandler: handleHubEvent,
    deviceStatusHandler: (status) => lifecycle.onDeviceStatusChanged(status),
    setDeviceStatusUnsubscribe: (fn) => {
      deviceStatusUnsubscribe?.();
      deviceStatusUnsubscribe = fn;
    },
    setLaunchSourceUnsubscribe: (fn) => {
      launchSourceUnsubscribe?.();
      launchSourceUnsubscribe = fn;
    },
  });
  // Surface for debug menu: window.__evenchess_reinit('reason')
  if (typeof window !== 'undefined') {
    (window as unknown as { __evenchess_reinit: (reason?: string) => Promise<void> }).__evenchess_reinit =
      (reason = 'manual') => reinit.reinit(reason);
  }

  lifecycle.attach();

  // Persistent-image-failure recovery — a safety net for genuine BLE wedges (not the exit-dialog
  // case, which lifecycle.ts now handles correctly via the inverted-polarity event model). The
  // bridge fires this after consecutive non-success updateImageRawData results. Recovery: reset
  // the sender state and force-flush so the latest state is re-queued. We deliberately do NOT
  // rebuild the page here — a rebuild swaps the live image containers for empty placeholders, and
  // if the followup fills also fail the board goes blank (worse than frozen-but-visible).
  bridge.onPersistentImageFailure((failureCount) => {
    debugLog('app: persistent image failure — resetting transport and retrying flush', { failureCount }, 'BRG');
    bridge.forceResetImageTransport('persistent-failure');
    if (!imageContainersActive) return;
    flush.setForceFullRefresh();
    branding.forceNextRefresh();
    void flush.flushNow({ force: true });
    branding.syncNow();
  });

  // Text-first startup: only text + brand containers on the critical path. Image containers are
  // added by upgradeToFullLayout() once the SDK has demonstrated it can carry traffic (first
  // input or auto-upgrade below).
  const startupOk = await setupTextOnlyStartup(bridge, store);
  if (!startupOk) {
    console.error('[EvenChess] Initial setupPage failed; the app will retry via reinit on next user input.');
  } else {
    // Auto-upgrade after text-first startup so users who never tap still see the board.
    void upgradeToFullLayout({
      bridge,
      store,
      flush,
      branding,
      imageContainersActive: () => imageContainersActive,
      setImageContainersActive: (v) => { imageContainersActive = v; },
    });
  }

  console.log('[EvenChess] Initialized — ready to play.');
}
