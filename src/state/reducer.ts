/**
 * State reducer — `(state, action) => state`. Synchronous and free of I/O; it does read Date.now()
 * (clocks, phase timing) and Math.random() (Academy puzzles). The effects a state change implies
 * (moves, engine requests, saving) run in app/side-effects.ts and engine/turnloop.ts.
 *
 * Gameplay state machine (each double-tap goes back one level):
 *
 *   Idle ─scroll─▶ RowSelect ─tap─▶ PieceSelect ─tap─▶ DestSelect ─tap─▶ (PromotionSelect ─tap─▶) Idle
 *    │  ◀─dbltap──             ◀─dbltap──            ◀─dbltap──           ◀─dbltap──
 *    └─dbltap─▶ Menu (double-tap closes it)
 *
 * A tap in Idle also reaches RowSelect here, but app.ts intercepts it first to start voice input.
 */

import type { GameState, Action, PieceEntry, MenuOption, GameMode, DrillType } from './contracts';
import { CUSTOM_SKILL_LEVEL_MIN, CUSTOM_SKILL_LEVEL_MAX } from './contracts';
import {
  MENU_OPTIONS,
  MENU_OPTION_COUNT,
  MENU_INDEX,
  DIFFICULTY_OPTIONS,
  DIFFICULTY_OPTION_COUNT,
  DISPLAY_OPTIONS_OPTIONS,
  DISPLAY_OPTIONS_OPTION_COUNT,
  DISPLAY_OPTIONS_INDEX,
  PLAY_AS_OPTIONS,
  PLAY_AS_OPTION_COUNT,
  LOG_MAX_VISIBLE,
  MODE_OPTIONS,
  MODE_OPTION_COUNT,
  MODE_INDEX,
  RESET_CONFIRM_INDEX,
  TIME_CONTROLS,
  TIME_CONTROL_COUNT,
  DRILL_OPTIONS,
  DRILL_OPTION_COUNT,
  GESTURE_DISAMBIGUATION_MS,
  PROMOTION_OPTION_COUNT,
  PROMOTION_PIECE_KEYS,
} from './constants';
import { rankOfSquare, indicesToSquare, squareToIndices } from '../chess/square-utils';
import { getCandidateRows, getPiecesOnRow, getSelectedRow, getBoardViewColor } from './selectors';
import { generateRandomSquare, moveCursorAxis, getDefaultCursorPosition } from '../academy/drills';
import { generateKnightPuzzle, getKnightMoves, isValidKnightMove } from '../academy/knight';
import { getRandomTacticsPuzzle, getRandomMatePuzzle } from '../academy/puzzles';
import { getRandomFamousGame } from '../academy/pgn';
import { STARTING_FEN } from '../chess/chessservice';
import { GAME_PHASES, INVERTED_SCROLL_PHASES } from './utils';

/**
 * True when the human may begin selecting a move: it is their turn and no engine search or
 * not-yet-played move is in flight. Blocks moving the engine's pieces while it thinks, and on a
 * resumed game where the engine is still to move.
 */
function playerMayMove(state: GameState): boolean {
  return !state.engineThinking && !state.pendingMove && state.turn === state.playerColor;
}

/**
 * Bullet clock start: the clock runs from the moment the player begins their first move, whether
 * they scroll, tap, or start voice input. Returns the fields to merge (empty when not applicable).
 */
function bulletClockStart(state: GameState): Partial<GameState> {
  return state.mode === 'bullet' && state.timers && !state.timerActive
    ? { timerActive: true, lastTickTime: Date.now() }
    : {};
}

/** Fresh bullet clocks for the selected time control (empty outside Bullet mode). */
function bulletClockReset(state: GameState): Partial<GameState> {
  if (state.mode !== 'bullet') return {};
  const tc = TIME_CONTROLS[state.selectedTimeControlIndex] ?? TIME_CONTROLS[2];
  return {
    timers: { whiteMs: tc.initialMs, blackMs: tc.initialMs, incrementMs: tc.incrementMs },
    timerActive: false,
    lastTickTime: null,
  };
}

/**
 * The one definition of "start a new game" in state: used by NEW_GAME, by double-tap after game
 * over, and by starting a Bullet game. The chess board itself is reset by side-effects.ts.
 */
function startFreshGame(state: GameState): GameState {
  return {
    ...state,
    phase: 'idle',
    selectedPieceId: null,
    selectedMoveIndex: 0,
    pendingPromotionMove: null,
    selectedPromotionIndex: 0,
    history: [],
    lastMove: null,
    playerLastMoveToSquare: null,
    engineThinking: false,
    gameOver: null,
    pendingMove: null,
    hasUnsavedChanges: false,
    menuSelectedIndex: 0,
    previousPhase: null,
    logScrollOffset: 0,
    pendingReset: false,
    pendingPlayAs: null,
    bulletPausedForMenu: false,
    ...bulletClockReset(state),
  };
}

/** End the game (checkmate, draw, or flag fall): back to idle with any half-made selection cleared. */
function endGame(state: GameState, reason: string): GameState {
  return {
    ...state,
    phase: 'idle',
    gameOver: reason,
    engineThinking: false,
    selectedPieceId: null,
    selectedMoveIndex: 0,
    pendingPromotionMove: null,
    selectedPromotionIndex: 0,
  };
}

/** Apply one action. See the header for what "pure" means here and where effects run. */
export function reduce(state: GameState, action: Action): GameState {
  if (state.gameOver && action.type !== 'NEW_GAME' && action.type !== 'DOUBLE_TAP' && action.type !== 'RESTORE_STATE') {
    return state;
  }

  switch (action.type) {
    case 'SCROLL':
      return handleScroll(state, action.direction);

    case 'TAP':
      return handleTap(state);

    case 'DOUBLE_TAP':
      return handleDoubleTap(state);

    case 'PLAYER_MOVE_SAN':
      return handlePlayerMoveSan(state, action.san);

    case 'VOICE_LISTEN_START':
      if (state.phase !== 'idle' || state.gameOver || !playerMayMove(state)) {
        return state;
      }
      return {
        ...state,
        ...bulletClockStart(state),
        voice: { listening: true, status: 'Listening… speak your move', statusExpiresAt: null, pendingConfirm: null },
      };

    case 'VOICE_LISTEN_END':
      return state.voice ? { ...state, voice: { ...state.voice, listening: false } } : state;

    case 'VOICE_STATUS': {
      const listening = action.keepListening ? (state.voice?.listening ?? false) : false;
      const status = action.message ? action.message : null;
      return {
        ...state,
        voice: {
          listening,
          status,
          statusExpiresAt: status && action.durationMs ? Date.now() + action.durationMs : null,
          pendingConfirm: null,
        },
      };
    }

    case 'VOICE_STATUS_EXPIRE':
      // Ignore a stale timer: only clear the status it was scheduled for.
      return state.voice && state.voice.statusExpiresAt === action.expiresAt
        ? { ...state, voice: { ...state.voice, status: null, statusExpiresAt: null } }
        : state;

    case 'VOICE_MOVE_CANDIDATE':
      return handleVoiceMoveCandidate(state, action.move);

    case 'VOICE_CONFIRM':
      return handleVoiceConfirm(state);

    case 'VOICE_ABORT':
      return state.voice
        ? { ...state, voice: { listening: false, status: null, statusExpiresAt: null, pendingConfirm: null } }
        : state;

    case 'ENGINE_THINKING':
      return { ...state, engineThinking: true };

    case 'ENGINE_ERROR':
      return { ...state, engineThinking: false };

    case 'ENGINE_MOVE':
      return handleEngineMove(state, action);

    case 'GAME_OVER':
      return endGame(state, action.reason);

    case 'NEW_GAME':
      return startFreshGame(state);

    case 'REFRESH':
      return {
        ...state,
        fen: action.fen,
        turn: action.turn,
        pieces: action.pieces,
        inCheck: action.inCheck,
        pendingMove: null,
        hasUnsavedChanges: state.history.length > 0, // Mark as unsaved if game has moves
      };

    case 'FOREGROUND_ENTER':
    case 'FOREGROUND_EXIT':
      return state;

    case 'CLEAR_SYSTEM_EXIT_REQUEST':
      return state.pendingSystemExitDialog ? { ...state, pendingSystemExitDialog: false } : state;

    case 'RESTORE_STATE':
      // Replay the snapshot background-state.ts saved before the host moved us to a new WebView.
      // That snapshot already drops transient fields; clearing them again here is defense in depth
      // (no engine search is running in this WebView, and any pending move was lost). The caller
      // reloads the chess service from action.state.fen before the next flush.
      return {
        ...action.state,
        engineThinking: false,
        pendingMove: null,
        pendingPromotionMove: null,
        pendingSystemExitDialog: false,
        // Clear transient menu-flow flags so a snapshot captured mid-flow can't trigger a spurious
        // reset or resume on restore.
        pendingReset: false,
        pendingPlayAs: null,
        bulletPausedForMenu: false,
        // lastTickTime should be reset; the next TIMER_TICK will recompute elapsed from now.
        lastTickTime: action.state.timerActive ? Date.now() : null,
      };

    case 'SET_PLAYER_COLOR':
      return state.playerColor === action.color ? state : { ...state, playerColor: action.color };

    case 'MARK_SAVED':
      return { ...state, hasUnsavedChanges: false };

    case 'TIMER_TICK':
      return handleTimerTick(state);

    // Freeze the bullet clock while a system overlay is open. Only pauses a
    // RUNNING clock; bulletPausedForMenu records that so resume knows this clock was ticking.
    case 'BULLET_PAUSE':
      return state.mode === 'bullet' && state.timerActive && state.timers
        ? { ...state, timerActive: false, bulletPausedForMenu: true }
        : state;

    // Resume after the overlay closes. Only if this clock was paused (never starts a not-yet-started
    // clock). Reset lastTickTime so the paused span isn't charged. Guarded to a live game phase.
    case 'BULLET_RESUME':
      return state.bulletPausedForMenu && state.mode === 'bullet' && state.timers && !state.gameOver && !state.timerActive && GAME_PHASES.has(state.phase)
        ? { ...state, timerActive: true, lastTickTime: Date.now(), bulletPausedForMenu: false }
        : state;

    case 'APPLY_INCREMENT':
      return handleApplyIncrement(state, action.color);

    default:
      return state;
  }
}


/** First movable piece on a chess rank (state.pieces is file-sorted a→h). */
function firstPieceOnRow(state: GameState, rank: number): PieceEntry | null {
  return state.pieces.find((p) => rankOfSquare(p.square) === rank) ?? null;
}

/**
 * Initial piece when entering rowSelect: player's last-moved piece if it still has
 * moves (its rank becomes the active row), else the first piece in spatial order
 * (lowest rank, file a → first candidate row).
 */
function initialPieceForRowSelect(state: GameState): PieceEntry | null {
  if (state.pieces.length === 0) return null;
  if (state.playerLastMoveToSquare) {
    const found = state.pieces.find((p) => p.square === state.playerLastMoveToSquare);
    if (found) return found;
  }
  return state.pieces[0] ?? null;
}

/** Idle → rowSelect (scroll or tap), starting the bullet clock on the player's first move. */
function beginMoveSelection(state: GameState): GameState {
  if (!playerMayMove(state)) return state;
  const initial = initialPieceForRowSelect(state);
  if (!initial) return state;
  return {
    ...state,
    phase: 'rowSelect',
    selectedPieceId: initial.id,
    selectedMoveIndex: 0,
    phaseEnteredAt: Date.now(),
    ...bulletClockStart(state),
  };
}

/**
 * Scroll (swipe) handling:
 * - SCROLL_BOTTOM_EVENT → direction 'down' → next item (+1 in spatial order).
 * - SCROLL_TOP_EVENT → direction 'up' → previous item (-1).
 * - Menu and settings screens (INVERTED_SCROLL_PHASES) invert the direction first.
 * - rowSelect: order = candidate rows ascending ('down' = next = higher rank). Which way that
 *   moves on screen depends on the board's orientation (see getBoardViewColor).
 * - pieceSelect: order = movable pieces on the active row only (file a→h).
 * - destSelect: order = piece.moves (destination squares rank then file).
 */
function handleScroll(state: GameState, direction: 'up' | 'down'): GameState {
  // Invert scroll direction in settings/menu screens vs gameplay
  const d: 'up' | 'down' = INVERTED_SCROLL_PHASES.has(state.phase)
    ? (direction === 'down' ? 'up' : 'down')
    : direction;
  switch (state.phase) {
    case 'idle':
      return beginMoveSelection(state);

    case 'rowSelect': {
      const rows = getCandidateRows(state);
      if (rows.length === 0) return state;
      const cur = getSelectedRow(state);
      let idx = cur != null ? rows.indexOf(cur) : 0;
      if (idx < 0) idx = 0;
      // Candidate rows are rank-ascending. White's view has rank 8 at the top, so +1 =
      // higher rank = band moves UP the screen. When Black is drawn at the bottom (playing
      // Black, or playing White with Position: Top) the board is flipped (rank 1 at top), so
      // the step direction must invert to keep "swipe up = band moves up the screen".
      const stepDown = getBoardViewColor(state) === 'b' ? d === 'up' : d === 'down';
      const next = stepDown
        ? (idx + 1) % rows.length
        : (idx - 1 + rows.length) % rows.length;
      const piece = firstPieceOnRow(state, rows[next]!);
      return piece
        ? { ...state, selectedPieceId: piece.id, selectedMoveIndex: 0 }
        : state;
    }

    case 'pieceSelect': {
      const cur = selectedPieceEntry(state);
      if (!cur) return state;
      const rowPieces = getPiecesOnRow(state, rankOfSquare(cur.square));
      const len = rowPieces.length;
      if (len === 0) return state;
      const idx = Math.max(0, rowPieces.findIndex((p) => p.id === cur.id));
      const next = d === 'down' ? (idx + 1) % len : (idx - 1 + len) % len;
      const piece = rowPieces[next];
      return piece
        ? { ...state, selectedPieceId: piece.id, selectedMoveIndex: 0 }
        : state;
    }

    case 'destSelect': {
      const piece = selectedPieceEntry(state);
      if (!piece) return state;
      const len = piece.moves.length;
      if (len === 0) return state;
      const next = d === 'down' ? (state.selectedMoveIndex + 1) % len : (state.selectedMoveIndex - 1 + len) % len;
      return { ...state, selectedMoveIndex: next };
    }

    case 'promotionSelect': {
      const next =
        d === 'down'
          ? (state.selectedPromotionIndex + 1) % PROMOTION_OPTION_COUNT
          : (state.selectedPromotionIndex - 1 + PROMOTION_OPTION_COUNT) % PROMOTION_OPTION_COUNT;
      return { ...state, selectedPromotionIndex: next };
    }

    case 'menu': {
      const idx = state.menuSelectedIndex;
      const next =
        d === 'down'
          ? (idx + 1) % MENU_OPTION_COUNT
          : (idx - 1 + MENU_OPTION_COUNT) % MENU_OPTION_COUNT;
      return { ...state, menuSelectedIndex: next };
    }

    case 'resetConfirm':
      return { ...state, menuSelectedIndex: state.menuSelectedIndex === RESET_CONFIRM_INDEX.confirm ? RESET_CONFIRM_INDEX.cancel : RESET_CONFIRM_INDEX.confirm };

    case 'difficultySelect': {
      const idx = state.menuSelectedIndex;
      const next =
        d === 'down'
          ? (idx + 1) % DIFFICULTY_OPTION_COUNT
          : (idx - 1 + DIFFICULTY_OPTION_COUNT) % DIFFICULTY_OPTION_COUNT;
      return { ...state, menuSelectedIndex: next };
    }

    case 'customDifficultySelect': {
      // Picker bounds are clamped — no wraparound, so 9 + down stays at 9.
      // Inversion is already applied above via INVERTED_SCROLL_PHASES; here 'down' = next = higher number.
      const next = d === 'down'
        ? Math.min(CUSTOM_SKILL_LEVEL_MAX, state.customSkillLevel + 1)
        : Math.max(CUSTOM_SKILL_LEVEL_MIN, state.customSkillLevel - 1);
      return next === state.customSkillLevel ? state : { ...state, customSkillLevel: next };
    }

    case 'displayOptionsSelect': {
      const idx = state.menuSelectedIndex;
      let next =
        d === 'down'
          ? (idx + 1) % DISPLAY_OPTIONS_OPTION_COUNT
          : (idx - 1 + DISPLAY_OPTIONS_OPTION_COUNT) % DISPLAY_OPTIONS_OPTION_COUNT;
      // Markers are disabled in large-board mode — skip that row when navigating.
      if (state.boardSize === 'large' && next === DISPLAY_OPTIONS_INDEX.markers) {
        next = d === 'down'
          ? (next + 1) % DISPLAY_OPTIONS_OPTION_COUNT
          : (next - 1 + DISPLAY_OPTIONS_OPTION_COUNT) % DISPLAY_OPTIONS_OPTION_COUNT;
      }
      return { ...state, menuSelectedIndex: next };
    }

    case 'playAsSelect': {
      const idx = state.menuSelectedIndex;
      const next =
        d === 'down'
          ? (idx + 1) % PLAY_AS_OPTION_COUNT
          : (idx - 1 + PLAY_AS_OPTION_COUNT) % PLAY_AS_OPTION_COUNT;
      return { ...state, menuSelectedIndex: next };
    }

    case 'viewLog': {
      const maxMoves = Math.ceil(state.history.length / 2);
      const maxOffset = Math.max(0, maxMoves - LOG_MAX_VISIBLE);
      const newOffset =
        d === 'down'
          ? Math.min(state.logScrollOffset + 1, maxOffset)
          : Math.max(state.logScrollOffset - 1, 0);
      return { ...state, logScrollOffset: newOffset };
    }

    case 'modeSelect': {
      const idx = state.menuSelectedIndex;
      const next =
        d === 'down'
          ? (idx + 1) % MODE_OPTION_COUNT
          : (idx - 1 + MODE_OPTION_COUNT) % MODE_OPTION_COUNT;
      return { ...state, menuSelectedIndex: next };
    }

    case 'bulletSetup': {
      const idx = state.selectedTimeControlIndex;
      const next =
        d === 'down'
          ? (idx + 1) % TIME_CONTROL_COUNT
          : (idx - 1 + TIME_CONTROL_COUNT) % TIME_CONTROL_COUNT;
      return { ...state, selectedTimeControlIndex: next };
    }

    case 'academySelect': {
      const idx = state.menuSelectedIndex;
      const next =
        d === 'down'
          ? (idx + 1) % DRILL_OPTION_COUNT
          : (idx - 1 + DRILL_OPTION_COUNT) % DRILL_OPTION_COUNT;
      return { ...state, menuSelectedIndex: next };
    }

    case 'coordinateDrill': {
      if (!state.academyState) return state;
      const { file, rank } = moveCursorAxis(
        state.academyState.cursorFile,
        state.academyState.cursorRank,
        state.academyState.navAxis,
        d
      );
      return {
        ...state,
        academyState: {
          ...state.academyState,
          cursorFile: file,
          cursorRank: rank,
          feedback: 'none',
        },
      };
    }

    case 'knightPathDrill': {
      if (!state.academyState?.knightPath) return state;
      const kp = state.academyState.knightPath;
      const validMoves = getKnightMoves(kp.currentSquare);
      if (validMoves.length === 0) return state;

      const currentHighlight = indicesToSquare(
        state.academyState.cursorFile,
        state.academyState.cursorRank
      );
      const currentIdx = validMoves.indexOf(currentHighlight.toLowerCase());
      // Cursor not on a legal move yet: the first scroll lands on the first (or last) move.
      const nextIdx = currentIdx === -1
        ? (d === 'down' ? 0 : validMoves.length - 1)
        : d === 'down'
          ? (currentIdx + 1) % validMoves.length
          : (currentIdx - 1 + validMoves.length) % validMoves.length;

      const nextSquare = validMoves[nextIdx]!;
      const [nextFile, nextRank] = squareToIndices(nextSquare);

      return {
        ...state,
        academyState: {
          ...state.academyState,
          cursorFile: nextFile,
          cursorRank: nextRank,
          feedback: 'none',
        },
      };
    }

    case 'pgnStudy': {
      if (!state.academyState?.pgnStudy) return state;
      const pgn = state.academyState.pgnStudy;
      const maxIndex = pgn.moves.length;

      let newIndex = pgn.currentMoveIndex;
      if (d === 'down') {
        newIndex = Math.min(maxIndex, newIndex + 1);
      } else {
        newIndex = Math.max(0, newIndex - 1);
      }

      if (newIndex === pgn.currentMoveIndex) return state;

      return {
        ...state,
        academyState: {
          ...state.academyState,
          pgnStudy: {
            ...pgn,
            currentMoveIndex: newIndex,
          },
        },
      };
    }

    default:
      return state;
  }
}

function handleTap(state: GameState): GameState {
  switch (state.phase) {
    case 'idle':
      return beginMoveSelection(state);

    case 'rowSelect': {
      const piece = selectedPieceEntry(state) ?? state.pieces[0];
      if (!piece) return state;
      return {
        ...state,
        phase: 'pieceSelect',
        selectedPieceId: piece.id,
        selectedMoveIndex: 0,
        phaseEnteredAt: Date.now(),
      };
    }

    case 'pieceSelect': {
      const piece = selectedPieceEntry(state) ?? state.pieces[0];
      if (!piece) return state;
      return {
        ...state,
        phase: 'destSelect',
        selectedPieceId: piece.id,
        selectedMoveIndex: 0,
      };
    }

    case 'destSelect': {
      const piece = selectedPieceEntry(state);
      if (!piece) return state;

      const move = piece.moves[state.selectedMoveIndex];
      if (!move) return state;

      // Promotion move: go to promotionSelect so user picks piece (Queen/Rook/Bishop/Knight)
      if (move.promotion) {
        return {
          ...state,
          phase: 'promotionSelect',
          pendingPromotionMove: { from: move.from, to: move.to },
          selectedPromotionIndex: 0,
        };
      }

      const newHistory = [...state.history, move.san];
      return {
        ...state,
        phase: 'idle',
        lastMove: move.san,
        playerLastMoveToSquare: move.to,
        history: newHistory,
        selectedPieceId: null,
        selectedMoveIndex: 0,
        pendingMove: move,
        hasUnsavedChanges: true,
      };
    }

    case 'promotionSelect': {
      const pm = state.pendingPromotionMove;
      if (!pm) return state;
      const promotion = PROMOTION_PIECE_KEYS[state.selectedPromotionIndex];
      if (!promotion) return state;
      const move = {
        from: pm.from,
        to: pm.to,
        uci: `${pm.from}${pm.to}${promotion}`,
        san: `${pm.to}=${promotion.toUpperCase()}`,
        promotion,
      };
      const newHistory = [...state.history, move.san];
      return {
        ...state,
        phase: 'idle',
        lastMove: move.san,
        playerLastMoveToSquare: move.to,
        history: newHistory,
        selectedPieceId: null,
        selectedMoveIndex: 0,
        pendingPromotionMove: null,
        selectedPromotionIndex: 0,
        pendingMove: move,
        hasUnsavedChanges: true,
      };
    }

    case 'menu': {
      const option = MENU_OPTIONS[state.menuSelectedIndex] ?? 'viewLog';
      return handleMenuSelect(state, option);
    }

    case 'viewLog':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.viewLog };

    case 'resetConfirm': {
      if (state.menuSelectedIndex === RESET_CONFIRM_INDEX.confirm) {
        // Confirm: commit any deferred Play As choice, then flag the reset explicitly so
        // side-effects.ts performs it (keyed on the flag, not on the resetConfirm→idle transition).
        // The NEW_GAME it dispatches clears the flag, the clock, and the menu's pause marker.
        return {
          ...state,
          playAs: state.pendingPlayAs ?? state.playAs,
          pendingPlayAs: null,
          phase: 'idle',
          previousPhase: null,
          pendingReset: true,
        };
      }
      return cancelResetConfirm(state);
    }

    case 'difficultySelect': {
      const selectedDifficulty = DIFFICULTY_OPTIONS[state.menuSelectedIndex] ?? 'casual';
      // Custom routes into a picker for the numeric level; named tiers commit directly.
      if (selectedDifficulty === 'custom') {
        return {
          ...state,
          phase: 'customDifficultySelect',
        };
      }
      return {
        ...state,
        difficulty: selectedDifficulty,
        phase: 'menu',
        menuSelectedIndex: MENU_INDEX.difficulty,
      };
    }

    case 'customDifficultySelect': {
      // Tap commits the current picker value as the active difficulty.
      return {
        ...state,
        difficulty: 'custom',
        phase: 'menu',
        menuSelectedIndex: MENU_INDEX.difficulty,
      };
    }

    case 'displayOptionsSelect': {
      // Each Display Option is binary, so a tap toggles it in place — no sub-menu. Stay on the
      // same row so the user can flip it and immediately see the effect (board re-renders behind
      // the menu). Persistence + layout side effects fire on the value change in side-effects.ts.
      const selected = DISPLAY_OPTIONS_OPTIONS[state.menuSelectedIndex];
      if (selected === 'alignment') {
        return { ...state, boardAlignment: state.boardAlignment === 'center' ? 'right' : 'center' };
      }
      if (selected === 'size') {
        return { ...state, boardSize: state.boardSize === 'small' ? 'large' : 'small' };
      }
      if (selected === 'position') {
        return { ...state, boardPosition: state.boardPosition === 'top' ? 'bottom' : 'top' };
      }
      // markers
      return { ...state, showBoardMarkers: !state.showBoardMarkers };
    }

    case 'playAsSelect': {
      const chosen = PLAY_AS_OPTIONS[state.menuSelectedIndex] ?? 'white';
      // Picking a side starts a new game (changing color mid-game is meaningless).
      const inProgress = state.history.length > 0;
      if (inProgress) {
        // Moves have been played — confirm first. Stash the choice in pendingPlayAs and commit it
        // only on confirm (resetConfirm), so cancelling leaves playAs (and its persisted value)
        // unchanged. The confirm path reuses the reset flow, whose new-game side-effect resolves
        // playerColor from the now-committed playAs and re-rolls 'random'.
        return { ...state, pendingPlayAs: chosen, phase: 'resetConfirm', menuSelectedIndex: RESET_CONFIRM_INDEX.cancel };
      }
      // Fresh board: apply immediately — the playAsSelect→idle transition is picked up by the
      // new-game side-effect.
      return { ...state, playAs: chosen, phase: 'idle', menuSelectedIndex: 0, bulletPausedForMenu: false };
    }

    case 'modeSelect': {
      const selectedMode = MODE_OPTIONS[state.menuSelectedIndex] ?? 'play';
      return handleSetMode(state, selectedMode);
    }

    case 'bulletSetup':
      return handleStartBulletGame(state, state.selectedTimeControlIndex);

    case 'academySelect': {
      const selectedDrill = DRILL_OPTIONS[state.menuSelectedIndex] ?? 'coordinate';
      return handleStartDrill(state, selectedDrill);
    }

    case 'coordinateDrill':
      return handleDrillTap(state);

    case 'knightPathDrill':
      return handleKnightPathTap(state);

    case 'tacticsDrill':
    case 'mateDrill':
      return handleTacticsTap(state);

    case 'pgnStudy':
      return handlePgnTap(state);

    default:
      return state;
  }
}

/**
 * Back out of the reset confirmation (Cancel or double-tap). Discards any deferred Play As choice
 * so the side stays unchanged, and returns to the menu item that led here.
 */
function cancelResetConfirm(state: GameState): GameState {
  const menuSelectedIndex = state.pendingPlayAs ? MENU_INDEX.playAs : MENU_INDEX.reset;
  return { ...state, pendingPlayAs: null, phase: 'menu', menuSelectedIndex };
}

function handleDoubleTap(state: GameState): GameState {
  if (state.gameOver) {
    return startFreshGame(state);
  }
  switch (state.phase) {
    case 'idle':
      return handleOpenMenu(state);

    case 'rowSelect':
      // Back out to the idle "tap to speak / scroll to begin" screen. The settings menu is one more
      // double-tap away (idle → menu).
      return { ...state, phase: 'idle', selectedPieceId: null, selectedMoveIndex: 0 };

    case 'pieceSelect': {
      // A double-tap arriving within GESTURE_DISAMBIGUATION_MS of entering pieceSelect means the
      // touchpad reported the first half of a quick double-tap as a TAP (rowSelect → pieceSelect);
      // treat the gesture as the menu double-tap. Later double-taps back up one level.
      const timeSinceEntry = Date.now() - state.phaseEnteredAt;
      if (timeSinceEntry < GESTURE_DISAMBIGUATION_MS) {
        return handleOpenMenu(state);
      }
      // Back up one level to row selection (keep selectedPieceId so the row is preserved).
      return { ...state, phase: 'rowSelect', selectedMoveIndex: 0 };
    }

    case 'destSelect':
      return { ...state, phase: 'pieceSelect', selectedMoveIndex: 0 };

    case 'promotionSelect':
      return { ...state, phase: 'destSelect', pendingPromotionMove: null };

    case 'menu':
      // Double-tap in the settings menu backs out to the game (consistent with double-tap =
      // back-one-level everywhere else). App exit is the menu's tappable "Exit" item, NOT this
      // gesture — see handleMenuSelect 'exit'. Keeping double-tap as a safe close means a stray
      // double-tap in the menu can't trip the shutDownPageContainer(1) image-channel defect.
      return handleCloseMenu(state);

    case 'viewLog':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.viewLog };

    case 'resetConfirm':
      return cancelResetConfirm(state);

    case 'difficultySelect':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.difficulty };

    case 'customDifficultySelect':
      // Back out to the tier selector with Custom highlighted so the user can re-pick.
      return {
        ...state,
        phase: 'difficultySelect',
        menuSelectedIndex: DIFFICULTY_OPTIONS.indexOf('custom'),
      };

    case 'playAsSelect':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.playAs };

    case 'displayOptionsSelect':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.displayOptions };

    case 'modeSelect':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.mode };

    case 'bulletSetup':
      return { ...state, phase: 'modeSelect', menuSelectedIndex: MODE_INDEX.bullet };

    case 'academySelect':
      return { ...state, phase: 'modeSelect', menuSelectedIndex: MODE_INDEX.academy };

    case 'coordinateDrill': {
      const academy = state.academyState;
      if (!academy || academy.drillType !== 'coordinate') {
        return { ...state, phase: 'academySelect', academyState: undefined, menuSelectedIndex: 0 };
      }
      // On row selection: double-tap → back to column selection
      if (academy.navAxis === 'rank') {
        return {
          ...state,
          academyState: { ...academy, navAxis: 'file' },
        };
      }
      // On column selection: double-tap → open academy menu
      return { ...state, phase: 'academySelect', academyState: undefined, menuSelectedIndex: 0 };
    }

    case 'tacticsDrill':
    case 'mateDrill':
    case 'knightPathDrill':
    case 'pgnStudy':
      return { ...state, phase: 'academySelect', academyState: undefined, menuSelectedIndex: 0 };

    default:
      return state;
  }
}

function handleEngineMove(
  state: GameState,
  action: Extract<Action, { type: 'ENGINE_MOVE' }>,
): GameState {
  const newHistory = [...state.history, action.san];
  return {
    ...state,
    phase: 'idle',
    fen: action.fen,
    turn: action.turn,
    pieces: action.pieces,
    inCheck: action.inCheck,
    lastMove: action.san,
    history: newHistory,
    engineThinking: false,
    selectedPieceId: null,
    selectedMoveIndex: 0,
    pendingMove: null,
    hasUnsavedChanges: true,
    ...(action.endsGame && { timerActive: false }),
  };
}

function handlePlayerMoveSan(state: GameState, san: string): GameState {
  if (!state.pendingMove || !san) return state;

  const historyLen = state.history.length;
  const lastHistorySan = historyLen > 0 ? state.history[historyLen - 1] : null;
  const sanAlreadyApplied = state.lastMove === san && lastHistorySan === san && state.pendingMove.san === san;
  if (sanAlreadyApplied) return state;

  const nextHistory =
    historyLen > 0
      ? [...state.history.slice(0, historyLen - 1), san]
      : state.history;

  return {
    ...state,
    history: nextHistory,
    lastMove: san,
    pendingMove: { ...state.pendingMove, san },
  };
}


/** True only when a voice move may be staged/committed (idle, player's turn). */
function voiceMoveAllowed(state: GameState): boolean {
  return (
    state.phase === 'idle' &&
    !state.gameOver &&
    !state.engineThinking &&
    !state.pendingMove &&
    state.turn === state.playerColor
  );
}

/** A matched move is parked for explicit confirmation — not played yet. */
function handleVoiceMoveCandidate(state: GameState, move: GameState['pendingMove']): GameState {
  if (!move || !voiceMoveAllowed(state)) return state;
  return {
    ...state,
    voice: { listening: false, status: null, statusExpiresAt: null, pendingConfirm: move },
  };
}

/** User tapped to confirm the parked move — commit it like a manual move. */
function handleVoiceConfirm(state: GameState): GameState {
  const move = state.voice?.pendingConfirm;
  if (!move || !voiceMoveAllowed(state)) return state;
  const newHistory = [...state.history, move.san];
  return {
    ...state,
    phase: 'idle',
    lastMove: move.san,
    playerLastMoveToSquare: move.to,
    history: newHistory,
    selectedPieceId: null,
    selectedMoveIndex: 0,
    pendingMove: move,
    hasUnsavedChanges: true,
    voice: { listening: false, status: `Played ${move.san}`, statusExpiresAt: Date.now() + 2500, pendingConfirm: null },
  };
}

function selectedPieceEntry(state: GameState): PieceEntry | null {
  if (!state.selectedPieceId) return null;
  return state.pieces.find((p) => p.id === state.selectedPieceId) ?? null;
}


function handleOpenMenu(state: GameState): GameState {
  if (state.engineThinking) {
    return state;
  }

  const pauseBulletTimer = state.mode === 'bullet' && state.timerActive && state.timers;
  return {
    ...state,
    phase: 'menu',
    menuSelectedIndex: 0,
    // The menu opens only from gameplay (idle, or the quick double-tap in pieceSelect); closing it
    // returns there.
    previousPhase: state.phase,
    ...(pauseBulletTimer && { timerActive: false, bulletPausedForMenu: true }),
  };
}

function handleCloseMenu(state: GameState): GameState {
  // Resume only a clock the menu actually paused (bulletPausedForMenu), never start one that
  // wasn't running when the menu opened.
  const resumeBulletTimer =
    state.bulletPausedForMenu && state.mode === 'bullet' && state.timers && !state.gameOver &&
    state.previousPhase !== null && GAME_PHASES.has(state.previousPhase);
  return {
    ...state,
    phase: state.previousPhase ?? 'idle',
    menuSelectedIndex: 0,
    previousPhase: null,
    bulletPausedForMenu: false,
    ...(resumeBulletTimer && { timerActive: true, lastTickTime: Date.now() }),
  };
}

function handleMenuSelect(state: GameState, option: MenuOption): GameState {
  switch (option) {
    case 'mode':
      return {
        ...state,
        phase: 'modeSelect',
        menuSelectedIndex: MODE_OPTIONS.indexOf(state.mode),
      };

    case 'displayOptions':
      return {
        ...state,
        phase: 'displayOptionsSelect',
        menuSelectedIndex: 0,
      };

    case 'viewLog': {
      // Start at the end so most recent moves are visible
      const maxMoves = Math.ceil(state.history.length / 2);
      const initialOffset = Math.max(0, maxMoves - LOG_MAX_VISIBLE);
      return { ...state, phase: 'viewLog', logScrollOffset: initialOffset };
    }

    case 'difficulty': {
      const idx = DIFFICULTY_OPTIONS.indexOf(state.difficulty);
      return {
        ...state,
        phase: 'difficultySelect',
        menuSelectedIndex: idx >= 0 ? idx : 0,
      };
    }

    case 'playAs': {
      const idx = PLAY_AS_OPTIONS.indexOf(state.playAs);
      return {
        ...state,
        phase: 'playAsSelect',
        menuSelectedIndex: idx >= 0 ? idx : 0,
      };
    }

    case 'reset':
      return {
        ...state,
        phase: 'resetConfirm',
        menuSelectedIndex: RESET_CONFIRM_INDEX.cancel,
      };

    case 'exit':
      // Tapping "Exit" fires the ER system exit-confirmation dialog — this is the documented
      // reference pattern for a menu-based app (ER QA guidelines name Chess: "root double-tap opens
      // an in-app menu containing an 'Exit' item that then calls shutDownPageContainer(1)"). The
      // flag is observed by side-effects.ts, which calls bridge.requestSystemExit(). Stay in the
      // menu phase so cancelling ("No") leaves the user where they were. To just close the menu and
      // return to the game, double-tap (handleDoubleTap 'menu').
      return { ...state, pendingSystemExitDialog: true };

    default:
      return state;
  }
}

/**
 * Mode menu choice. Play applies immediately (the current board continues untimed). Bullet and
 * Academy only open their setup screens: the mode is committed when a time control or drill is
 * actually started, so backing out leaves the current game, mode, and clock untouched.
 */
function handleSetMode(state: GameState, mode: GameMode): GameState {
  switch (mode) {
    case 'play':
      return {
        ...state,
        mode: 'play',
        phase: 'idle',
        timerActive: false,
        timers: undefined,
        bulletPausedForMenu: false,
        academyState: undefined,
        menuSelectedIndex: 0,
        previousPhase: null,
        logScrollOffset: 0,
      };

    case 'bullet':
      return { ...state, phase: 'bulletSetup' };

    case 'academy':
      return { ...state, phase: 'academySelect', menuSelectedIndex: 0 };

    default:
      return state;
  }
}

function handleStartBulletGame(state: GameState, timeControlIndex: number): GameState {
  return startFreshGame({ ...state, mode: 'bullet', selectedTimeControlIndex: timeControlIndex });
}

function handleTimerTick(state: GameState): GameState {
  if (!state.timerActive || !state.timers) return state;

  const now = Date.now();
  const elapsed = state.lastTickTime ? now - state.lastTickTime : 0;
  const activeColor = state.turn;
  const key = activeColor === 'w' ? 'whiteMs' : 'blackMs';
  const newTime = Math.max(0, state.timers[key] - elapsed);

  // Check for timeout
  if (newTime === 0) {
    const winner = activeColor === 'w' ? 'Black' : 'White';
    return endGame(
      { ...state, timers: { ...state.timers, [key]: 0 }, lastTickTime: now, timerActive: false },
      `${winner} wins on time!`,
    );
  }

  return {
    ...state,
    timers: { ...state.timers, [key]: newTime },
    lastTickTime: now,
  };
}

function handleApplyIncrement(state: GameState, color: 'w' | 'b'): GameState {
  if (!state.timers) return state;
  const key = color === 'w' ? 'whiteMs' : 'blackMs';
  return {
    ...state,
    timers: {
      ...state.timers,
      [key]: state.timers[key] + state.timers.incrementMs,
    },
  };
}


function handleStartDrill(prev: GameState, drillType: DrillType): GameState {
  const pos = getDefaultCursorPosition();
  const baseState = {
    drillType,
    score: { correct: 0, total: 0 },
    cursorFile: pos.file,
    cursorRank: pos.rank,
    navAxis: 'file' as const,
    feedback: 'none' as const,
  };

  // Starting a drill is what commits Academy mode (see handleSetMode); any bullet clock stops.
  const state: GameState = {
    ...prev,
    mode: 'academy',
    timers: undefined,
    timerActive: false,
    bulletPausedForMenu: false,
    logScrollOffset: 0,
  };

  switch (drillType) {
    case 'coordinate':
      return {
        ...state,
        phase: 'coordinateDrill',
        academyState: {
          ...baseState,
          targetSquare: generateRandomSquare(),
        },
      };

    case 'knightPath': {
      const puzzle = generateKnightPuzzle(2, 4);
      const cursor = firstKnightMoveCursor(puzzle.start);
      return {
        ...state,
        phase: 'knightPathDrill',
        academyState: {
          ...baseState,
          cursorFile: cursor.file,
          cursorRank: cursor.rank,
          knightPath: {
            startSquare: puzzle.start,
            targetSquare: puzzle.target,
            currentSquare: puzzle.start,
            optimalMoves: puzzle.optimalMoves,
            movesTaken: 0,
            path: [puzzle.start],
          },
        },
      };
    }

    case 'tactics': {
      const puzzle = getRandomTacticsPuzzle();
      return {
        ...state,
        phase: 'tacticsDrill',
        academyState: {
          ...baseState,
          tacticsPuzzle: puzzle,
          tacticsSolutionIndex: 0,
        },
      };
    }

    case 'mate': {
      const puzzle = getRandomMatePuzzle();
      return {
        ...state,
        phase: 'mateDrill',
        academyState: {
          ...baseState,
          tacticsPuzzle: puzzle,
          tacticsSolutionIndex: 0,
        },
      };
    }

    case 'pgn': {
      const game = getRandomFamousGame();
      return {
        ...state,
        phase: 'pgnStudy',
        academyState: {
          ...baseState,
          pgnStudy: {
            gameName: game.name,
            moves: game.moves,
            currentMoveIndex: 0,
            fen: STARTING_FEN,
            guessMode: false, // Just viewing moves, not guessing
          },
        },
      };
    }

    default:
      return state;
  }
}

function handleDrillTap(state: GameState): GameState {
  if (!state.academyState || state.academyState.drillType !== 'coordinate') {
    return state;
  }

  const academy = state.academyState;

  // After a guess, advance to next question
  if (academy.feedback !== 'none') {
    const pos = getDefaultCursorPosition();
    return {
      ...state,
      academyState: {
        ...academy,
        targetSquare: generateRandomSquare(),
        cursorFile: pos.file,
        cursorRank: pos.rank,
        navAxis: 'file',
        feedback: 'none',
      },
    };
  }

  // File axis: switch to rank axis
  if (academy.navAxis === 'file') {
    return {
      ...state,
      academyState: {
        ...academy,
        navAxis: 'rank',
      },
    };
  }

  // Rank axis: submit the guess
  const guessSquare = indicesToSquare(academy.cursorFile, academy.cursorRank);
  const targetSquare = academy.targetSquare ?? '';
  const isCorrect = guessSquare.toLowerCase() === targetSquare.toLowerCase();

  return {
    ...state,
    academyState: {
      ...academy,
      feedback: isCorrect ? 'correct' : 'incorrect',
      score: {
        correct: isCorrect ? academy.score.correct + 1 : academy.score.correct,
        total: academy.score.total + 1,
      },
    },
  };
}

/** Knight Path cursor starts on the knight's first legal move, so the first tap is a real move. */
function firstKnightMoveCursor(square: string): { file: number; rank: number } {
  const first = getKnightMoves(square)[0];
  const [file, rank] = squareToIndices(first ?? square);
  return { file, rank };
}

function handleKnightPathTap(state: GameState): GameState {
  if (!state.academyState) return state;

  const academy = state.academyState;

  if (academy.feedback !== 'none') {
    const puzzle = generateKnightPuzzle(2, 4);
    const cursor = firstKnightMoveCursor(puzzle.start);
    return {
      ...state,
      academyState: {
        ...academy,
        cursorFile: cursor.file,
        cursorRank: cursor.rank,
        feedback: 'none',
        knightPath: {
          startSquare: puzzle.start,
          targetSquare: puzzle.target,
          currentSquare: puzzle.start,
          optimalMoves: puzzle.optimalMoves,
          movesTaken: 0,
          path: [puzzle.start],
        },
      },
    };
  }

  const kp = academy.knightPath;
  if (!kp) return state;

  const moveTarget = indicesToSquare(academy.cursorFile, academy.cursorRank).toLowerCase();

  if (!isValidKnightMove(kp.currentSquare, moveTarget)) {
    return state;
  }

  const newMovesTaken = kp.movesTaken + 1;
  const newPath = [...kp.path, moveTarget];
  const newKnightPath = {
    startSquare: kp.startSquare,
    targetSquare: kp.targetSquare,
    currentSquare: moveTarget,
    optimalMoves: kp.optimalMoves,
    movesTaken: newMovesTaken,
    path: newPath,
  };

  // Reached target
  if (moveTarget === kp.targetSquare.toLowerCase()) {
    const isOptimal = newMovesTaken <= kp.optimalMoves;
    return {
      ...state,
      academyState: {
        ...academy,
        feedback: isOptimal ? 'correct' : 'incorrect',
        score: {
          correct: isOptimal ? academy.score.correct + 1 : academy.score.correct,
          total: academy.score.total + 1,
        },
        knightPath: newKnightPath,
      },
    };
  }

  // Exceeded optimal + 2 moves allowed
  if (newMovesTaken >= kp.optimalMoves + 2) {
    return {
      ...state,
      academyState: {
        ...academy,
        feedback: 'incorrect',
        score: {
          ...academy.score,
          total: academy.score.total + 1,
        },
        knightPath: newKnightPath,
      },
    };
  }

  // Continue puzzle from new position
  const cursor = firstKnightMoveCursor(moveTarget);

  return {
    ...state,
    academyState: {
      ...academy,
      cursorFile: cursor.file,
      cursorRank: cursor.rank,
      knightPath: newKnightPath,
    },
  };
}

function handleTacticsTap(state: GameState): GameState {
  if (!state.academyState) return state;

  const academy = state.academyState;
  const isMate = academy.drillType === 'mate';

  if (academy.feedback !== 'none') {
    const puzzle = isMate ? getRandomMatePuzzle() : getRandomTacticsPuzzle();
    return {
      ...state,
      academyState: {
        ...academy,
        feedback: 'none',
        tacticsPuzzle: puzzle,
        tacticsSolutionIndex: 0,
      },
    };
  }

  // Reveal answer (full interactive mode would require chess.js integration)
  return {
    ...state,
    academyState: {
      ...academy,
      feedback: 'correct',
      score: {
        ...academy.score,
        total: academy.score.total + 1,
      },
    },
  };
}

function handlePgnTap(state: GameState): GameState {
  if (!state.academyState) return state;

  const academy = state.academyState;
  const pgn = academy.pgnStudy;

  if (!pgn) return state;

  // At end of game: load next game
  if (pgn.currentMoveIndex >= pgn.moves.length) {
    const game = getRandomFamousGame();
    return {
      ...state,
      academyState: {
        ...academy,
        pgnStudy: {
          gameName: game.name,
          moves: game.moves,
          currentMoveIndex: 0,
          fen: STARTING_FEN,
          guessMode: false,
        },
        score: {
          correct: academy.score.correct + 1,
          total: academy.score.total + 1,
        },
      },
    };
  }

  // Jump to end of current game
  return {
    ...state,
    academyState: {
      ...academy,
      pgnStudy: {
        gameName: pgn.gameName,
        moves: pgn.moves,
        currentMoveIndex: pgn.moves.length,
        fen: pgn.fen,
        guessMode: pgn.guessMode,
      },
    },
  };
}
