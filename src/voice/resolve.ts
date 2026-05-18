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

  // Promotion: candidates split into promotion vs normal.
  const promo = candidates.filter((c) => c.move.promotion);
  const normal = candidates.filter((c) => !c.move.promotion);

  if (promo.length > 0 && normal.length === 0) {
    if (!intent.promotion) {
      return {
        kind: 'needsPromotion',
        message: `Promote to? say queen, rook, bishop or knight`,
      };
    }
    candidates = promo.filter((c) => c.move.promotion === intent.promotion);
    if (candidates.length === 0) {
      return { kind: 'illegal', message: `Can't promote there` };
    }
  } else {
    // Non-promotion intent wins when a normal move exists.
    candidates = normal.length > 0 ? normal : candidates;
  }

  // Distinct source squares left → genuine ambiguity (e.g. two knights to c3).
  const sources = [...new Set(candidates.map((c) => c.piece.square))];
  if (sources.length > 1) {
    const what = intent.piece ? PIECE_NAME[intent.piece] : 'piece';
    const list = sources.map((s) => s.toUpperCase()).join(' or ');
    return { kind: 'ambiguous', message: `Which ${what}? ${list}` };
  }

  return { kind: 'move', move: candidates[0]!.move };
}
