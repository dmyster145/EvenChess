/**
 * Selectors — derive display data from GameState.
 *
 * Used by the page composer to build container configs.
 */

import type { GameState, PieceEntry, CarouselMove } from './contracts';
import {
  MENU_OPTIONS,
  MENU_LABELS,
  DIFFICULTY_OPTIONS,
  DIFFICULTY_LABELS,
  BOARD_MARKERS_LABELS,
  DISPLAY_OPTIONS_LABELS,
  BOARD_ALIGNMENT_OPTIONS,
  BOARD_ALIGNMENT_LABELS,
  BOARD_SIZE_OPTIONS,
  BOARD_SIZE_LABELS,
  PLAY_AS_OPTIONS,
  PLAY_AS_LABELS,
  MAX_MOVES_DISPLAY,
  MODE_LABELS,
  MODE_OPTIONS,
  TIME_CONTROLS,
  DRILL_LABELS,
} from './constants';
import { getMoveNumber } from './utils';
import { formatTime } from '../bullet/clock';
import { fileRankToSquare, getFileLetter, getRankNumber } from '../academy/drills';
import { rankOfSquare } from '../chess/square-utils';

// ── Unicode characters for visual hierarchy ────────────────────────────────
// "White - Move 24" = 16 chars, but Unicode box chars are wider, so use fewer
const SEPARATOR_LINE = '────────';
const ARROW_LEFT = '◀';
const ARROW_RIGHT = '▶';
const ARROW_UP = '▲';
const ARROW_DOWN = '▼';
const ARROW_UPDOWN = '▲▼';

export function getSelectedPiece(state: GameState): PieceEntry | null {
  if (!state.selectedPieceId) return null;
  return state.pieces.find((p) => p.id === state.selectedPieceId) ?? null;
}

export function getSelectedMove(state: GameState): CarouselMove | null {
  const piece = getSelectedPiece(state);
  if (!piece) return null;
  return piece.moves[state.selectedMoveIndex] ?? null;
}

/** Distinct chess ranks (1..8) with ≥1 movable side-to-move piece, ascending. */
export function getCandidateRows(state: GameState): number[] {
  const seen = new Set<number>();
  for (const p of state.pieces) seen.add(rankOfSquare(p.square));
  return [...seen].sort((a, b) => a - b);
}

/** Movable pieces on a chess rank, in state.pieces order (file a→h). */
export function getPiecesOnRow(state: GameState, rank: number): PieceEntry[] {
  return state.pieces.filter((p) => rankOfSquare(p.square) === rank);
}

/** Active row (chess rank 1..8) implied by selectedPieceId, or null. */
export function getSelectedRow(state: GameState): number | null {
  const p = getSelectedPiece(state);
  return p ? rankOfSquare(p.square) : null;
}

const STARTING_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };

// Captured-piece glyphs. The G2 firmware font does NOT include the chess Unicode block
// (U+2654–265F) — its supported "Misc Symbols" run is U+2605–U+2667, which skips chess
// (verified against the even-g2-notes glyph tables); out-of-font chars render blank.
// So we use FEN-style letters: UPPERCASE = White pieces, lowercase = Black pieces.
const CAPTURED_GLYPH: Record<string, string> = {
  P: 'P', N: 'N', B: 'B', R: 'R', Q: 'Q',
  p: 'p', n: 'n', b: 'b', r: 'r', q: 'q',
};
/** Captured-piece types in value order (queen first), for display iteration. */
export const CAPTURED_ORDER = ['q', 'r', 'b', 'n', 'p'] as const;

export interface CapturedCounts {
  /** Captured White pieces, by type ('q'|'r'|'b'|'n'|'p'). */
  white: Record<string, number>;
  /** Captured Black pieces, by type. */
  black: Record<string, number>;
}

/**
 * Captured pieces as structured counts, derived from the FEN as a material diff
 * (starting material minus what's on the board). Promotions skew it slightly —
 * acceptable for a HUD. Returns all-zero counts if the FEN isn't a board placement.
 */
export function getCapturedCounts(state: GameState): CapturedCounts {
  const empty = (): Record<string, number> => ({ p: 0, n: 0, b: 0, r: 0, q: 0 });
  const placement = (state.fen || '').split(' ')[0] ?? '';
  if (!placement.includes('/')) return { white: empty(), black: empty() };

  const whiteOnBoard = empty();
  const blackOnBoard = empty();
  for (const ch of placement) {
    const lower = ch.toLowerCase();
    if (lower in STARTING_COUNT) {
      if (ch === lower) blackOnBoard[lower] = (blackOnBoard[lower] ?? 0) + 1;
      else whiteOnBoard[lower] = (whiteOnBoard[lower] ?? 0) + 1;
    }
  }
  const white = empty();
  const black = empty();
  for (const t of CAPTURED_ORDER) {
    white[t] = Math.max(0, (STARTING_COUNT[t] ?? 0) - (whiteOnBoard[t] ?? 0));
    black[t] = Math.max(0, (STARTING_COUNT[t] ?? 0) - (blackOnBoard[t] ?? 0));
  }
  return { white, black };
}

function formatCaptured(counts: Record<string, number>, white: boolean): string {
  const parts: string[] = [];
  for (const t of CAPTURED_ORDER) {
    const n = counts[t] ?? 0;
    if (n <= 0) continue;
    const glyph = CAPTURED_GLYPH[white ? t.toUpperCase() : t] ?? '?';
    parts.push(n > 1 ? `${glyph}${n}` : glyph);
  }
  return parts.join(' ');
}

/**
 * Captured pieces derived from the FEN as a material diff (starting material minus
 * what's on the board). Promotions skew the count slightly — acceptable for a HUD.
 * `top` = captured Black pieces (Black's side renders at the top of the board);
 * `bottom` = captured White pieces.
 */
export function getCapturedDisplay(state: GameState): { top: string; bottom: string } {
  const { white, black } = getCapturedCounts(state);
  return {
    top: formatCaptured(black, false),
    bottom: formatCaptured(white, true),
  };
}

export function getCarouselItems(state: GameState): string[] {
  switch (state.phase) {
    case 'rowSelect': {
      const rows = getCandidateRows(state);
      return rows.map((r) => `Row ${r} (${getPiecesOnRow(state, r).length})`);
    }

    case 'pieceSelect': {
      const sel = getSelectedPiece(state);
      if (!sel) return state.pieces.map((p) => p.label);
      return getPiecesOnRow(state, rankOfSquare(sel.square)).map((p) => p.label);
    }

    case 'destSelect': {
      const piece = getSelectedPiece(state);
      if (!piece) return [];
      return piece.moves.map((m) => expandMoveName(m.san));
    }

    case 'promotionSelect':
      return ['Queen', 'Rook', 'Bishop', 'Knight'];

    default:
      return [];
  }
}

const SAN_PIECE_NAME: Record<string, string> = {
  K: 'King',
  Q: 'Queen',
  R: 'Rook',
  B: 'Bishop',
  N: 'Knight',
};

const PROMOTION_PIECE_NAME: Record<string, string> = {
  Q: 'Queen',
  R: 'Rook',
  B: 'Bishop',
  N: 'Knight',
};

/**
 * Expand SAN move to human-readable format.
 * Examples: "Nf3" → "Knight F3", "exd5" → "takes D5" or "Pawn takes D5"
 */
function expandMove(san: string, includePawnPrefix: boolean): string {
  if (san === 'O-O') return 'Castle Short';
  if (san === 'O-O-O') return 'Castle Long';

  const clean = san.replace(/[+#]/g, '');

  const promotionMatch = clean.match(/=([QRBN])/);
  const promotionPiece = promotionMatch ? PROMOTION_PIECE_NAME[promotionMatch[1]!] : null;
  const cleanNoPromotion = clean.replace(/=[QRBN]/, '');

  const isCapture = cleanNoPromotion.includes('x');
  const firstChar = cleanNoPromotion[0] ?? '';
  const pieceName = SAN_PIECE_NAME[firstChar];

  if (pieceName) {
    const rest = cleanNoPromotion.slice(1).replace('x', '').toUpperCase();
    // SAN piece suffix is [disambiguation][destination]; destination is always last 2 chars (e.g. d8).
    const destSquare = rest.length >= 2 ? rest.slice(-2) : rest;
    const base = isCapture ? `${pieceName} takes ${destSquare}` : `${pieceName} ${destSquare}`;
    return promotionPiece ? `${base}=${promotionPiece}` : base;
  }

  // Pawn move: extract destination square after 'x' for captures
  const captureIndex = cleanNoPromotion.indexOf('x');
  const destSquare = isCapture ? cleanNoPromotion.slice(captureIndex + 1).toUpperCase() : cleanNoPromotion.toUpperCase();
  
  if (promotionPiece) {
    if (includePawnPrefix) {
      return isCapture ? `Pawn takes ${destSquare}=${promotionPiece}` : `Pawn ${destSquare}=${promotionPiece}`;
    }
    return isCapture ? `takes ${destSquare}=${promotionPiece}` : `${destSquare}=${promotionPiece}`;
  }

  if (includePawnPrefix) {
    return isCapture ? `Pawn takes ${destSquare}` : `Pawn ${destSquare}`;
  }
  return isCapture ? `takes ${destSquare}` : destSquare;
}

function expandMoveName(san: string): string {
  return expandMove(san, false);
}

function expandMoveForLog(san: string): string {
  return expandMove(san, true);
}

export function getCarouselSelectedIndex(state: GameState): number {
  switch (state.phase) {
    case 'rowSelect': {
      const rows = getCandidateRows(state);
      const cur = getSelectedRow(state);
      const i = cur != null ? rows.indexOf(cur) : 0;
      return i >= 0 ? i : 0;
    }

    case 'pieceSelect': {
      const sel = getSelectedPiece(state);
      if (!sel) return 0;
      const rowPieces = getPiecesOnRow(state, rankOfSquare(sel.square));
      const i = rowPieces.findIndex((p) => p.id === sel.id);
      return i >= 0 ? i : 0;
    }

    case 'destSelect':
      return state.selectedMoveIndex;

    case 'promotionSelect':
      return state.selectedPromotionIndex;

    default:
      return 0;
  }
}

export function getStatusText(state: GameState): string {
  if (state.gameOver) {
    const reason = state.gameOver.charAt(0).toUpperCase() + state.gameOver.slice(1);
    return `Game Over: ${reason}`;
  }

  if (state.engineThinking) {
    return 'Engine thinking...';
  }

  const turnLabel = state.turn === 'w' ? 'White' : 'Black';
  const parts: string[] = [`${turnLabel} to move`];

  if (state.lastMove) {
    parts.push(`Last: ${state.lastMove}`);
  }

  const moveNum = getMoveNumber(state.history.length);
  parts.push(`Move ${moveNum}`);

  switch (state.phase) {
    case 'idle':
      parts.push('Scroll to select piece');
      break;
    case 'rowSelect':
      parts.push('Tap to choose row');
      break;
    case 'pieceSelect': {
      const row = getSelectedRow(state);
      parts.push(row != null ? `Row ${row}: tap to choose piece` : 'Tap to choose piece');
      break;
    }
    case 'destSelect': {
      const piece = getSelectedPiece(state);
      if (piece) {
        parts.push(`${piece.label}: tap to move`);
      }
      break;
    }
  }

  return parts.join(' | ');
}

export function getBoardPreviewData(state: GameState): {
  originSquare: string | null;
  destSquare: string | null;
} {
  const piece = getSelectedPiece(state);
  const move = getSelectedMove(state);
  return {
    originSquare: piece?.square ?? null,
    destSquare: move?.to ?? null,
  };
}

export function getCarouselDisplayText(state: GameState): string {
  const items = getCarouselItems(state);
  const index = getCarouselSelectedIndex(state);

  switch (state.phase) {
    case 'rowSelect': {
      if (items.length === 0) return 'No moves';
      const current = items[index] ?? items[0];
      return `< ${current} >  (${index + 1}/${items.length})`;
    }

    case 'pieceSelect': {
      if (items.length === 0) return 'No pieces';
      const current = items[index] ?? items[0];
      return `< ${current} >  (${index + 1}/${items.length})`;
    }

    case 'destSelect': {
      const piece = getSelectedPiece(state);
      if (items.length === 0) return 'No moves';
      const current = items[index] ?? items[0];
      const prefix = piece ? `${piece.label}: ` : '';
      return `${prefix}< ${current} >  (${index + 1}/${items.length})`;
    }

    case 'promotionSelect': {
      if (items.length === 0) return 'No options';
      const current = items[index] ?? items[0];
      return `< ${current} >  (${index + 1}/${items.length})`;
    }

    case 'idle':
    default:
      if (state.engineThinking) return '';
      if (state.gameOver) return 'Double-tap for new game';
      return 'Scroll to begin';
  }
}

export function getMenuDisplayText(state: GameState): string {
  const lines: string[] = [''];

  MENU_LABELS.forEach((label, i) => {
    // Hide Board Markers when large board is active (markers disabled in large mode)
    if (MENU_OPTIONS[i] === 'boardMarkers' && state.boardSize === 'large') return;
    const prefix = i === state.menuSelectedIndex ? '> ' : '  ';
    lines.push(`${prefix}${label}`);
  });

  return lines.join('\n');
}

export function getDifficultyDisplayText(state: GameState): string {
  const lines: string[] = ['', 'DIFFICULTY', ''];

  DIFFICULTY_LABELS.forEach((label, i) => {
    const prefix = i === state.menuSelectedIndex ? '> ' : '  ';
    const isActive = DIFFICULTY_OPTIONS[i] === state.difficulty;
    const current = isActive ? ' *' : '';
    // For the Custom row, show the active level inline so the user can see what they picked.
    const suffix = DIFFICULTY_OPTIONS[i] === 'custom' && isActive
      ? ` (${state.customSkillLevel})`
      : '';
    lines.push(`${prefix}${label}${suffix}${current}`);
  });

  return lines.join('\n');
}

export function getCustomDifficultyDisplayText(state: GameState): string {
  const level = state.customSkillLevel;
  const lines: string[] = ['', 'CUSTOM DIFFICULTY'];
  lines.push(`  Level: ${ARROW_LEFT} ${level} ${ARROW_RIGHT}   (0–9)`);
  lines.push('  Tap to confirm');
  lines.push('');
  lines.push('  0–1: Beginner');
  lines.push('  2–3: Easy');
  lines.push('  4–5: Casual');
  lines.push('  6–7: Strong');
  lines.push('  8–9: Expert');

  return lines.join('\n');
}

export function getBoardMarkersDisplayText(state: GameState): string {
  const lines: string[] = ['', 'BOARD MARKERS', ''];

  BOARD_MARKERS_LABELS.forEach((label, i) => {
    const prefix = i === state.menuSelectedIndex ? '> ' : '  ';
    const current = (i === 0 && state.showBoardMarkers) ||
                    (i === 1 && !state.showBoardMarkers) ? ' *' : '';
    lines.push(`${prefix}${label}${current}`);
  });

  return lines.join('\n');
}

export function getDisplayOptionsDisplayText(state: GameState): string {
  const lines: string[] = ['', 'DISPLAY OPTIONS', ''];

  DISPLAY_OPTIONS_LABELS.forEach((label, i) => {
    const prefix = i === state.menuSelectedIndex ? '> ' : '  ';
    lines.push(`${prefix}${label}`);
  });

  return lines.join('\n');
}

export function getBoardAlignmentDisplayText(state: GameState): string {
  const lines: string[] = ['', 'ALIGNMENT', ''];

  BOARD_ALIGNMENT_LABELS.forEach((label, i) => {
    const prefix = i === state.menuSelectedIndex ? '> ' : '  ';
    const current = BOARD_ALIGNMENT_OPTIONS[i] === state.boardAlignment ? ' *' : '';
    lines.push(`${prefix}${label}${current}`);
  });

  return lines.join('\n');
}

export function getBoardSizeDisplayText(state: GameState): string {
  const lines: string[] = ['', 'BOARD SIZE', ''];

  BOARD_SIZE_LABELS.forEach((label, i) => {
    const prefix = i === state.menuSelectedIndex ? '> ' : '  ';
    const current = BOARD_SIZE_OPTIONS[i] === state.boardSize ? ' *' : '';
    const note = BOARD_SIZE_OPTIONS[i] === 'large' ? ' (no markers)' : '';
    lines.push(`${prefix}${label}${note}${current}`);
  });

  return lines.join('\n');
}

export function getPlayAsDisplayText(state: GameState): string {
  const lines: string[] = ['', 'PLAY AS', ''];

  PLAY_AS_LABELS.forEach((label, i) => {
    const prefix = i === state.menuSelectedIndex ? '> ' : '  ';
    const current = PLAY_AS_OPTIONS[i] === state.playAs ? ' *' : '';
    lines.push(`${prefix}${label}${current}`);
  });

  return lines.join('\n');
}

/**
 * Truncates to most recent moves to stay within SDK's 2000 char limit.
 */
export function getLogDisplayText(state: GameState): string {
  const lines: string[] = ['', 'MOVE LOG', ''];

  if (state.history.length === 0) {
    lines.push('No moves yet');
    return lines.join('\n');
  }

  lines.push('White | Black');

  const moveCount = Math.ceil(state.history.length / 2);
  const startMove = moveCount > MAX_MOVES_DISPLAY ? moveCount - MAX_MOVES_DISPLAY : 0;
  
  if (startMove > 0) {
    lines.push(`... ${startMove} earlier moves`);
  }

  for (let i = startMove; i < moveCount; i++) {
    const whiteMove = state.history[i * 2] ?? '';
    const blackMove = state.history[i * 2 + 1] ?? '';
    const moveNum = i + 1;
    const whiteExpanded = whiteMove ? expandMoveForLog(whiteMove) : '';
    const blackExpanded = blackMove ? expandMoveForLog(blackMove) : '-';
    const line = `${moveNum}. ${whiteExpanded} | ${blackExpanded}`;
    lines.push(line);
  }

  return lines.join('\n');
}

export function getResetConfirmDisplayText(state: GameState): string {
  const lines: string[] = ['', 'RESET GAME', ''];
  lines.push('Start a new game?');
  lines.push('Progress will be lost.');
  lines.push('');

  const options = ['Confirm Reset', 'Cancel'];
  options.forEach((label, i) => {
    const prefix = i === state.menuSelectedIndex ? '> ' : '  ';
    lines.push(`${prefix}${label}`);
  });

  return lines.join('\n');
}

export function getExitConfirmDisplayText(state: GameState): string {
  const lines: string[] = ['', 'UNSAVED CHANGES', ''];
  lines.push('Save before exit?');
  lines.push('');

  const options = ['Save & Exit', 'Cancel'];
  options.forEach((label, i) => {
    const prefix = i === state.menuSelectedIndex ? '> ' : '  ';
    lines.push(`${prefix}${label}`);
  });

  return lines.join('\n');
}

export function getModeSelectDisplayText(state: GameState): string {
  const lines: string[] = ['', 'SELECT MODE', ''];

  MODE_LABELS.forEach((label, i) => {
    const prefix = i === state.menuSelectedIndex ? '> ' : '  ';
    const current = state.mode === MODE_OPTIONS[i] ? ' *' : '';
    lines.push(`${prefix}${label}${current}`);
  });

  return lines.join('\n');
}

export function getBulletSetupDisplayText(state: GameState): string {
  const lines: string[] = ['BULLET BLITZ'];
  lines.push('Select time control:');

  TIME_CONTROLS.forEach((tc, i) => {
    const prefix = i === state.selectedTimeControlIndex ? '> ' : '  ';
    lines.push(`${prefix}${tc.label}`);
  });

  return lines.join('\n');
}

export function getAcademySelectDisplayText(state: GameState): string {
  const lines: string[] = ['', 'ACADEMY'];
  lines.push('');

  DRILL_LABELS.forEach((label, i) => {
    const prefix = i === state.menuSelectedIndex ? '> ' : '  ';
    lines.push(`${prefix}${label}`);
  });

  return lines.join('\n');
}

export function getCoordinateDrillDisplayText(state: GameState): string {
  const academy = state.academyState;
  if (!academy?.targetSquare) {
    return 'Loading drill...';
  }

  const lines: string[] = ['', 'COORDINATE DRILL'];
  lines.push(`Score: ${academy.score.correct}/${academy.score.total}`);
  lines.push(`Find: ${academy.targetSquare.toUpperCase()}`);
  lines.push('');

  // Show feedback if answer was submitted
  if (academy.feedback === 'correct') {
    lines.push('+ CORRECT!');
    lines.push('');
    lines.push('Tap: next square');
  } else if (academy.feedback === 'incorrect') {
    const yourGuess = fileRankToSquare(academy.cursorFile, academy.cursorRank).toUpperCase();
    lines.push(`X WRONG (${yourGuess})`);
    lines.push('');
    lines.push('Tap: try again');
  } else {
    // Show current selection with axis indicator
    const file = getFileLetter(academy.cursorFile).toUpperCase();
    const rank = getRankNumber(academy.cursorRank);
    
    if (academy.navAxis === 'file') {
      // Selecting column (file) — show current file letter so user sees selection
      lines.push(`Column: ${ARROW_LEFT} ${file} ${ARROW_RIGHT}`);
      lines.push(`   Row: ${rank}`);
    } else {
      // Selecting row (rank) — up/down arrows match vertical scroll direction
      lines.push(`Column: ${file}`);
      lines.push(`   Row: ${ARROW_UP}  ${ARROW_DOWN}`);
    }
  }

  return lines.join('\n');
}

export function getKnightPathDisplayText(state: GameState): string {
  const academy = state.academyState;
  if (!academy?.knightPath) {
    return 'Loading drill...';
  }

  const kp = academy.knightPath;
  const lines: string[] = ['', 'KNIGHT PATH'];
  lines.push(`Score: ${academy.score.correct}/${academy.score.total}`);

  if (academy.feedback === 'correct') {
    lines.push('');
    lines.push('+ OPTIMAL!');
    lines.push(`Moves: ${kp.movesTaken}/${kp.optimalMoves}`);
    lines.push('');
    lines.push('Tap: next puzzle');
  } else if (academy.feedback === 'incorrect') {
    lines.push('');
    lines.push('X TOO MANY MOVES');
    lines.push(`Moves: ${kp.movesTaken}/${kp.optimalMoves}`);
    lines.push('');
    lines.push('Tap: try again');
  } else {
    lines.push(`${kp.startSquare.toUpperCase()} → ${kp.targetSquare.toUpperCase()}`);
    lines.push(`Moves: ${kp.movesTaken}/${kp.optimalMoves}`);
    lines.push('');
    const cursorSquare = fileRankToSquare(academy.cursorFile, academy.cursorRank).toUpperCase();
    lines.push(`Move to: ${cursorSquare} ${ARROW_UPDOWN}`);
  }

  return lines.join('\n');
}

export function getTacticsDisplayText(state: GameState): string {
  const academy = state.academyState;
  const isMate = academy?.drillType === 'mate';
  const drillName = isMate ? 'CHECKMATE' : 'TACTICS';
  const puzzle = academy?.tacticsPuzzle;

  const lines: string[] = ['', drillName];

  if (!puzzle) {
    lines.push('');
    lines.push('Loading...');
  } else if (academy?.feedback === 'correct') {
    // Show the solution
    lines.push('');
    lines.push('Solution:');
    const solution = puzzle.solution[0];
    if (solution) {
      const from = solution.slice(0, 2).toUpperCase();
      const to = solution.slice(2, 4).toUpperCase();
      lines.push(`${from} → ${to}`);
    }
    if (puzzle.description) {
      lines.push('');
      lines.push(puzzle.description);
    }
    lines.push('');
    lines.push('Tap: next puzzle');
  } else {
    lines.push('');
    lines.push(isMate ? 'Find mate in 1!' : 'Find the best move!');
    lines.push(`Theme: ${puzzle.theme}`);
    lines.push('Tap: show answer');
  }

  return lines.join('\n');
}

export function getPgnStudyDisplayText(state: GameState): string {
  const academy = state.academyState;
  const pgn = academy?.pgnStudy;

  const lines: string[] = ['PGN STUDY'];

  if (!pgn) {
    lines.push('');
    lines.push('Loading...');
  } else {
    lines.push(pgn.gameName);

    // Show move number and current moves
    const moveIndex = pgn.currentMoveIndex;

    if (moveIndex === 0) {
      lines.push('Start position');
      lines.push('');
      lines.push(`${ARROW_UPDOWN} Scroll: step`);
    } else if (moveIndex >= pgn.moves.length) {
      lines.push('Game complete!');
      lines.push('');
      lines.push('Tap: next game');
    } else {
      // Show the last few moves
      const startIdx = Math.max(0, moveIndex - 3);
      for (let i = startIdx; i <= moveIndex; i++) {
        const mn = Math.floor(i / 2) + 1;
        const isWhite = i % 2 === 0;
        const move = pgn.moves[i] ?? '';
        const prefix = isWhite ? `${mn}.` : '';
        const marker = i === moveIndex ? '>' : ' ';
        lines.push(`${marker}${prefix}${move}`);
      }
      lines.push('');
      lines.push(`${ARROW_UPDOWN} Step  Tap: skip`);
    }
  }

  return lines.join('\n');
}

export type CombinedDisplayTextOptions = {
  /** When false (text-first startup), avoid instructions that assume board images are on-screen. */
  boardReady?: boolean;
};

export function getCombinedDisplayText(state: GameState, options?: CombinedDisplayTextOptions): string {
  const boardReady = options?.boardReady !== false;

  switch (state.phase) {
    case 'menu':
      return getMenuDisplayText(state);
    case 'viewLog':
      return getLogDisplayText(state);
    case 'difficultySelect':
      return getDifficultyDisplayText(state);
    case 'customDifficultySelect':
      return getCustomDifficultyDisplayText(state);
    case 'boardMarkersSelect':
      return getBoardMarkersDisplayText(state);
    case 'displayOptionsSelect':
      return getDisplayOptionsDisplayText(state);
    case 'boardAlignmentSelect':
      return getBoardAlignmentDisplayText(state);
    case 'boardSizeSelect':
      return getBoardSizeDisplayText(state);
    case 'playAsSelect':
      return getPlayAsDisplayText(state);
    case 'resetConfirm':
      return getResetConfirmDisplayText(state);
    case 'exitConfirm':
      return getExitConfirmDisplayText(state);
    case 'modeSelect':
      return getModeSelectDisplayText(state);
    case 'bulletSetup':
      return getBulletSetupDisplayText(state);
    case 'academySelect':
      return getAcademySelectDisplayText(state);
    case 'coordinateDrill':
      return getCoordinateDrillDisplayText(state);
    case 'knightPathDrill':
      return getKnightPathDisplayText(state);
    case 'tacticsDrill':
    case 'mateDrill':
      return getTacticsDisplayText(state);
    case 'pgnStudy':
      return getPgnStudyDisplayText(state);
  }

  const lines: string[] = [];

  if (state.mode === 'bullet' && state.timers) {
    const whiteTime = formatTime(state.timers.whiteMs);
    const blackTime = formatTime(state.timers.blackMs);
    const isWhiteLow = state.timers.whiteMs < 10000;
    const isBlackLow = state.timers.blackMs < 10000;
    const whiteDisplay = isWhiteLow ? `!${whiteTime}!` : whiteTime;
    const blackDisplay = isBlackLow ? `!${blackTime}!` : blackTime;
    lines.push(`W ${whiteDisplay}  |  B ${blackDisplay}`);
  } else {
    lines.push('');
  }

  const turnLabel = state.turn === 'w' ? 'White' : 'Black';
  const moveNum = getMoveNumber(state.history.length);

  if (state.gameOver) {
    const reason = state.gameOver.charAt(0).toUpperCase() + state.gameOver.slice(1);
    lines.push(`Game Over: ${reason}`);
    lines.push(SEPARATOR_LINE);
    lines.push('');
    lines.push('Double-tap: new game');
    return lines.join('\n');
  }

  if (state.engineThinking) {
    lines.push(`${turnLabel} - Move ${moveNum}`);
    if (state.lastMove) lines.push(`Last: ${expandMoveName(state.lastMove)}`);
    lines.push(SEPARATOR_LINE);
    lines.push('');
    lines.push('Engine thinking...');
    return lines.join('\n');
  }

  lines.push(`${turnLabel} - Move ${moveNum}`);
  if (state.lastMove) lines.push(`Last: ${expandMoveName(state.lastMove)}`);
  lines.push(SEPARATOR_LINE);

  const items = getCarouselItems(state);
  const index = getCarouselSelectedIndex(state);

  switch (state.phase) {
    case 'idle': {
      lines.push('');
      const v = state.voice;
      const statusActive =
        !!v?.status && (v.statusExpiresAt == null || v.statusExpiresAt > Date.now());
      if (v?.pendingConfirm) {
        lines.push(`Heard: ${expandMoveForLog(v.pendingConfirm.san)}`);
        lines.push('Tap to confirm · Double-tap aborts');
      } else if (v?.listening) {
        lines.push(v.status ?? 'Listening… speak your move');
        lines.push('Tap to cancel  (e.g. Knight to C3)');
      } else if (statusActive && v) {
        lines.push(v.status!);
        if (boardReady) {
          lines.push('Tap to speak');
          lines.push(`Scroll to begin ${ARROW_UPDOWN}`);
        } else {
          lines.push('Preparing board…');
        }
      } else if (boardReady) {
        lines.push('Tap to speak');
        lines.push(`Scroll to begin ${ARROW_UPDOWN}`);
      } else {
        lines.push('Preparing board…');
      }
      break;
    }

    case 'rowSelect': {
      lines.push('');
      if (items.length > 0) {
        const current = items[index] ?? items[0];
        const innerContent = `${current} (${index + 1}/${items.length})`;
        const selectionLine = `${innerContent} ${ARROW_UPDOWN}`;
        lines.push('Select row:');
        lines.push(selectionLine);
      }
      break;
    }

    case 'pieceSelect': {
      lines.push('');
      if (items.length > 0) {
        const current = items[index] ?? items[0];
        const innerContent = `${current} (${index + 1}/${items.length})`;
        const selectionLine = `${innerContent} ${ARROW_UPDOWN}`;
        const row = getSelectedRow(state);
        lines.push(row != null ? `Select piece (Row ${row}):` : 'Select piece:');
        lines.push(selectionLine);
      }
      break;
    }

    case 'destSelect': {
      lines.push('');
      if (items.length > 0) {
        const piece = getSelectedPiece(state);
        const current = items[index] ?? items[0];
        const innerContent = `${current} (${index + 1}/${items.length})`;
        const selectionLine = `${innerContent} ${ARROW_UPDOWN}`;
        const label = piece ? `Moving: ${piece.label}` : 'Select move:';
        lines.push(label);
        lines.push(selectionLine);
      }
      break;
    }

    case 'promotionSelect': {
      lines.push('');
      if (items.length > 0) {
        const current = items[index] ?? items[0];
        const innerContent = `${current} (${index + 1}/${items.length})`;
        const selectionLine = `${innerContent} ${ARROW_UPDOWN}`;
        lines.push('Select promotion:');
        lines.push(selectionLine);
      }
      break;
    }
  }

  return lines.join('\n');
}
