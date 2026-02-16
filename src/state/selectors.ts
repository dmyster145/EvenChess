/**
 * Selectors — derive display data from GameState.
 *
 * Used by the page composer to build container configs.
 */

import type { GameState, PieceEntry, CarouselMove } from './contracts';
import {
  MENU_LABELS,
  DIFFICULTY_OPTIONS,
  DIFFICULTY_LABELS,
  BOARD_MARKERS_LABELS,
  MAX_MOVES_DISPLAY,
  MODE_LABELS,
  MODE_OPTIONS,
  TIME_CONTROLS,
  DRILL_LABELS,
} from './constants';
import { getMoveNumber } from './utils';
import { formatTime } from '../bullet/clock';
import { fileRankToSquare, getFileLetter, getRankNumber } from '../academy/drills';

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

export function getCarouselItems(state: GameState): string[] {
  switch (state.phase) {
    case 'pieceSelect':
      return state.pieces.map((p) => p.label);

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
    const base = isCapture ? `${pieceName} takes ${rest}` : `${pieceName} ${rest}`;
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
    case 'pieceSelect': {
      if (!state.selectedPieceId) return 0;
      const idx = state.pieces.findIndex((p) => p.id === state.selectedPieceId);
      return idx >= 0 ? idx : 0;
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
    case 'pieceSelect':
      parts.push('Tap to choose piece');
      break;
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
  const lines: string[] = ['', 'MENU', ''];

  MENU_LABELS.forEach((label, i) => {
    const prefix = i === state.menuSelectedIndex ? '> ' : '  ';
    lines.push(`${prefix}${label}`);
  });

  return lines.join('\n');
}

export function getDifficultyDisplayText(state: GameState): string {
  const lines: string[] = ['', 'DIFFICULTY', ''];

  DIFFICULTY_LABELS.forEach((label, i) => {
    const prefix = i === state.menuSelectedIndex ? '> ' : '  ';
    const current = DIFFICULTY_OPTIONS[i] === state.difficulty ? ' *' : '';
    lines.push(`${prefix}${label}${current}`);
  });

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
  const lines: string[] = ['', 'BULLET BLITZ'];
  lines.push('Select time control:');
  lines.push('');

  TIME_CONTROLS.forEach((tc, i) => {
    const prefix = i === state.selectedTimeControlIndex ? '> ' : '  ';
    lines.push(`${prefix}${tc.label}`);
  });

  return lines.join('\n');
}

export function getAcademySelectDisplayText(state: GameState): string {
  const lines: string[] = ['', 'ACADEMY'];
  lines.push('Select drill:');
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
    lines.push(`Move to: ${ARROW_LEFT} ${cursorSquare} ${ARROW_RIGHT}`);
  }

  return lines.join('\n');
}

export function getTacticsDisplayText(state: GameState): string {
  const academy = state.academyState;
  const isMate = academy?.drillType === 'mate';
  const drillName = isMate ? 'CHECKMATE' : 'TACTICS';
  const puzzle = academy?.tacticsPuzzle;

  const lines: string[] = ['', drillName];
  lines.push(`Score: ${academy?.score.correct ?? 0}/${academy?.score.total ?? 0}`);

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
    lines.push('');
    lines.push(`Theme: ${puzzle.theme}`);
    lines.push('');
    lines.push('Tap: show answer');
  }

  return lines.join('\n');
}

export function getPgnStudyDisplayText(state: GameState): string {
  const academy = state.academyState;
  const pgn = academy?.pgnStudy;

  const lines: string[] = ['', 'PGN STUDY'];

  if (!pgn) {
    lines.push('');
    lines.push('Loading...');
  } else {
    lines.push(pgn.gameName);
    lines.push('');

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

export function getCombinedDisplayText(state: GameState): string {
  switch (state.phase) {
    case 'menu':
      return getMenuDisplayText(state);
    case 'viewLog':
      return getLogDisplayText(state);
    case 'difficultySelect':
      return getDifficultyDisplayText(state);
    case 'boardMarkersSelect':
      return getBoardMarkersDisplayText(state);
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
  lines.push('');

  if (state.mode === 'bullet' && state.timers) {
    const whiteTime = formatTime(state.timers.whiteMs);
    const blackTime = formatTime(state.timers.blackMs);
    const isWhiteLow = state.timers.whiteMs < 10000;
    const isBlackLow = state.timers.blackMs < 10000;
    const whiteDisplay = isWhiteLow ? `!${whiteTime}!` : whiteTime;
    const blackDisplay = isBlackLow ? `!${blackTime}!` : blackTime;
    lines.push(`W ${whiteDisplay}  |  B ${blackDisplay}`);
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
    case 'idle':
      lines.push('');
      lines.push(`${ARROW_UPDOWN} Scroll to begin`);
      break;

    case 'pieceSelect': {
      lines.push('');
      if (items.length > 0) {
        const current = items[index] ?? items[0];
        const innerContent = `${current} (${index + 1}/${items.length})`;
        const selectionLine = `${ARROW_LEFT} ${innerContent} ${ARROW_RIGHT}`;
        const label = 'Select piece:';
        // Unicode arrows render ~2x normal char width; +3 shifts label right for visual centering
        const visualWidth = selectionLine.length + 2;
        const padding = Math.max(0, Math.floor((visualWidth - label.length) / 2) + 3);
        lines.push(' '.repeat(padding) + label);
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
        const selectionLine = `${ARROW_LEFT} ${innerContent} ${ARROW_RIGHT}`;
        const label = piece ? `Moving: ${piece.label}` : 'Select move:';
        // Unicode arrows render ~2x normal char width; +3 shifts label right for visual centering
        const visualWidth = selectionLine.length + 2;
        const padding = Math.max(0, Math.floor((visualWidth - label.length) / 2) + 3);
        lines.push(' '.repeat(padding) + label);
        lines.push(selectionLine);
      }
      break;
    }

    case 'promotionSelect': {
      lines.push('');
      if (items.length > 0) {
        const current = items[index] ?? items[0];
        const innerContent = `${current} (${index + 1}/${items.length})`;
        const selectionLine = `${ARROW_LEFT} ${innerContent} ${ARROW_RIGHT}`;
        const label = 'Select promotion:';
        const visualWidth = selectionLine.length + 2;
        const padding = Math.max(0, Math.floor((visualWidth - label.length) / 2) + 3);
        lines.push(' '.repeat(padding) + label);
        lines.push(selectionLine);
      }
      break;
    }
  }

  if (state.phase !== 'pieceSelect' && state.phase !== 'destSelect' && state.phase !== 'promotionSelect') {
    lines.push('');
    lines.push(SEPARATOR_LINE);
    lines.push('Menu: Double tap');
  }

  return lines.join('\n');
}
