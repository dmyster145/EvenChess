/**
 * Core type definitions — single source of truth for the EvenChess app.
 */

import type { ChessService } from '../chess/chessservice';

export type PieceId = string;

export interface CarouselMove {
  uci: string;
  san: string;
  from: string;
  to: string;
  promotion?: string;
}

/** Transient UI state for push-to-talk voice move input. */
export interface VoiceUiState {
  listening: boolean;
  /** Short message shown on the glasses (heard text, error, prompt). null = none. */
  status: string | null;
  /**
   * Epoch ms at which a timed `status` clears; null = shown until replaced. side-effects.ts
   * schedules VOICE_STATUS_EXPIRE for this time.
   */
  statusExpiresAt: number | null;
  /**
   * A matched move awaiting explicit confirmation. While set, the idle screen shows
   * a "tap to confirm" prompt; tap commits it, double-tap aborts. Guards against a
   * misheard command being played automatically. null = nothing pending.
   */
  pendingConfirm: CarouselMove | null;
}

export interface PieceEntry {
  id: PieceId;
  label: string;
  color: 'w' | 'b';
  type: string;
  square: string;
  moves: CarouselMove[];
}

export type GameMode = 'play' | 'academy' | 'bullet';

export type UIPhase =
  | 'idle'
  | 'rowSelect'
  | 'pieceSelect'
  | 'destSelect'
  | 'promotionSelect'
  | 'menu'
  | 'viewLog'
  | 'difficultySelect'
  | 'customDifficultySelect'
  | 'displayOptionsSelect'
  | 'playAsSelect'
  | 'resetConfirm'
  | 'modeSelect'
  | 'bulletSetup'
  | 'academySelect'
  | 'coordinateDrill'
  | 'tacticsDrill'
  | 'mateDrill'
  | 'knightPathDrill'
  | 'pgnStudy';

export type MenuOption = 'mode' | 'viewLog' | 'difficulty' | 'playAs' | 'displayOptions' | 'reset' | 'exit';

export type BoardAlignment = 'center' | 'right';
export type BoardSize = 'small' | 'large';
/** Which edge of the board the human's pieces sit on. 'bottom' is the classic view. */
export type BoardPosition = 'bottom' | 'top';
/** User preference for which side to play. 'random' re-rolls each new game. */
export type PlayAs = 'white' | 'black' | 'random';
/** Resolved human color for the current game (random is resolved at new-game). */
export type PlayerColor = 'w' | 'b';

export type DrillType = 'coordinate' | 'tactics' | 'mate' | 'knightPath' | 'pgn';

export type DrillFeedback = 'none' | 'correct' | 'incorrect';

export type DrillNavAxis = 'file' | 'rank';

export interface TacticsPuzzle {
  fen: string;
  solution: string[];
  theme: string;
  description?: string;
}

export interface KnightPathState {
  startSquare: string;
  targetSquare: string;
  currentSquare: string;
  optimalMoves: number;
  movesTaken: number;
  path: string[];
}

export interface PgnStudyState {
  gameName: string;
  moves: string[];
  currentMoveIndex: number;
  fen: string;
  guessMode: boolean;
}

export interface AcademyState {
  drillType: DrillType;
  targetSquare?: string;
  score: { correct: number; total: number };
  puzzleMoves?: string[];
  puzzleMoveIndex?: number;
  cursorFile: number;
  cursorRank: number;
  navAxis: DrillNavAxis;
  feedback: DrillFeedback;
  tacticsPuzzle?: TacticsPuzzle;
  tacticsSolutionIndex?: number;
  knightPath?: KnightPathState;
  pgnStudy?: PgnStudyState;
}

export type DifficultyLevel = 'easy' | 'casual' | 'serious' | 'custom';

/** Inclusive bounds for the user-facing Custom difficulty picker (0..9). */
export const CUSTOM_SKILL_LEVEL_MIN = 0;
export const CUSTOM_SKILL_LEVEL_MAX = 9;
export const CUSTOM_SKILL_LEVEL_DEFAULT = 5;

export interface EngineProfile {
  name: string;
  skillLevel: number;
  depth: number;
  movetime: number;
  addVariety: boolean;
}

export interface GameState {
  fen: string;
  turn: 'w' | 'b';
  pieces: PieceEntry[];
  phase: UIPhase;
  selectedPieceId: PieceId | null;
  selectedMoveIndex: number;
  /** When in promotionSelect: the move we are choosing promotion for. */
  pendingPromotionMove: { from: string; to: string } | null;
  /** When in promotionSelect: 0=Queen, 1=Rook, 2=Bishop, 3=Knight. */
  selectedPromotionIndex: number;
  mode: GameMode;
  history: string[];
  lastMove: string | null;
  /** Square the player's last move went to; this piece is selected first when entering pieceSelect. */
  playerLastMoveToSquare: string | null;
  engineThinking: boolean;
  inCheck: boolean;
  gameOver: string | null;
  pendingMove: CarouselMove | null;
  menuSelectedIndex: number;
  hasUnsavedChanges: boolean;
  previousPhase: UIPhase | null;
  /**
   * Set when the user taps the menu's Exit item (handleMenuSelect 'exit'). side-effects.ts sees the
   * false→true transition and calls `bridge.requestSystemExit()`, which shows the system's
   * "End this feature?" confirmation dialog, then clears the flag. Per ER guidance, no app-side
   * cleanup happens here — if the user confirms, cleanup runs in the SYSTEM_EXIT_EVENT handler.
   */
  pendingSystemExitDialog?: boolean;
  /**
   * Set only when the user CONFIRMS the reset dialog (resetConfirm → Confirm). side-effects.ts keys
   * the board reset on this flag, not on the resetConfirm→idle phase transition, so a Cancel can
   * never trip a reset. Cleared by NEW_GAME once the reset is applied.
   */
  pendingReset?: boolean;
  difficulty: DifficultyLevel;
  /**
   * User-picked level (0..9) for the Custom difficulty. Always present so the picker has a
   * starting value even when `difficulty` is one of the named tiers; only consulted when
   * `difficulty === 'custom'`.
   */
  customSkillLevel: number;
  boardAlignment: BoardAlignment;
  boardSize: BoardSize;
  /** Display preference: show the human's pieces at the bottom (default) or top of the board. */
  boardPosition: BoardPosition;
  /** User preference for side to play; 'random' re-rolls each new game. */
  playAs: PlayAs;
  /**
   * A Play As choice awaiting reset confirmation (game in progress). Committed to `playAs` only when
   * the user confirms the reset; discarded on cancel so cancelling never changes (or persists) the
   * side. On a fresh board the choice applies immediately and this stays null.
   */
  pendingPlayAs?: PlayAs | null;
  /** Resolved human color for the current game. Drives board flip + engine ownership. */
  playerColor: PlayerColor;
  logScrollOffset: number;
  /** For gesture disambiguation (see GESTURE_DISAMBIGUATION_MS in constants) */
  phaseEnteredAt: number;
  timers?: {
    whiteMs: number;
    blackMs: number;
    incrementMs: number;
  };
  timerActive: boolean;
  /**
   * True while a menu/overlay paused a RUNNING bullet clock. Set when the pause happens (menu open
   * or a system overlay) and checked on resume, so closing the menu resumes only a clock that was
   * actually ticking — opening the menu before the first move never starts it.
   */
  bulletPausedForMenu?: boolean;
  lastTickTime: number | null;
  selectedTimeControlIndex: number;
  academyState?: AcademyState;
  showBoardMarkers: boolean;
  /** Push-to-talk voice input UI state. Absent until voice is first used. */
  voice?: VoiceUiState;
}

export type Action =
  | { type: 'SCROLL'; direction: 'up' | 'down' }
  | { type: 'TAP' }
  | { type: 'DOUBLE_TAP' }
  | { type: 'PLAYER_MOVE_SAN'; san: string }
  /** endsGame: this move ends the game (checkmate/draw); the bullet clock stops immediately. */
  | { type: 'ENGINE_MOVE'; uci: string; san: string; fen: string; turn: 'w' | 'b'; pieces: PieceEntry[]; inCheck: boolean; endsGame?: boolean }
  | { type: 'ENGINE_THINKING' }
  | { type: 'ENGINE_ERROR' }
  | { type: 'GAME_OVER'; reason: string }
  | { type: 'NEW_GAME' }
  | { type: 'REFRESH'; fen: string; turn: 'w' | 'b'; pieces: PieceEntry[]; inCheck: boolean }
  | { type: 'FOREGROUND_ENTER' }
  | { type: 'FOREGROUND_EXIT' }
  | { type: 'CLEAR_SYSTEM_EXIT_REQUEST' }
  | { type: 'RESTORE_STATE'; state: GameState }
  | { type: 'MARK_SAVED' }
  | { type: 'SET_PLAYER_COLOR'; color: PlayerColor }
  | { type: 'TIMER_TICK' }
  /** Freeze the bullet clock while a system overlay is open. */
  | { type: 'BULLET_PAUSE' }
  /** Resume the bullet clock after the overlay closes, without charging the paused time. */
  | { type: 'BULLET_RESUME' }
  | { type: 'APPLY_INCREMENT'; color: 'w' | 'b' }
  | { type: 'VOICE_LISTEN_START' }
  | { type: 'VOICE_LISTEN_END' }
  | { type: 'VOICE_STATUS'; message: string; durationMs?: number; keepListening?: boolean }
  /** A timed voice status reached its expiry; clears it only if it is still the same status. */
  | { type: 'VOICE_STATUS_EXPIRE'; expiresAt: number }
  | { type: 'VOICE_MOVE_CANDIDATE'; move: CarouselMove }
  | { type: 'VOICE_CONFIRM' }
  | { type: 'VOICE_ABORT' };

export type StoreListener = (state: GameState, prevState: GameState) => void;

export function buildInitialState(chess: ChessService): GameState {
  return {
    fen: chess.getFen(),
    turn: chess.getTurn(),
    pieces: chess.getPiecesWithMoves(),
    phase: 'idle',
    selectedPieceId: null,
    selectedMoveIndex: 0,
    pendingPromotionMove: null,
    selectedPromotionIndex: 0,
    mode: 'play',
    history: [],
    lastMove: null,
    playerLastMoveToSquare: null,
    engineThinking: false,
    inCheck: chess.isInCheck(),
    gameOver: null,
    pendingMove: null,
    menuSelectedIndex: 0,
    hasUnsavedChanges: false,
    previousPhase: null,
    difficulty: 'casual',
    customSkillLevel: CUSTOM_SKILL_LEVEL_DEFAULT,
    boardAlignment: 'right',
    boardSize: 'small',
    boardPosition: 'bottom',
    playAs: 'white',
    playerColor: 'w',
    logScrollOffset: 0,
    phaseEnteredAt: Date.now(),
    timerActive: false,
    lastTickTime: null,
    selectedTimeControlIndex: 2,
    showBoardMarkers: true,
  };
}
