/**
 * side-effects.ts — store-subscription side effects that aren't render-related.
 *
 * Pulls out of the v1 monolithic `store.subscribe(...)` block:
 * - Pending move → engine response (race #6 fix: dispatched as a regular action, not
 *   `queueMicrotask(async () => ...)` so the next render cycle naturally picks up the engine
 *   response without a microtask race against the board render)
 * - Difficulty / boardMarkers / boardSize / boardAlignment persistence + side effects
 * - Tap cooldown extension on phase changes
 * - Menu / reset / mode-switch side effects (calls into ChessService)
 * - Autosave queueing
 */

import type { Store } from '../state/store';
import type { GameState, Action, CarouselMove, UIPhase } from '../state/contracts';
import type { ChessService } from '../chess/chessservice';
import type { TurnLoop } from '../engine/turnloop';
import type { BoardRenderer } from '../render/boardimage';
import type { EvenHubBridge } from '../evenhub/bridge';
import type { FlushController } from './flush';
import type { BrandingController } from './branding';
import type { BulletTimerController } from './bullet-timer';
import type { AutosaveController } from './autosave';
import { saveGame, saveDifficulty, saveCustomSkillLevel, saveBoardMarkers, saveBoardSize, saveBoardAlignment, savePlayAs, clearSave } from '../storage/persistence';
import { resolvePlayerColor } from '../state/utils';
import { getEngineProfile } from '../engine/profiles';
import { extendTapCooldown, TAP_COOLDOWN_MENU_MS, TAP_COOLDOWN_DESTSELECT_MS } from '../input/actions';
import { composePageForState } from '../render/composer';
import { BoardRenderer as BoardRendererClass } from '../render/boardimage';

/**
 * Settings/menu phases — entering one of these from a non-settings phase (or transitioning between
 * them via a tap) extends the tap cooldown so a touchpad bounce doesn't immediately fire a second
 * action on the new phase. `viewLog` is included because tap-on-viewLog returns to menu and a
 * bounce would hide the log instantly.
 */
const SUBMENU_PHASES: ReadonlySet<UIPhase> = new Set<UIPhase>([
  'modeSelect',
  'bulletSetup',
  'academySelect',
  'difficultySelect',
  'customDifficultySelect',
  'boardMarkersSelect',
  'displayOptionsSelect',
  'boardAlignmentSelect',
  'boardSizeSelect',
  'playAsSelect',
  'resetConfirm',
  'exitConfirm',
  'viewLog',
]);

const SETTINGS_PHASES: ReadonlySet<UIPhase> = new Set<UIPhase>([
  'menu',
  ...SUBMENU_PHASES,
]);

const GAME_PHASES: ReadonlySet<UIPhase> = new Set<UIPhase>([
  'idle',
  'rowSelect',
  'pieceSelect',
  'destSelect',
  'promotionSelect',
]);

export interface SideEffectsDeps {
  store: Store;
  chess: ChessService;
  turnLoop: TurnLoop;
  bridge: EvenHubBridge;
  flush: FlushController;
  branding: BrandingController;
  bulletTimer: BulletTimerController;
  autosave: AutosaveController;
  /** Mutable container so a boardSize change can swap the renderer instance the flush uses. */
  rendererRef: { current: BoardRenderer };
}

export type SideEffectsController = {
  onStateChange(state: GameState, prevState: GameState): void;
};

export function createSideEffects(deps: SideEffectsDeps): SideEffectsController {
  function onStateChange(state: GameState, prevState: GameState): void {
    // Pending move → engine response. Race #6 fix: dispatch via the store and let the
    // turnLoop's own promise chain run; no `queueMicrotask` of an async function. The
    // turnLoop dispatches its result back into the store, which triggers the next
    // flush.schedule() naturally.
    if (state.pendingMove && !prevState.pendingMove) {
      const move = state.pendingMove;
      void turnLoopOnPlayerMoved(deps.turnLoop, move);
    }

    // System exit dialog request — fire-and-forget at the SDK level.
    if (state.pendingSystemExitDialog && !prevState.pendingSystemExitDialog) {
      deps.bridge.requestSystemExit();
      deps.store.dispatch({ type: 'CLEAR_SYSTEM_EXIT_REQUEST' });
    }

    // Autosave management.
    if (state.history.length === 0 && prevState.history.length > 0) {
      deps.autosave.clear();
    }
    if (state.history.length > prevState.history.length && state.history.length > 0) {
      deps.autosave.queue(state);
    }

    // Difficulty change → persist + reconfigure engine + persist current save.
    // Either the tier OR the custom level can change while staying on 'custom'; both need
    // to trigger an engine reconfigure since the latter alters skill/depth/movetime.
    const difficultyShapeChanged =
      state.difficulty !== prevState.difficulty ||
      (state.difficulty === 'custom' && state.customSkillLevel !== prevState.customSkillLevel);
    if (difficultyShapeChanged) {
      const profile = getEngineProfile(state.difficulty, state.customSkillLevel);
      deps.turnLoop.setProfile(profile);
      if (state.difficulty !== prevState.difficulty) {
        void saveDifficulty(state.difficulty);
      }
      if (state.customSkillLevel !== prevState.customSkillLevel) {
        void saveCustomSkillLevel(state.customSkillLevel);
      }
      if (state.history.length > 0) {
        void saveGame(state.fen, state.history, state.turn, state.difficulty, state.playerColor, state.customSkillLevel);
      }
    }

    if (state.playAs !== prevState.playAs) {
      void savePlayAs(state.playAs);
    }

    if (state.showBoardMarkers !== prevState.showBoardMarkers) {
      void saveBoardMarkers(state.showBoardMarkers);
    }

    if (state.boardSize !== prevState.boardSize) {
      void saveBoardSize(state.boardSize);
      // Small and large boards share container dimensions (200×100 each); only the cell render
      // size differs. Replacing the renderer rebuilds its internal pixel buffers at the new grid;
      // we explicitly do NOT rebuild the page (no updatePage call) since the layout is unchanged.
      // forceFullRefresh on the next flush re-renders both halves at the new size.
      deps.rendererRef.current = new BoardRendererClass({ largeGrid: state.boardSize === 'large' });
      deps.flush.setForceFullRefresh();
      deps.branding.forceNextRefresh();
    }

    if (state.boardAlignment !== prevState.boardAlignment) {
      void saveBoardAlignment(state.boardAlignment);
      // Layout changes width/position of containers; rebuild the page. The new bridge serializes
      // the rebuild against image sends internally — race #10 fix.
      void deps.bridge.updatePage(composePageForState(state));
      deps.flush.setForceFullRefresh();
      deps.branding.forceNextRefresh();
    }

    // viewLog: deliberately NOT rebuilding the page on enter/exit. The original design rebuilt
    // to widen the text container (220 → 368 px) so the move log had more breathing room, but
    // every page rebuild has the same failure mode as the dialog-bug: the SDK swaps image
    // containers to empty placeholders, and if the followup updateImageRawData fills don't all
    // succeed the board goes blank instead of just being frozen on the previous frame. The
    // narrower menu-width text container still fits the move log (~18 chars / line at the G2
    // firmware font, well above the longest move-pair line), so we just keep the menu layout.
    // Force a full re-render on exit anyway in case the underlying state changed while the log
    // was up (e.g. the engine completed a move via the bullet timer pause/resume path).
    if (prevState.phase === 'viewLog' && state.phase !== 'viewLog') {
      deps.flush.setForceFullRefresh();
    }

    // Force full refresh whenever we transition from a settings/menu phase BACK to a game phase
    // (idle/pieceSelect/destSelect/promotionSelect). The renderer's prevHighlightKeys cache may
    // be stale (e.g. after a foreground-enter forced refresh during the menu rendered the board
    // without highlights), and on resumption to a phase that DOES have highlights the diff path
    // could miss them or send the wrong half. Forcing a full re-render guarantees the user sees
    // the correct selection outline (bug #4).
    if (SETTINGS_PHASES.has(prevState.phase) && GAME_PHASES.has(state.phase)) {
      deps.flush.setForceFullRefresh();
      deps.branding.forceNextRefresh();
    }

    // Tap cooldown extension to prevent accidental inputs during phase transitions.
    if (state.phase === 'menu' && prevState.phase !== 'menu') {
      extendTapCooldown(TAP_COOLDOWN_MENU_MS);
    }
    if (state.phase === 'destSelect' && prevState.phase !== 'destSelect') {
      extendTapCooldown(TAP_COOLDOWN_DESTSELECT_MS);
    }
    if (state.phase === 'promotionSelect' && prevState.phase !== 'promotionSelect') {
      extendTapCooldown(TAP_COOLDOWN_DESTSELECT_MS);
    }
    // Settings submenu entries (e.g. menu→modeSelect, menu→difficultySelect, menu→resetConfirm)
    // need the same cooldown protection. Without this, the touchpad can fire a duplicate
    // CLICK_EVENT a few ms after the first one — the first transitions menu→submenu, the second
    // hits the submenu's TAP handler and immediately picks the default (returning to menu, or
    // worse, going back to idle in the case of mode/play). User perceives "the option doesn't
    // work" (bugs #1, #2). The 500ms cooldown is well below human "second tap" timing (~250ms+)
    // but well above SDK touchpad bounce intervals (~10–50ms).
    if (SUBMENU_PHASES.has(state.phase) && !SUBMENU_PHASES.has(prevState.phase)) {
      extendTapCooldown(TAP_COOLDOWN_MENU_MS);
    }

    // Bullet timer state machine.
    deps.bulletTimer.onStateChange();

    // Menu / reset / mode-switch side effects (calls back into ChessService).
    handleMenuSideEffects(state, prevState, deps.chess, deps.store, deps.turnLoop);

    // Branding state may have changed (gameOver, inCheck) — schedule a sync.
    deps.branding.schedule();

    // Display flush — coalesced by flush.ts's debounce.
    deps.flush.schedule();
  }

  return { onStateChange };
}

async function turnLoopOnPlayerMoved(turnLoop: TurnLoop, move: CarouselMove): Promise<void> {
  try {
    await turnLoop.onPlayerMoved(move);
  } catch (err) {
    console.error('[side-effects] TurnLoop error:', err);
  }
}

function handleMenuSideEffects(
  state: GameState,
  prevState: GameState,
  chess: ChessService,
  store: Store,
  turnLoop: TurnLoop,
): void {
  const dispatch = (action: Action): void => store.dispatch(action);

  // After a fresh board exists (chess reset + NEW_GAME/REFRESH dispatched), resolve the
  // human's color from the Play As preference ('random' re-rolls each new game). If the
  // human is Black, the engine (White) makes the opening move.
  const beginNewGame = (): void => {
    const color = resolvePlayerColor(store.getState().playAs);
    dispatch({ type: 'SET_PLAYER_COLOR', color });
    if (color === 'b') {
      void turnLoop.requestEngineMove().catch((err) => {
        console.error('[side-effects] engine opening move failed:', err);
      });
    }
  };

  // resetConfirm→idle: triggered by the Reset menu AND by a Play As change while a game
  // is in progress (playAsSelect routes through the reset confirmation).
  if (prevState.phase === 'resetConfirm' && state.phase === 'idle') {
    chess.reset();
    void clearSave();
    dispatch({ type: 'NEW_GAME' });
    dispatch({ type: 'REFRESH', ...chess.getStateSnapshot() });
    beginNewGame();
  }

  // playAsSelect→idle: Play As changed on a fresh board (no moves) — apply immediately.
  if (prevState.phase === 'playAsSelect' && state.phase === 'idle') {
    chess.reset();
    void clearSave();
    dispatch({ type: 'NEW_GAME' });
    dispatch({ type: 'REFRESH', ...chess.getStateSnapshot() });
    beginNewGame();
  }

  if (prevState.gameOver && !state.gameOver) {
    chess.reset();
    dispatch({ type: 'REFRESH', ...chess.getStateSnapshot() });
    beginNewGame();
  }

  if (prevState.phase === 'bulletSetup' && state.phase === 'idle' && state.mode === 'bullet') {
    chess.reset();
    dispatch({ type: 'REFRESH', ...chess.getStateSnapshot() });
    beginNewGame();
  }
}
