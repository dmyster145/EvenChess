/**
 * Background snapshot: the slice of GameState the host carries across its migration to a headless
 * WebView (see storage/background-state.ts), and how a GameState is rebuilt from it on restore.
 *
 * Kept small (no piece lists or UI phase) so capturing it never blocks the JS thread on a
 * background transition, but complete enough that returning from the background keeps the game:
 * position, move history, mode, and bullet clocks, plus the display/difficulty settings.
 */

import { buildInitialState, clampCustomSkillLevel } from '../state/contracts';
import { TIME_CONTROL_COUNT } from '../state/constants';
import type {
  GameState,
  GameMode,
  BoardSize,
  BoardAlignment,
  BoardPosition,
  DifficultyLevel,
  PlayAs,
  PlayerColor,
} from '../state/contracts';
import type { ChessService } from '../chess/chessservice';

export const BACKGROUND_STATE_KEY = 'evenchess';
export const BACKGROUND_STATE_VERSION = 3;

export type BackgroundSnapshot = {
  version: typeof BACKGROUND_STATE_VERSION;
  fen: string;
  turn: 'w' | 'b';
  difficulty: DifficultyLevel;
  /** Optional: present only on snapshots written after the Custom difficulty shipped. */
  customSkillLevel?: number;
  boardAlignment: BoardAlignment;
  boardSize: BoardSize;
  /** Optional: present only on snapshots written after the Position option shipped. */
  boardPosition?: BoardPosition;
  showBoardMarkers: boolean;
  playAs: PlayAs;
  playerColor: PlayerColor;
  /** Optional (added later): the game in progress, so a restore doesn't wipe the move log. */
  history?: string[];
  mode?: GameMode;
  timers?: GameState['timers'];
  selectedTimeControlIndex?: number;
  /** Optional (added later): the result of a finished game, so a restore still shows it. */
  gameOver?: string | null;
};

export function buildBackgroundSnapshot(s: GameState): BackgroundSnapshot {
  return {
    version: BACKGROUND_STATE_VERSION,
    fen: s.fen,
    turn: s.turn,
    difficulty: s.difficulty,
    customSkillLevel: s.customSkillLevel,
    boardAlignment: s.boardAlignment,
    boardSize: s.boardSize,
    boardPosition: s.boardPosition,
    showBoardMarkers: s.showBoardMarkers,
    playAs: s.playAs,
    playerColor: s.playerColor,
    history: s.history,
    mode: s.mode,
    timers: s.timers,
    selectedTimeControlIndex: s.selectedTimeControlIndex,
    gameOver: s.gameOver,
  };
}

const MODES: readonly GameMode[] = ['play', 'bullet', 'academy'];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isTimers(value: unknown): value is NonNullable<GameState['timers']> {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return ['whiteMs', 'blackMs', 'incrementMs'].every((k) => typeof t[k] === 'number' && Number.isFinite(t[k]));
}

function isTimeControlIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < TIME_CONTROL_COUNT;
}

/**
 * The result of a finished game: the snapshot's own when it has one, else worked out from the
 * board (mate or draw) or a bullet clock at zero, for snapshots written before gameOver was kept.
 */
function restoredGameOver(snap: Partial<BackgroundSnapshot>, chess: ChessService, timers: GameState['timers']): string | null {
  if (typeof snap.gameOver === 'string' && snap.gameOver) return snap.gameOver;
  const reason = chess.getGameOverReason();
  if (reason) return reason;
  if (snap.gameOver !== undefined) return null; // a newer snapshot of a live game
  if (timers?.whiteMs === 0) return 'Black wins on time!';
  if (timers?.blackMs === 0) return 'White wins on time!';
  return null;
}

/**
 * Rebuild a GameState from a snapshot, loading its position into `chess`. Returns null when the
 * snapshot is missing, from another version, or has an unloadable position (the caller keeps the
 * current state). The game resumes at idle with the bullet clock stopped; it restarts when the
 * player begins their next move, so time spent migrating is never charged. A finished game comes
 * back finished, with its result, rather than as a dead board or a live game again.
 */
export function restoreFromBackgroundSnapshot(saved: unknown, chess: ChessService): GameState | null {
  const snap = saved as Partial<BackgroundSnapshot> | undefined;
  if (!snap || snap.version !== BACKGROUND_STATE_VERSION || typeof snap.fen !== 'string' || !snap.fen) {
    return null;
  }
  if (!chess.loadFen(snap.fen)) return null;
  const fresh = buildInitialState(chess);
  const history = isStringArray(snap.history) ? snap.history : [];
  const mode = snap.mode && MODES.includes(snap.mode) ? snap.mode : fresh.mode;
  const timers = mode === 'bullet' && isTimers(snap.timers) ? snap.timers : undefined;
  return {
    ...fresh,
    fen: snap.fen,
    turn: snap.turn ?? fresh.turn,
    difficulty: snap.difficulty ?? fresh.difficulty,
    customSkillLevel: typeof snap.customSkillLevel === 'number' ? clampCustomSkillLevel(snap.customSkillLevel) : fresh.customSkillLevel,
    boardAlignment: snap.boardAlignment ?? fresh.boardAlignment,
    boardSize: snap.boardSize ?? fresh.boardSize,
    boardPosition: snap.boardPosition ?? fresh.boardPosition,
    showBoardMarkers: snap.showBoardMarkers ?? fresh.showBoardMarkers,
    playAs: snap.playAs ?? fresh.playAs,
    playerColor: snap.playerColor ?? fresh.playerColor,
    history,
    lastMove: history[history.length - 1] ?? null,
    hasUnsavedChanges: history.length > 0,
    mode,
    timers,
    timerActive: false,
    lastTickTime: null,
    selectedTimeControlIndex: isTimeControlIndex(snap.selectedTimeControlIndex)
      ? snap.selectedTimeControlIndex
      : fresh.selectedTimeControlIndex,
    gameOver: restoredGameOver(snap, chess, timers),
  };
}
