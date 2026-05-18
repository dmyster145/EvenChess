/**
 * State reducer — pure function `(state, action) => state`.
 *
 * Implements the UI state machine:
 *   Idle ─tap/scroll─▶ RowSelect ─tap─▶ PieceSelect ─tap─▶ DestSelect ─tap─▶ Idle
 *                       │ dbltap→menu     │ dbltap→RowSelect   │ dbltap→PieceSelect
 */

import type { GameState, Action, PieceEntry, UIPhase, MenuOption, GameMode, DrillType } from './contracts';
import {
  MENU_OPTIONS,
  MENU_OPTION_COUNT,
  MENU_INDEX,
  DIFFICULTY_OPTIONS,
  DIFFICULTY_OPTION_COUNT,
  BOARD_MARKERS_OPTIONS,
  BOARD_MARKERS_OPTION_COUNT,
  DISPLAY_OPTIONS_OPTIONS,
  DISPLAY_OPTIONS_OPTION_COUNT,
  BOARD_ALIGNMENT_OPTIONS,
  BOARD_ALIGNMENT_OPTION_COUNT,
  BOARD_SIZE_OPTIONS,
  BOARD_SIZE_OPTION_COUNT,
  PLAY_AS_OPTIONS,
  PLAY_AS_OPTION_COUNT,
  LOG_MAX_VISIBLE,
  MAX_HISTORY_LENGTH,
  MODE_OPTIONS,
  MODE_OPTION_COUNT,
  TIME_CONTROLS,
  TIME_CONTROL_COUNT,
  DRILL_OPTIONS,
  DRILL_OPTION_COUNT,
  GESTURE_DISAMBIGUATION_MS,
  PROMOTION_OPTION_COUNT,
  PROMOTION_PIECE_KEYS,
} from './constants';
import { rankOfSquare } from '../chess/square-utils';
import { getCandidateRows, getPiecesOnRow, getSelectedRow } from './selectors';
import { generateRandomSquare, moveCursorAxis, fileRankToSquare, getDefaultCursorPosition } from '../academy/drills';
import { generateKnightPuzzle, getKnightMoves, isValidKnightMove, getSquareIndices } from '../academy/knight';
import { getRandomTacticsPuzzle, getRandomMatePuzzle } from '../academy/puzzles';
import { getRandomFamousGame, STARTING_FEN } from '../academy/pgn';

/**
 * Pure reducer — side-effects (move execution, engine requests) are handled
 * by the store subscriber layer in app.ts.
 */
export function reduce(state: GameState, action: Action): GameState {
  if (state.gameOver && action.type !== 'NEW_GAME' && action.type !== 'OPEN_MENU' && action.type !== 'CLOSE_MENU' && action.type !== 'DOUBLE_TAP' && action.type !== 'RESTORE_STATE') {
    return state;
  }

  switch (action.type) {
    case 'SCROLL':
      return handleScroll(state, action.direction);

    case 'TAP':
      return handleTap(state, action.selectedIndex, action.selectedName);

    case 'DOUBLE_TAP':
      return handleDoubleTap(state);

    case 'PLAYER_MOVE_SAN':
      return handlePlayerMoveSan(state, action.san);

    case 'VOICE_LISTEN_START':
      if (
        state.phase !== 'idle' ||
        state.gameOver ||
        state.engineThinking ||
        state.pendingMove ||
        state.turn !== state.playerColor
      ) {
        return state;
      }
      return { ...state, voice: { listening: true, status: 'Listening… speak your move', statusExpiresAt: null, pendingConfirm: null } };

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
      return { ...state, phase: 'idle', gameOver: action.reason, engineThinking: false };

    case 'NEW_GAME': {
      const bulletTimerReset =
        state.mode === 'bullet' && state.selectedTimeControlIndex != null
          ? (() => {
              const tc = TIME_CONTROLS[state.selectedTimeControlIndex] ?? TIME_CONTROLS[2];
              return {
                timers: { whiteMs: tc.initialMs, blackMs: tc.initialMs, incrementMs: tc.incrementMs },
                timerActive: false,
                lastTickTime: null,
              };
            })()
          : {};
      return {
        ...state,
        phase: 'idle',
        selectedPieceId: null,
        selectedMoveIndex: 0,
        pendingPromotionMove: null,
        selectedPromotionIndex: 0,
        history: [],
        lastMove: null,
        lastMoveToSquare: null,
        playerLastMoveToSquare: null,
        engineThinking: false,
        gameOver: null,
        pendingMove: null,
        hasUnsavedChanges: false,
        menuSelectedIndex: 0,
        previousPhase: null,
        logScrollOffset: 0,
        ...bulletTimerReset,
      };
    }

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

    case 'OPEN_MENU':
      return handleOpenMenu(state);

    case 'CLOSE_MENU':
      return handleCloseMenu(state);

    case 'MENU_SELECT':
      return handleMenuSelect(state, action.option);

    case 'CONFIRM_EXIT':
      return handleConfirmExit(state, action.save);

    case 'CLEAR_SYSTEM_EXIT_REQUEST':
      return state.pendingSystemExitDialog ? { ...state, pendingSystemExitDialog: false } : state;

    case 'RESTORE_STATE':
      // Replay state captured by background-state.ts before the host migrated us to a headless
      // WebView. Reset transient flags that don't survive the move (engine work isn't actually
      // running in this WebView yet; pending moves were lost). The chess service must be reloaded
      // from action.state.fen by the caller before the next flush — done in the app subscriber.
      return {
        ...action.state,
        engineThinking: false,
        pendingMove: null,
        pendingPromotionMove: null,
        pendingSystemExitDialog: false,
        // lastTickTime should be reset; the next TIMER_TICK will recompute elapsed from now.
        lastTickTime: action.state.timerActive ? Date.now() : null,
      };

    case 'LOAD_GAME':
      return {
        ...state,
        fen: action.fen,
        history: action.history,
        turn: action.turn,
        phase: 'idle',
        lastMove: null,
        lastMoveToSquare: null,
        playerLastMoveToSquare: null,
        hasUnsavedChanges: false,
        menuSelectedIndex: 0,
        previousPhase: null,
        logScrollOffset: 0,
      };

    case 'SET_DIFFICULTY':
      return {
        ...state,
        difficulty: action.level,
        phase: 'menu',
        menuSelectedIndex: 0,
      };

    case 'SET_BOARD_MARKERS':
      return {
        ...state,
        showBoardMarkers: action.enabled,
        phase: 'menu',
        menuSelectedIndex: MENU_INDEX.BOARD_MARKERS,
      };

    case 'SET_BOARD_ALIGNMENT':
      return {
        ...state,
        boardAlignment: action.alignment,
        phase: 'menu',
        menuSelectedIndex: MENU_INDEX.DISPLAY_OPTIONS,
      };

    case 'SET_BOARD_SIZE':
      return {
        ...state,
        boardSize: action.size,
        phase: 'menu',
        menuSelectedIndex: MENU_INDEX.DISPLAY_OPTIONS,
      };

    case 'SET_PLAYER_COLOR':
      return state.playerColor === action.color ? state : { ...state, playerColor: action.color };

    case 'MARK_SAVED':
      return { ...state, hasUnsavedChanges: false };

    case 'SET_MODE':
      return handleSetMode(state, action.mode);

    case 'START_BULLET_GAME':
      return handleStartBulletGame(state, action.timeControlIndex);

    case 'TIMER_TICK':
      return handleTimerTick(state);

    case 'APPLY_INCREMENT':
      return handleApplyIncrement(state, action.color);

    case 'START_DRILL':
      return handleStartDrill(state, action.drillType);

    case 'DRILL_ANSWER':
      return handleDrillAnswer(state, action.correct);

    case 'NEXT_DRILL_QUESTION':
      return handleNextDrillQuestion(state);

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

/**
 * Scroll (swipe) handling during gameplay:
 * - SCROLL_BOTTOM_EVENT → direction 'down' → next item (+1 in spatial order).
 * - SCROLL_TOP_EVENT → direction 'up' → previous item (-1).
 * - rowSelect: order = candidate rows ascending. 'down' = next (+1) = higher rank =
 *   band moves UP the screen (board is rank-8-top, never flipped), so a physical
 *   swipe-up moves the highlighted row up. Same direction convention as pieceSelect.
 * - pieceSelect: order = movable pieces on the active row only (file a→h).
 * - destSelect: order = piece.moves (destination squares rank then file).
 */
const SETTINGS_PHASES = new Set([
  'menu', 'exitConfirm', 'resetConfirm', 'difficultySelect', 'boardMarkersSelect',
  'displayOptionsSelect', 'boardAlignmentSelect', 'boardSizeSelect', 'playAsSelect',
  'modeSelect', 'bulletSetup', 'academySelect',
]);

function handleScroll(state: GameState, direction: 'up' | 'down'): GameState {
  // Invert scroll direction in settings/menu screens vs gameplay
  const d: 'up' | 'down' = SETTINGS_PHASES.has(state.phase)
    ? (direction === 'down' ? 'up' : 'down')
    : direction;
  switch (state.phase) {
    case 'idle': {
      if (state.pieces.length === 0) return state;
      const initial = initialPieceForRowSelect(state);
      if (!initial) return state;
      const startTimer = state.mode === 'bullet' && state.timers && !state.timerActive;
      return {
        ...state,
        phase: 'rowSelect',
        selectedPieceId: initial.id,
        selectedMoveIndex: 0,
        phaseEnteredAt: Date.now(),
        ...(startTimer && { timerActive: true, lastTickTime: Date.now() }),
      };
    }

    case 'rowSelect': {
      const rows = getCandidateRows(state);
      if (rows.length === 0) return state;
      const cur = getSelectedRow(state);
      let idx = cur != null ? rows.indexOf(cur) : 0;
      if (idx < 0) idx = 0;
      // Candidate rows are rank-ascending. White's view has rank 8 at the top, so +1 =
      // higher rank = band moves UP the screen. When the human plays Black the board is
      // flipped (rank 1 at top), so the step direction must invert to keep "swipe up =
      // band moves up the screen".
      const stepDown = state.playerColor === 'b' ? d === 'up' : d === 'down';
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
      let next =
        d === 'down'
          ? (idx + 1) % MENU_OPTION_COUNT
          : (idx - 1 + MENU_OPTION_COUNT) % MENU_OPTION_COUNT;
      // Skip boardMarkers when large board is active (markers are disabled in large mode)
      if (state.boardSize === 'large' && next === MENU_INDEX.BOARD_MARKERS) {
        next = d === 'down'
          ? (next + 1) % MENU_OPTION_COUNT
          : (next - 1 + MENU_OPTION_COUNT) % MENU_OPTION_COUNT;
      }
      return { ...state, menuSelectedIndex: next };
    }

    case 'exitConfirm':
    case 'resetConfirm':
      return { ...state, menuSelectedIndex: state.menuSelectedIndex === 0 ? 1 : 0 };

    case 'difficultySelect': {
      const idx = state.menuSelectedIndex;
      const next =
        d === 'down'
          ? (idx + 1) % DIFFICULTY_OPTION_COUNT
          : (idx - 1 + DIFFICULTY_OPTION_COUNT) % DIFFICULTY_OPTION_COUNT;
      return { ...state, menuSelectedIndex: next };
    }

    case 'boardMarkersSelect': {
      const idx = state.menuSelectedIndex;
      const next =
        d === 'down'
          ? (idx + 1) % BOARD_MARKERS_OPTION_COUNT
          : (idx - 1 + BOARD_MARKERS_OPTION_COUNT) % BOARD_MARKERS_OPTION_COUNT;
      return { ...state, menuSelectedIndex: next };
    }

    case 'displayOptionsSelect': {
      const idx = state.menuSelectedIndex;
      const next =
        d === 'down'
          ? (idx + 1) % DISPLAY_OPTIONS_OPTION_COUNT
          : (idx - 1 + DISPLAY_OPTIONS_OPTION_COUNT) % DISPLAY_OPTIONS_OPTION_COUNT;
      return { ...state, menuSelectedIndex: next };
    }

    case 'boardAlignmentSelect': {
      const idx = state.menuSelectedIndex;
      const next =
        d === 'down'
          ? (idx + 1) % BOARD_ALIGNMENT_OPTION_COUNT
          : (idx - 1 + BOARD_ALIGNMENT_OPTION_COUNT) % BOARD_ALIGNMENT_OPTION_COUNT;
      return { ...state, menuSelectedIndex: next };
    }

    case 'boardSizeSelect': {
      const idx = state.menuSelectedIndex;
      const next =
        d === 'down'
          ? (idx + 1) % BOARD_SIZE_OPTION_COUNT
          : (idx - 1 + BOARD_SIZE_OPTION_COUNT) % BOARD_SIZE_OPTION_COUNT;
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

      const currentHighlight = fileRankToSquare(
        state.academyState.cursorFile,
        state.academyState.cursorRank
      );
      let currentIdx = validMoves.indexOf(currentHighlight.toLowerCase());
      if (currentIdx === -1) currentIdx = 0;

      const nextIdx = d === 'down'
        ? (currentIdx + 1) % validMoves.length
        : (currentIdx - 1 + validMoves.length) % validMoves.length;

      const nextSquare = validMoves[nextIdx]!;
      const nextPos = getSquareIndices(nextSquare);

      return {
        ...state,
        academyState: {
          ...state.academyState,
          cursorFile: nextPos.file,
          cursorRank: nextPos.rank,
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

function handleTap(state: GameState, _selectedIndex: number, _selectedName: string): GameState {
  switch (state.phase) {
    case 'idle': {
      if (state.pieces.length === 0) return state;
      const initial = initialPieceForRowSelect(state);
      if (!initial) return state;
      return {
        ...state,
        phase: 'rowSelect',
        selectedPieceId: initial.id,
        selectedMoveIndex: 0,
        phaseEnteredAt: Date.now(),
      };
    }

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

      const newHistory = [...state.history, move.san].slice(-MAX_HISTORY_LENGTH);
      return {
        ...state,
        phase: 'idle',
        lastMove: move.san,
        lastMoveToSquare: move.to,
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
      const newHistory = [...state.history, move.san].slice(-MAX_HISTORY_LENGTH);
      return {
        ...state,
        phase: 'idle',
        lastMove: move.san,
        lastMoveToSquare: move.to,
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
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.VIEW_LOG };

    case 'exitConfirm': {
      if (state.menuSelectedIndex === 0) {
        return handleConfirmExit(state, true);
      } else {
        return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.EXIT };
      }
    }

    case 'resetConfirm': {
      if (state.menuSelectedIndex === 0) {
        // app.ts detects this transition and performs the reset
        return { ...state, phase: 'idle', previousPhase: null };
      } else {
        return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.RESET };
      }
    }

    case 'difficultySelect': {
      const selectedDifficulty = DIFFICULTY_OPTIONS[state.menuSelectedIndex] ?? 'casual';
      return {
        ...state,
        difficulty: selectedDifficulty,
        phase: 'menu',
        menuSelectedIndex: MENU_INDEX.DIFFICULTY,
      };
    }

    case 'boardMarkersSelect': {
      const selectedOption = BOARD_MARKERS_OPTIONS[state.menuSelectedIndex] ?? 'on';
      return {
        ...state,
        showBoardMarkers: selectedOption === 'on',
        phase: 'menu',
        menuSelectedIndex: MENU_INDEX.BOARD_MARKERS,
      };
    }

    case 'displayOptionsSelect': {
      const selected = DISPLAY_OPTIONS_OPTIONS[state.menuSelectedIndex];
      if (selected === 'alignment') {
        return {
          ...state,
          phase: 'boardAlignmentSelect',
          menuSelectedIndex: BOARD_ALIGNMENT_OPTIONS.indexOf(state.boardAlignment),
        };
      }
      return {
        ...state,
        phase: 'boardSizeSelect',
        menuSelectedIndex: BOARD_SIZE_OPTIONS.indexOf(state.boardSize),
      };
    }

    case 'boardAlignmentSelect': {
      const selectedAlignment = BOARD_ALIGNMENT_OPTIONS[state.menuSelectedIndex] ?? 'right';
      return {
        ...state,
        boardAlignment: selectedAlignment,
        phase: 'menu',
        menuSelectedIndex: MENU_INDEX.DISPLAY_OPTIONS,
      };
    }

    case 'boardSizeSelect': {
      const selectedSize = BOARD_SIZE_OPTIONS[state.menuSelectedIndex] ?? 'small';
      return {
        ...state,
        boardSize: selectedSize,
        phase: 'menu',
        menuSelectedIndex: MENU_INDEX.DISPLAY_OPTIONS,
      };
    }

    case 'playAsSelect': {
      const chosen = PLAY_AS_OPTIONS[state.menuSelectedIndex] ?? 'white';
      // Picking a side starts a new game (changing color mid-game is meaningless).
      // If moves have been played, confirm first (reuses the reset confirmation, whose
      // resetConfirm→idle side-effect resolves playerColor from playAs and re-rolls
      // 'random'). On a fresh board, apply immediately — the playAsSelect→idle
      // transition is picked up by the same new-game side-effect.
      const inProgress = state.history.length > 0;
      return {
        ...state,
        playAs: chosen,
        phase: inProgress ? 'resetConfirm' : 'idle',
        menuSelectedIndex: inProgress ? 1 : 0,
      };
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

function applyNewGameAfterGameOver(state: GameState): GameState {
  const base: GameState = {
    ...state,
    phase: 'idle',
    selectedPieceId: null,
    selectedMoveIndex: 0,
    history: [],
    lastMove: null,
    engineThinking: false,
    gameOver: null,
    pendingMove: null,
    hasUnsavedChanges: false,
    menuSelectedIndex: 0,
    previousPhase: null,
  };
  if (state.mode === 'bullet' && state.selectedTimeControlIndex != null) {
    const tc = TIME_CONTROLS[state.selectedTimeControlIndex] ?? TIME_CONTROLS[2];
    return {
      ...base,
      timers: { whiteMs: tc.initialMs, blackMs: tc.initialMs, incrementMs: tc.incrementMs },
      timerActive: false,
      lastTickTime: null,
    };
  }
  return base;
}

function handleDoubleTap(state: GameState): GameState {
  if (state.gameOver) {
    return applyNewGameAfterGameOver(state);
  }
  switch (state.phase) {
    case 'idle':
      return handleOpenMenu(state);

    case 'rowSelect':
      // Back out to the idle "tap to speak / scroll to begin" screen. The settings
      // menu is one more double-tap away (idle → menu), so swiping into row select
      // by mistake no longer drops the user straight into settings.
      return { ...state, phase: 'idle', selectedPieceId: null, selectedMoveIndex: 0 };

    case 'pieceSelect': {
      // Defensive: a fused scroll+double-tap now lands in rowSelect (handled above),
      // so this branch is normally unreachable — kept as a guard in case a fast
      // double-tap slips through right after descending into pieceSelect.
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
      // Per ER guidance, double-tap in the settings menu surfaces the system "End this feature?"
      // dialog. The app subscriber sees this flag and calls bridge.shutDownPageContainer(1).
      // Stay in the menu phase: if the user cancels the system dialog the app is still on the menu.
      return { ...state, pendingSystemExitDialog: true };

    case 'viewLog':
      return { ...state, phase: 'menu', menuSelectedIndex: 0 };

    case 'resetConfirm':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.RESET };

    case 'exitConfirm':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.EXIT };

    case 'difficultySelect':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.DIFFICULTY };

    case 'playAsSelect':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.PLAY_AS };

    case 'boardMarkersSelect':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.BOARD_MARKERS };

    case 'displayOptionsSelect':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.DISPLAY_OPTIONS };

    case 'boardAlignmentSelect':
    case 'boardSizeSelect':
      return { ...state, phase: 'displayOptionsSelect', menuSelectedIndex: 0 };

    case 'modeSelect':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.MODE };

    case 'bulletSetup':
      return { ...state, phase: 'modeSelect', menuSelectedIndex: 1 };

    case 'academySelect':
      return { ...state, phase: 'modeSelect', menuSelectedIndex: 2 };

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
  const newHistory = [...state.history, action.san].slice(-MAX_HISTORY_LENGTH);
  const lastMoveToSquare = action.uci.length >= 4 ? action.uci.slice(2, 4) : null;
  return {
    ...state,
    phase: 'idle',
    fen: action.fen,
    turn: action.turn,
    pieces: action.pieces,
    inCheck: action.inCheck,
    lastMove: action.san,
    lastMoveToSquare,
    history: newHistory,
    engineThinking: false,
    selectedPieceId: null,
    selectedMoveIndex: 0,
    pendingMove: null,
    hasUnsavedChanges: true,
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
  const newHistory = [...state.history, move.san].slice(-MAX_HISTORY_LENGTH);
  return {
    ...state,
    phase: 'idle',
    lastMove: move.san,
    lastMoveToSquare: move.to,
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

  // Preserve original phase when navigating within menu sub-screens
  const previousPhase: UIPhase =
    state.phase === 'menu' || state.phase === 'viewLog' || state.phase === 'difficultySelect' || state.phase === 'boardMarkersSelect' || state.phase === 'displayOptionsSelect' || state.phase === 'boardAlignmentSelect' || state.phase === 'boardSizeSelect' || state.phase === 'playAsSelect' || state.phase === 'resetConfirm' || state.phase === 'exitConfirm'
      ? (state.previousPhase ?? 'idle')
      : state.phase;

  const pauseBulletTimer = state.mode === 'bullet' && state.timerActive && state.timers;
  return {
    ...state,
    phase: 'menu',
    menuSelectedIndex: 0,
    previousPhase,
    ...(pauseBulletTimer && { timerActive: false }),
  };
}

function handleCloseMenu(state: GameState): GameState {
  const resumeBulletTimer =
    state.mode === 'bullet' && state.timers && !state.gameOver &&
    (state.previousPhase === 'idle' || state.previousPhase === 'rowSelect' || state.previousPhase === 'pieceSelect' || state.previousPhase === 'destSelect');
  return {
    ...state,
    phase: state.previousPhase ?? 'idle',
    menuSelectedIndex: 0,
    previousPhase: null,
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

    case 'boardMarkers':
      return {
        ...state,
        phase: 'boardMarkersSelect',
        menuSelectedIndex: state.showBoardMarkers ? 0 : 1,
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
        menuSelectedIndex: 1,
      };

    case 'exit':
      // "Exit Menu" closes the settings menu and returns to the previous phase. Autosave handles
      // state durability (debounced after every move), so there's no need for the prior
      // "Save & Exit / Cancel" sub-dialog — it was misleading: the user wasn't exiting the app,
      // just the menu. Use double-tap in the menu to exit the app via the ER system dialog.
      return handleCloseMenu(state);

    default:
      return state;
  }
}

function handleConfirmExit(state: GameState, save: boolean): GameState {
  return {
    ...state,
    phase: 'idle',
    hasUnsavedChanges: save ? false : state.hasUnsavedChanges,
    previousPhase: null,
  };
}


function handleSetMode(state: GameState, mode: GameMode): GameState {
  switch (mode) {
    case 'play':
      return {
        ...state,
        mode: 'play',
        phase: 'idle',
        timerActive: false,
        timers: undefined,
        academyState: undefined,
        menuSelectedIndex: 0,
        previousPhase: null,
        logScrollOffset: 0,
      };

    case 'bullet':
      return {
        ...state,
        mode: 'bullet',
        phase: 'bulletSetup',
        logScrollOffset: 0,
      };

    case 'academy':
      return {
        ...state,
        mode: 'academy',
        phase: 'academySelect',
        menuSelectedIndex: 0,
        timerActive: false,
        timers: undefined,
        logScrollOffset: 0,
      };

    default:
      return state;
  }
}

function handleStartBulletGame(state: GameState, timeControlIndex: number): GameState {
  const timeControl = TIME_CONTROLS[timeControlIndex] ?? TIME_CONTROLS[2];
  return {
    ...state,
    phase: 'idle',
    selectedPieceId: null,
    selectedMoveIndex: 0,
    pendingPromotionMove: null,
    selectedPromotionIndex: 0,
    history: [],
    lastMove: null,
    lastMoveToSquare: null,
    playerLastMoveToSquare: null,
    engineThinking: false,
    gameOver: null,
    pendingMove: null,
    hasUnsavedChanges: false,
    menuSelectedIndex: 0,
    previousPhase: null,
    logScrollOffset: 0,
    timers: {
      whiteMs: timeControl.initialMs,
      blackMs: timeControl.initialMs,
      incrementMs: timeControl.incrementMs,
    },
    timerActive: false,
    lastTickTime: null,
    selectedTimeControlIndex: timeControlIndex,
  };
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
    return {
      ...state,
      timers: { ...state.timers, [key]: 0 },
      lastTickTime: now,
      timerActive: false,
      gameOver: `${winner} wins on time!`,
    };
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


function handleStartDrill(state: GameState, drillType: DrillType): GameState {
  const pos = getDefaultCursorPosition();
  const baseState = {
    drillType,
    score: { correct: 0, total: 0 },
    cursorFile: pos.file,
    cursorRank: pos.rank,
    navAxis: 'file' as const,
    feedback: 'none' as const,
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
      const startPos = getSquareIndices(puzzle.start);
      return {
        ...state,
        phase: 'knightPathDrill',
        academyState: {
          ...baseState,
          cursorFile: startPos.file,
          cursorRank: startPos.rank,
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

function handleDrillAnswer(state: GameState, correct: boolean): GameState {
  if (!state.academyState) return state;

  const score = state.academyState.score;
  return {
    ...state,
    academyState: {
      ...state.academyState,
      score: {
        correct: correct ? score.correct + 1 : score.correct,
        total: score.total + 1,
      },
    },
  };
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
  const guessSquare = fileRankToSquare(academy.cursorFile, academy.cursorRank);
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

function handleNextDrillQuestion(state: GameState): GameState {
  if (!state.academyState || state.academyState.drillType !== 'coordinate') {
    return state;
  }

  const pos = getDefaultCursorPosition();
  return {
    ...state,
    academyState: {
      ...state.academyState,
      targetSquare: generateRandomSquare(),
      cursorFile: pos.file,
      cursorRank: pos.rank,
      navAxis: 'file',
      feedback: 'none',
    },
  };
}

function handleKnightPathTap(state: GameState): GameState {
  if (!state.academyState) return state;

  const academy = state.academyState;

  if (academy.feedback !== 'none') {
    const puzzle = generateKnightPuzzle(2, 4);
    const startPos = getSquareIndices(puzzle.start);
    return {
      ...state,
      academyState: {
        ...academy,
        cursorFile: startPos.file,
        cursorRank: startPos.rank,
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

  const moveTarget = fileRankToSquare(academy.cursorFile, academy.cursorRank).toLowerCase();

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
  const newPos = getSquareIndices(moveTarget);
  const validMoves = getKnightMoves(moveTarget);
  const firstValidMove = validMoves[0];
  const firstMovePos = firstValidMove ? getSquareIndices(firstValidMove) : newPos;

  return {
    ...state,
    academyState: {
      ...academy,
      cursorFile: firstMovePos.file,
      cursorRank: firstMovePos.rank,
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
