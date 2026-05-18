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
  /** Epoch ms after which `status` is stale; null = until next state change. */
  statusExpiresAt: number | null;
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
  | 'boardMarkersSelect'
  | 'displayOptionsSelect'
  | 'boardAlignmentSelect'
  | 'boardSizeSelect'
  | 'playAsSelect'
  | 'resetConfirm'
  | 'exitConfirm'
  | 'modeSelect'
  | 'bulletSetup'
  | 'academySelect'
  | 'coordinateDrill'
  | 'tacticsDrill'
  | 'mateDrill'
  | 'knightPathDrill'
  | 'pgnStudy';

export type MenuOption = 'mode' | 'boardMarkers' | 'viewLog' | 'difficulty' | 'playAs' | 'displayOptions' | 'reset' | 'exit';

export type BoardAlignment = 'center' | 'right';
export type BoardSize = 'small' | 'large';
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

export type DifficultyLevel = 'easy' | 'casual' | 'serious';

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
  /** Square the last move went to (player or engine). */
  lastMoveToSquare: string | null;
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
   * Set by the reducer when the user double-taps in the settings menu. The app subscriber observes
   * the false→true transition and calls `bridge.shutDownPageContainer(1)` to surface the system's
   * "End this feature?" confirmation dialog, then clears the flag. Per ER guidance, no app-side
   * cleanup happens here — if the user confirms, cleanup runs in the SYSTEM_EXIT_EVENT handler.
   */
  pendingSystemExitDialog?: boolean;
  difficulty: DifficultyLevel;
  boardAlignment: BoardAlignment;
  boardSize: BoardSize;
  /** User preference for side to play; 'random' re-rolls each new game. */
  playAs: PlayAs;
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
  lastTickTime: number | null;
  selectedTimeControlIndex: number;
  academyState?: AcademyState;
  showBoardMarkers: boolean;
  /** Push-to-talk voice input UI state. Absent until voice is first used. */
  voice?: VoiceUiState;
}

export type Action =
  | { type: 'SCROLL'; direction: 'up' | 'down' }
  | { type: 'TAP'; selectedIndex: number; selectedName: string }
  | { type: 'DOUBLE_TAP' }
  | { type: 'PLAYER_MOVE_SAN'; san: string }
  | { type: 'ENGINE_MOVE'; uci: string; san: string; fen: string; turn: 'w' | 'b'; pieces: PieceEntry[]; inCheck: boolean }
  | { type: 'ENGINE_THINKING' }
  | { type: 'ENGINE_ERROR' }
  | { type: 'GAME_OVER'; reason: string }
  | { type: 'NEW_GAME' }
  | { type: 'REFRESH'; fen: string; turn: 'w' | 'b'; pieces: PieceEntry[]; inCheck: boolean }
  | { type: 'FOREGROUND_ENTER' }
  | { type: 'FOREGROUND_EXIT' }
  | { type: 'OPEN_MENU' }
  | { type: 'MENU_SELECT'; option: MenuOption }
  | { type: 'CLOSE_MENU' }
  | { type: 'CONFIRM_EXIT'; save: boolean }
  | { type: 'CLEAR_SYSTEM_EXIT_REQUEST' }
  | { type: 'RESTORE_STATE'; state: GameState }
  | { type: 'LOAD_GAME'; fen: string; history: string[]; turn: 'w' | 'b' }
  | { type: 'MARK_SAVED' }
  | { type: 'SET_DIFFICULTY'; level: DifficultyLevel }
  | { type: 'SET_BOARD_MARKERS'; enabled: boolean }
  | { type: 'SET_BOARD_ALIGNMENT'; alignment: BoardAlignment }
  | { type: 'SET_BOARD_SIZE'; size: BoardSize }
  | { type: 'SET_PLAYER_COLOR'; color: PlayerColor }
  | { type: 'SET_MODE'; mode: GameMode }
  | { type: 'START_BULLET_GAME'; timeControlIndex: number }
  | { type: 'TIMER_TICK' }
  | { type: 'APPLY_INCREMENT'; color: 'w' | 'b' }
  | { type: 'START_DRILL'; drillType: DrillType }
  | { type: 'DRILL_ANSWER'; correct: boolean }
  | { type: 'NEXT_DRILL_QUESTION' }
  | { type: 'VOICE_LISTEN_START' }
  | { type: 'VOICE_LISTEN_END' }
  | { type: 'VOICE_STATUS'; message: string; durationMs?: number; keepListening?: boolean }
  | { type: 'VOICE_MOVE_RESOLVED'; move: CarouselMove };

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
    lastMoveToSquare: null,
    playerLastMoveToSquare: null,
    engineThinking: false,
    inCheck: chess.isInCheck(),
    gameOver: null,
    pendingMove: null,
    menuSelectedIndex: 0,
    hasUnsavedChanges: false,
    previousPhase: null,
    difficulty: 'casual',
    boardAlignment: 'right',
    boardSize: 'small',
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
