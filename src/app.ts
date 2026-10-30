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
import type { Action } from './state/contracts';
import { mapEvenHubEvent } from './input/actions';
import { BoardRenderer } from './render/boardimage';
import { type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { TurnLoop } from './engine/turnloop';
import { getEngineProfile } from './engine/profiles';
import { initPersistence } from './storage/persistence';
import { EvenHubBridge } from './evenhub/bridge';
import { setBackgroundState, onBackgroundRestore } from './storage/background-state';
import { attachDebugCopyApi, debugLog, markRunStart } from './debug/logger';
import { initBoardSnapshot } from './debug/board-snapshot';
import { activateKeepAlive } from './utils/keep-alive';
import { recordPerfDispatch } from './perf/dispatch-trace';
import { createFlush } from './app/flush';
import { createBranding } from './app/branding';
import { createBulletTimer } from './app/bullet-timer';
import { createAutosave } from './app/autosave';
import { createLifecycle, type DeviceStatusUpdate, type DeviceStatusFlags } from './app/lifecycle';
import { createSideEffects } from './app/side-effects';
import { createVoiceController } from './voice/controller';
import { createReinit } from './app/bridge-reinit';
import { loadInitialAppState, setupTextOnlyStartup, upgradeToFullLayout, runStorageProbe } from './app/init';
import { BACKGROUND_STATE_KEY, buildBackgroundSnapshot, restoreFromBackgroundSnapshot } from './app/background-snapshot';

/**
 * App exit affordance & the ER SDK defect (for reference).
 *
 * Exit is wired per ER's QA-guidelines "Chess" reference pattern: root (idle) double-tap opens the
 * settings menu, and the menu's tappable "Exit" item fires the system exit-confirmation dialog via
 * `shutDownPageContainer(1)` (reducer sets `pendingSystemExitDialog` → side-effects.ts calls
 * `bridge.requestSystemExit()`). Double-tap inside the menu just closes it.
 *
 * KNOWN ER SDK DEFECT (reported upstream): invoking `shutDownPageContainer(1)` from the SDK's JS
 * binding permanently destroys the `updateImageRawData` BLE channel for the native session — text
 * keeps working, every image send returns `sendFailed`, and it's not recoverable by rebuild, bridge
 * reinit, or WebView reload (the host keeps the BLE session across reload; a reload also triggers a
 * spurious sys=7 that exits the app). So after the user opens the dialog and taps "No" (sys=5), the
 * board freezes on its last frame until a full app restart. lifecycle.ts therefore does NOTHING to
 * the page during the dialog (keeps the retained frame). Routing exit through the deliberate "Exit"
 * tap (instead of any double-tap) keeps a stray gesture from tripping this. The firmware long-press
 * shows the same dialog WITHOUT the defect, so the bug is the SDK binding, not the dialog.
 */

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
  const initialProfile = getEngineProfile(initialState.difficulty, initialState.customSkillLevel);
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
  // Push-to-talk voice move input. Model is bundled (offline); see public/vosk/.
  const voice = createVoiceController({ store, bridge, modelUrl: '/vosk/model.tar.gz' });

  // Background-state shim: the host carries this snapshot across its headless-WebView migration
  // (see app/background-snapshot.ts for what is kept and why).
  setBackgroundState(BACKGROUND_STATE_KEY, () => buildBackgroundSnapshot(store.getState()));
  /**
   * Ask the engine to move whenever a live game is on its turn: a new game where the human plays
   * Black, or a game restored from a save or background snapshot taken while the engine was
   * thinking (its search did not survive). The reducer blocks manual input until it replies.
   */
  function resumeEngineIfItsTurn(): void {
    const s = store.getState();
    if (s.gameOver || s.turn === s.playerColor) return;
    if (s.mode !== 'play' && s.mode !== 'bullet') return;
    void turnLoop.requestEngineMove().catch((err) => {
      console.error('[app] engine resume failed:', err);
    });
  }

  onBackgroundRestore(BACKGROUND_STATE_KEY, (saved) => {
    const restored = restoreFromBackgroundSnapshot(saved, chess);
    if (!restored) {
      debugLog('background-restore skipped', { reason: 'missing, other version, or bad position' }, 'BG');
      return;
    }
    if (rendererRef.current.largeGrid !== (restored.boardSize === 'large')) {
      rendererRef.current = new BoardRenderer({ largeGrid: restored.boardSize === 'large' });
    }
    store.dispatch({ type: 'RESTORE_STATE', state: restored });
    flush.setForceFullRefresh();
    branding.forceNextRefresh();
    resumeEngineIfItsTurn();
  });

  attachDebugCopyApi();
  initBoardSnapshot({ getState: () => store.getState(), chess });
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

    // Microphone PCM frames: route straight to the voice recognizer. No-op unless
    // a push-to-talk session is active. Bypass the input mapper / lifecycle.
    if (event.audioEvent && event.audioEvent.audioPcm != null) {
      voice.feed(event.audioEvent.audioPcm);
      return;
    }

    lifecycle.onHubEvent(event);
    const action = mapEvenHubEvent(event, store.getState());
    debugLog('mapped', { action: action?.type ?? 'null' }, 'EVT');
    if (action) {
      // App exit is the ER-required affordance, wired the way ER's QA guidelines document for a
      // menu-based app (the "Chess" reference pattern): root (idle) double-tap opens the menu, and
      // the menu's tappable "Exit" item fires the system dialog. That tap sets pendingSystemExitDialog
      // in the reducer, which side-effects.ts turns into bridge.requestSystemExit() →
      // shutDownPageContainer(1). Double-tap INSIDE the menu just closes it (reducer handleDoubleTap
      // 'menu'), so a stray double-tap can't trip the shutDownPageContainer image-channel defect.
      const currentPhase = store.getState().phase;

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
      activateKeepAlive(); // first input only; see utils/keep-alive.ts

      // Mic / pending suggestion must not survive a background. FOREGROUND_EXIT
      // still dispatches normally.
      if (action.type === 'FOREGROUND_EXIT') {
        voice.cancel();
        voice.abort();
      }

      // Push-to-talk. Tap-in-idle starts listening; scroll still opens the manual
      // carousel and double-tap still opens the menu. A matched command is parked
      // for confirmation (tap = play, double-tap = abort) so a misheard move is
      // never auto-played. If voice can't run (model not ready / unavailable)
      // start() returns false and the tap falls through to the carousel as before.
      if (voice.isListening()) {
        voice.cancel();
        if (action.type === 'TAP') return;
      } else if (voice.hasPendingConfirm()) {
        if (action.type === 'TAP') {
          voice.confirm();
          return;
        }
        if (action.type === 'DOUBLE_TAP') {
          voice.abort();
          return;
        }
        // Scroll: discard the suggestion and fall through to the manual carousel.
        voice.abort();
      } else if (action.type === 'TAP' && currentPhase === 'idle' && voice.start()) {
        return;
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

  // Cold start: the engine moves first as White when the human plays Black, and a resumed save
  // taken while the engine was thinking hands the move back to it.
  void turnLoop.init().then(resumeEngineIfItsTurn);

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
    // Verification hook: drive a transcript straight through parse→resolve→dispatch
    // (no audio), e.g. window.__evenchess_voice('knight to c3').
    (window as unknown as { __evenchess_voice: (text: string) => void }).__evenchess_voice =
      (text: string) => voice.injectTranscript(text);
    // Safety net: never leave the glasses mic open if the webview is torn down.
    window.addEventListener('pagehide', () => voice.dispose());
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

  // Warm the voice model off the critical path so the first push-to-talk tap is
  // instant. Failure is non-fatal — tap-in-idle just falls back to the carousel.
  voice.warm();

  console.log('[EvenChess] Initialized — ready to play.');
}
