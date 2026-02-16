/**
 * State reducer — pure function `(state, action) => state`.
 *
 * Implements the UI state machine:
 *   Idle ──scroll──▶ PieceSelect ──tap──▶ DestSelect ──tap──▶ Idle
 *                     │ double-tap → Idle    │ double-tap → PieceSelect
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
import { generateRandomSquare, moveCursorAxis, fileRankToSquare, getDefaultCursorPosition } from '../academy/drills';
import { generateKnightPuzzle, getKnightMoves, isValidKnightMove, getSquareIndices } from '../academy/knight';
import { getRandomTacticsPuzzle, getRandomMatePuzzle } from '../academy/puzzles';
import { getRandomFamousGame, STARTING_FEN } from '../academy/pgn';

/**
 * Pure reducer — side-effects (move execution, engine requests) are handled
 * by the store subscriber layer in app.ts.
 */
export function reduce(state: GameState, action: Action): GameState {
  if (state.gameOver && action.type !== 'NEW_GAME' && action.type !== 'OPEN_MENU' && action.type !== 'CLOSE_MENU' && action.type !== 'DOUBLE_TAP') {
    return state;
  }

  switch (action.type) {
    case 'SCROLL':
      return handleScroll(state, action.direction);

    case 'TAP':
      return handleTap(state, action.selectedIndex, action.selectedName);

    case 'DOUBLE_TAP':
      return handleDoubleTap(state);

    case 'ENGINE_THINKING':
      return { ...state, engineThinking: true };

    case 'ENGINE_ERROR':
      return { ...state, engineThinking: false };

    case 'ENGINE_MOVE':
      return handleEngineMove(state, action);

    case 'GAME_OVER':
      return { ...state, phase: 'idle', gameOver: action.reason, engineThinking: false };

    case 'NEW_GAME':
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
      };

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


/** Initial piece when entering pieceSelect: player's last-moved piece if any, else bottom-left (first in list). */
function initialPieceForPieceSelect(state: GameState): PieceEntry | null {
  if (state.pieces.length === 0) return null;
  if (state.playerLastMoveToSquare) {
    const found = state.pieces.find((p) => p.square === state.playerLastMoveToSquare);
    if (found) return found;
  }
  return state.pieces[0] ?? null;
}

/**
 * Scroll (swipe) handling during gameplay:
 * - SCROLL_BOTTOM_EVENT → direction 'down' → next item (clockwise: +1 in spatial order).
 * - SCROLL_TOP_EVENT → direction 'up' → previous item (counter-clockwise: -1).
 * - pieceSelect: order = state.pieces (rank 1→8, file a→h). Start at bottom-left or latest-moved piece.
 * - destSelect: order = piece.moves (destination squares rank then file).
 */
function handleScroll(state: GameState, direction: 'up' | 'down'): GameState {
  switch (state.phase) {
    case 'idle':
      if (state.pieces.length === 0) return state;
      const initial = initialPieceForPieceSelect(state);
      if (!initial) return state;
      const startTimer = state.mode === 'bullet' && state.timers && !state.timerActive;
      return {
        ...state,
        phase: 'pieceSelect',
        selectedPieceId: initial.id,
        selectedMoveIndex: 0,
        phaseEnteredAt: Date.now(),
        ...(startTimer && { timerActive: true, lastTickTime: Date.now() }),
      };

    case 'pieceSelect': {
      const idx = currentPieceIndex(state);
      const len = state.pieces.length;
      if (len === 0) return state;
      const next = direction === 'down' ? (idx + 1) % len : (idx - 1 + len) % len;
      const piece = state.pieces[next];
      return piece
        ? { ...state, selectedPieceId: piece.id, selectedMoveIndex: 0 }
        : state;
    }

    case 'destSelect': {
      const piece = selectedPieceEntry(state);
      if (!piece) return state;
      const len = piece.moves.length;
      if (len === 0) return state;
      const next = direction === 'down' ? (state.selectedMoveIndex + 1) % len : (state.selectedMoveIndex - 1 + len) % len;
      return { ...state, selectedMoveIndex: next };
    }

    case 'promotionSelect': {
      const next =
        direction === 'down'
          ? (state.selectedPromotionIndex + 1) % PROMOTION_OPTION_COUNT
          : (state.selectedPromotionIndex - 1 + PROMOTION_OPTION_COUNT) % PROMOTION_OPTION_COUNT;
      return { ...state, selectedPromotionIndex: next };
    }

    case 'menu': {
      const idx = state.menuSelectedIndex;
      const next =
        direction === 'down'
          ? (idx + 1) % MENU_OPTION_COUNT
          : (idx - 1 + MENU_OPTION_COUNT) % MENU_OPTION_COUNT;
      return { ...state, menuSelectedIndex: next };
    }

    case 'exitConfirm':
    case 'resetConfirm':
      return { ...state, menuSelectedIndex: state.menuSelectedIndex === 0 ? 1 : 0 };

    case 'difficultySelect': {
      const idx = state.menuSelectedIndex;
      const next =
        direction === 'down'
          ? (idx + 1) % DIFFICULTY_OPTION_COUNT
          : (idx - 1 + DIFFICULTY_OPTION_COUNT) % DIFFICULTY_OPTION_COUNT;
      return { ...state, menuSelectedIndex: next };
    }

    case 'boardMarkersSelect': {
      const idx = state.menuSelectedIndex;
      const next =
        direction === 'down'
          ? (idx + 1) % BOARD_MARKERS_OPTION_COUNT
          : (idx - 1 + BOARD_MARKERS_OPTION_COUNT) % BOARD_MARKERS_OPTION_COUNT;
      return { ...state, menuSelectedIndex: next };
    }

    case 'viewLog': {
      const maxMoves = Math.ceil(state.history.length / 2);
      const maxOffset = Math.max(0, maxMoves - LOG_MAX_VISIBLE);
      const newOffset =
        direction === 'down'
          ? Math.min(state.logScrollOffset + 1, maxOffset)
          : Math.max(state.logScrollOffset - 1, 0);
      return { ...state, logScrollOffset: newOffset };
    }

    case 'modeSelect': {
      const idx = state.menuSelectedIndex;
      const next =
        direction === 'down'
          ? (idx + 1) % MODE_OPTION_COUNT
          : (idx - 1 + MODE_OPTION_COUNT) % MODE_OPTION_COUNT;
      return { ...state, menuSelectedIndex: next };
    }

    case 'bulletSetup': {
      const idx = state.selectedTimeControlIndex;
      const next =
        direction === 'down'
          ? (idx + 1) % TIME_CONTROL_COUNT
          : (idx - 1 + TIME_CONTROL_COUNT) % TIME_CONTROL_COUNT;
      return { ...state, selectedTimeControlIndex: next };
    }

    case 'academySelect': {
      const idx = state.menuSelectedIndex;
      const next =
        direction === 'down'
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
        direction
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

      const nextIdx = direction === 'down'
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
      if (direction === 'down') {
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
      const initial = initialPieceForPieceSelect(state);
      if (!initial) return state;
      return {
        ...state,
        phase: 'pieceSelect',
        selectedPieceId: initial.id,
        selectedMoveIndex: 0,
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

    case 'pieceSelect': {
      // Gesture disambiguation: if scroll+double-tap arrived together, scroll processed
      // first putting us in pieceSelect. Treat quick double-tap as menu open intent.
      const timeSinceEntry = Date.now() - state.phaseEnteredAt;
      if (timeSinceEntry < GESTURE_DISAMBIGUATION_MS) {
        return handleOpenMenu(state);
      }
      return { ...state, phase: 'idle', selectedPieceId: null, selectedMoveIndex: 0 };
    }

    case 'destSelect':
      return { ...state, phase: 'pieceSelect', selectedMoveIndex: 0 };

    case 'promotionSelect':
      return { ...state, phase: 'destSelect', pendingPromotionMove: null };

    case 'confirm':
      return { ...state, phase: 'destSelect' };

    case 'menu':
      return handleCloseMenu(state);

    case 'viewLog':
      return { ...state, phase: 'menu', menuSelectedIndex: 0 };

    case 'resetConfirm':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.RESET };

    case 'exitConfirm':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.EXIT };

    case 'difficultySelect':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.DIFFICULTY };

    case 'boardMarkersSelect':
      return { ...state, phase: 'menu', menuSelectedIndex: MENU_INDEX.BOARD_MARKERS };

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


function currentPieceIndex(state: GameState): number {
  if (!state.selectedPieceId) return 0;
  const idx = state.pieces.findIndex((p) => p.id === state.selectedPieceId);
  return idx >= 0 ? idx : 0;
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
    state.phase === 'menu' || state.phase === 'viewLog' || state.phase === 'difficultySelect' || state.phase === 'boardMarkersSelect' || state.phase === 'resetConfirm' || state.phase === 'exitConfirm'
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
    (state.previousPhase === 'idle' || state.previousPhase === 'pieceSelect' || state.previousPhase === 'destSelect');
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

    case 'reset':
      return {
        ...state,
        phase: 'resetConfirm',
        menuSelectedIndex: 1,
      };

    case 'exit':
      if (state.hasUnsavedChanges) {
        return { ...state, phase: 'exitConfirm', menuSelectedIndex: 0 };
      }
      return { ...state, phase: 'idle', previousPhase: null };

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
