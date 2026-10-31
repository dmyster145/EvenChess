/**
 * VoiceIntent + game state → a concrete legal move (or a helpful failure).
 *
 * Resolves against `state.pieces[].moves`, which the engine already computed as the
 * full set of *legal* CarouselMoves — so a resolved move is guaranteed legal and the
 * existing pendingMove → TurnLoop path re-validates it anyway.
 */

import type { GameState, CarouselMove, PieceEntry } from '../state/contracts';
import { getFileIndex, isValidSquare, rankOfSquare } from '../chess/square-utils';
import type { VoiceIntent } from './parse';
import type { PieceType } from './grammar';

export type ResolveResult =
  | { kind: 'move'; move: CarouselMove }
  | { kind: 'ambiguous'; message: string }
  | { kind: 'needsPromotion'; message: string }
  | { kind: 'illegal'; message: string }
  | { kind: 'unparsed'; message: string };

const PIECE_NAME: Record<PieceType, string> = {
  k: 'King', q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight', p: 'Pawn',
};

function bareSan(san: string): string {
  return san.replace(/[+#]/g, '');
}

interface Candidate {
  move: CarouselMove;
  piece: PieceEntry;
}

export function resolveVoiceMove(intent: VoiceIntent, state: GameState): ResolveResult {
  const playerPieces = state.pieces.filter((p) => p.color === state.playerColor);

  if (intent.castle) {
    const want = intent.castle === 'q' ? 'O-O-O' : 'O-O';
    for (const p of playerPieces) {
      if (p.type !== 'k') continue;
      const m = p.moves.find((mv) => bareSan(mv.san) === want);
      if (m) return { kind: 'move', move: m };
    }
    const side = intent.castle === 'q' ? 'queenside' : 'kingside';
    return { kind: 'illegal', message: `Can't castle ${side}` };
  }

  if (!intent.to || !isValidSquare(intent.to)) {
    return { kind: 'unparsed', message: 'Didn’t catch a move' };
  }
  const to = intent.to;

  // All legal moves landing on the destination square, with their owning piece.
  let candidates: Candidate[] = [];
  for (const piece of playerPieces) {
    for (const move of piece.moves) {
      if (move.to === to) candidates.push({ move, piece });
    }
  }

  if (candidates.length === 0) {
    const what = intent.piece ? PIECE_NAME[intent.piece] : 'move';
    return { kind: 'illegal', message: `No ${what} to ${to.toUpperCase()}` };
  }

  if (intent.piece) {
    candidates = candidates.filter((c) => c.piece.type === intent.piece);
  }
  if (intent.fromFile !== undefined) {
    candidates = candidates.filter((c) => getFileIndex(c.piece.square) === intent.fromFile);
  }
  if (intent.fromRank !== undefined) {
    candidates = candidates.filter((c) => rankOfSquare(c.piece.square) === intent.fromRank);
  }

  if (candidates.length === 0) {
    const what = intent.piece ? PIECE_NAME[intent.piece] : 'piece';
    return { kind: 'illegal', message: `No ${what} can reach ${to.toUpperCase()}` };
  }

  // "takes" prefers a capture. Moves to one square only differ in capturing via en passant (the
  // square is empty, so another piece may move there quietly). If no candidate captures, the word
  // was probably misheard, so it is ignored rather than rejecting the move.
  if (intent.isCapture) {
    const captures = candidates.filter((c) => c.move.san.includes('x'));
    if (captures.length > 0) candidates = captures;
  }

  // Promotion: candidates split into promotion vs normal. A spoken promotion piece means the
  // pawn promotion; with none spoken, a normal move to the square wins if there is one.
  const promo = candidates.filter((c) => c.move.promotion);
  const normal = candidates.filter((c) => !c.move.promotion);

  if (promo.length > 0 && (normal.length === 0 || intent.promotion)) {
    if (!intent.promotion) {
      // Each utterance is parsed on its own, so ask for the whole move again, not one word.
      return {
        kind: 'needsPromotion',
        message: `Promote to? Say e.g. "${to.toUpperCase()} queen"`,
      };
    }
    candidates = promo.filter((c) => c.move.promotion === intent.promotion);
    if (candidates.length === 0) {
      return { kind: 'illegal', message: `Can't promote there` };
    }
  } else {
    candidates = normal.length > 0 ? normal : candidates;
  }

  // Distinct source squares left → genuine ambiguity (e.g. two knights to c3).
  const sources = [...new Set(candidates.map((c) => c.piece.square))];
  if (sources.length > 1) {
    const what = intent.piece ? PIECE_NAME[intent.piece] : 'piece';
    const list = sources.map((s) => s.toUpperCase()).join(' or ');
    // Ask for the whole move including its square, since a lone "B1" would be parsed as a
    // destination (and could match a different move).
    const example = `${what === 'piece' ? '' : `${what.toLowerCase()} `}${sources[0]!.toUpperCase()} to ${to.toUpperCase()}`;
    return { kind: 'ambiguous', message: `Which ${what}, ${list}? Say e.g. "${example}"` };
  }

  return { kind: 'move', move: candidates[0]!.move };
}
