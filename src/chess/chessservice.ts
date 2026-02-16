/**
 * ChessService — wraps chess.js with a domain-specific API.
 */

import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js';
import type { PieceId, PieceEntry, CarouselMove } from '../state/contracts';

const PIECE_LABEL: Record<PieceSymbol, string> = {
  k: 'King',
  q: 'Queen',
  r: 'Rook',
  b: 'Bishop',
  n: 'Knight',
  p: 'Pawn',
};

export class ChessService {
  private game: Chess;
  private cachedPieces: PieceEntry[] | null = null;
  private cachedPiecesFen: string | null = null;

  constructor(fen?: string) {
    this.game = fen ? new Chess(fen) : new Chess();
  }

  getFen(): string {
    return this.game.fen();
  }

  getTurn(): 'w' | 'b' {
    return this.game.turn();
  }

  isGameOver(): boolean {
    return this.game.isGameOver();
  }

  isCheckmate(): boolean {
    return this.game.isCheckmate();
  }

  isDraw(): boolean {
    return this.game.isDraw();
  }

  isStalemate(): boolean {
    return this.game.isStalemate();
  }

  isInCheck(): boolean {
    return this.game.inCheck();
  }

  getHistory(): string[] {
    return this.game.history();
  }

  getGameOverReason(): string | null {
    if (!this.game.isGameOver()) return null;
    if (this.game.isCheckmate()) return 'checkmate';
    if (this.game.isStalemate()) return 'stalemate';
    if (this.game.isThreefoldRepetition()) return 'repetition';
    if (this.game.isInsufficientMaterial()) return 'insufficient';
    if (this.game.isDraw()) return 'draw';
    return 'unknown';
  }

  getPieceAt(square: string): { type: PieceSymbol; color: 'w' | 'b' } | null {
    return this.game.get(square as Square) ?? null;
  }

  getBoard() {
    return this.game.board();
  }

  // Piece ID format: "w-n-f3" (white knight on f3)
  static pieceId(color: 'w' | 'b', type: PieceSymbol, square: string): PieceId {
    return `${color}-${type}-${square}`;
  }

  // Memoized by FEN
  getPiecesWithMoves(): PieceEntry[] {
    const currentFen = this.game.fen();
    if (this.cachedPiecesFen === currentFen && this.cachedPieces) {
      return this.cachedPieces;
    }

    const moves = this.game.moves({ verbose: true }) as Move[];
    const bySquare = new Map<string, Move[]>();
    for (const m of moves) {
      const existing = bySquare.get(m.from);
      if (existing) {
        existing.push(m);
      } else {
        bySquare.set(m.from, [m]);
      }
    }

    const entries: PieceEntry[] = [];

    for (const [square, pieceMoves] of bySquare) {
      const piece = this.game.get(square as Square);
      if (!piece) continue;

      const id = ChessService.pieceId(piece.color, piece.type, square);
      const label = `${PIECE_LABEL[piece.type]} ${square.toUpperCase()}`;

      // Prioritize: captures first, then moves towards opponent's side, then by destination (rank, file), then promotion Q,R,B,N
      const sortedMoves = [...pieceMoves].sort((a, b) => {
        const captureA = !!a.captured;
        const captureB = !!b.captured;
        if (captureA !== captureB) return captureA ? -1 : 1; // captures first
        const toRankA = parseInt(a.to[1]!, 10);
        const toRankB = parseInt(b.to[1]!, 10);
        const progressA = piece.color === 'w' ? toRankA : 9 - toRankA;
        const progressB = piece.color === 'w' ? toRankB : 9 - toRankB;
        if (progressA !== progressB) return progressB - progressA; // higher progress (towards opponent) first
        if (toRankA !== toRankB) return toRankA - toRankB;
        if (a.to !== b.to) return a.to.charCodeAt(0) - b.to.charCodeAt(0);
        const promoOrder: Record<string, number> = { q: 0, r: 1, b: 2, n: 3 };
        return (promoOrder[a.promotion ?? ''] ?? 4) - (promoOrder[b.promotion ?? ''] ?? 4);
      });

      const carouselMoves: CarouselMove[] = sortedMoves.map((m) => ({
        uci: `${m.from}${m.to}${m.promotion ?? ''}`,
        san: m.san,
        from: m.from,
        to: m.to,
        promotion: m.promotion,
      }));

      entries.push({
        id,
        label,
        color: piece.color,
        type: piece.type,
        square,
        moves: carouselMoves,
      });
    }

    // Piece order for swipe carousel: rank 1→8, then file a→h (a1, b1, …, h1, a2, …)
    entries.sort((a, b) => {
      const fileA = a.square.charCodeAt(0);
      const fileB = b.square.charCodeAt(0);
      const rankA = parseInt(a.square[1]!, 10);
      const rankB = parseInt(b.square[1]!, 10);
      if (rankA !== rankB) return rankA - rankB;
      return fileA - fileB;
    });

    this.cachedPiecesFen = currentFen;
    this.cachedPieces = entries;
    return entries;
  }

  getStateSnapshot(): { fen: string; turn: 'w' | 'b'; pieces: PieceEntry[]; inCheck: boolean } {
    return {
      fen: this.getFen(),
      turn: this.getTurn(),
      pieces: this.getPiecesWithMoves(),
      inCheck: this.isInCheck(),
    };
  }

  private invalidateCache(): void {
    this.cachedPieces = null;
    this.cachedPiecesFen = null;
  }

  makeMove(from: string, to: string, promotion?: string): string | null {
    try {
      const result = this.game.move({
        from: from as Square,
        to: to as Square,
        promotion: promotion as PieceSymbol | undefined,
      });
      if (result) {
        this.invalidateCache();
      }
      return result?.san ?? null;
    } catch {
      return null;
    }
  }

  makeMoveUci(uci: string): string | null {
    if (!uci || uci.length < 4) {
      console.error('[ChessService] Invalid UCI string:', uci);
      return null;
    }
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    return this.makeMove(from, to, promotion);
  }

  reset(): boolean {
    try {
      this.game.reset();
      this.invalidateCache();
      return true;
    } catch (err) {
      console.error('[ChessService] Reset failed:', err);
      return false;
    }
  }

  loadFen(fen: string): boolean {
    try {
      this.game.load(fen);
      this.invalidateCache();
      return true;
    } catch (err) {
      console.error('[ChessService] Invalid FEN:', fen, err);
      return false;
    }
  }
}
