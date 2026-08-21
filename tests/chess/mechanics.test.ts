import { describe, it, expect } from 'vitest';
import { ChessService } from '../../src/chess/chessservice';

/**
 * Confirms the special-move mechanics surface correctly through ChessService (chess.js wrapper):
 * castling, promotion, and en passant — the moves that need care because they don't map 1:1 to a
 * simple from→to. Rules themselves are chess.js's; these guard that the app's move generation
 * (getPiecesWithMoves) and execution (makeMove) expose and apply them as the UI expects.
 */
describe('ChessService — special-move mechanics', () => {
  describe('castling', () => {
    const CASTLE_FEN = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

    it('offers kingside and queenside castling as two-square king moves', () => {
      const chess = new ChessService(CASTLE_FEN);
      const king = chess.getPiecesWithMoves().find((p) => p.type === 'k');
      expect(king).toBeDefined();
      const byTo = new Map(king!.moves.map((m) => [m.to, m.san]));
      expect(byTo.get('g1')).toBe('O-O');
      expect(byTo.get('c1')).toBe('O-O-O');
    });

    it('executes kingside castling (king→g1, rook→f1)', () => {
      const chess = new ChessService(CASTLE_FEN);
      expect(chess.makeMove('e1', 'g1')).toBe('O-O');
      expect(chess.getPieceAt('g1')).toMatchObject({ type: 'k', color: 'w' });
      expect(chess.getPieceAt('f1')).toMatchObject({ type: 'r', color: 'w' });
      expect(chess.getPieceAt('e1')).toBeNull();
      expect(chess.getPieceAt('h1')).toBeNull();
    });

    it('executes queenside castling (king→c1, rook→d1)', () => {
      const chess = new ChessService(CASTLE_FEN);
      expect(chess.makeMove('e1', 'c1')).toBe('O-O-O');
      expect(chess.getPieceAt('c1')).toMatchObject({ type: 'k', color: 'w' });
      expect(chess.getPieceAt('d1')).toMatchObject({ type: 'r', color: 'w' });
    });

    it('black castles too (king→g8, rook→f8)', () => {
      const chess = new ChessService('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
      expect(chess.makeMove('e8', 'g8')).toBe('O-O');
      expect(chess.getPieceAt('g8')).toMatchObject({ type: 'k', color: 'b' });
      expect(chess.getPieceAt('f8')).toMatchObject({ type: 'r', color: 'b' });
    });

    it('does not offer castling without rights', () => {
      const chess = new ChessService('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1');
      const king = chess.getPiecesWithMoves().find((p) => p.type === 'k');
      const sans = king!.moves.map((m) => m.san);
      expect(sans).not.toContain('O-O');
      expect(sans).not.toContain('O-O-O');
    });
  });

  describe('promotion (pawn reaching the far rank)', () => {
    const PROMO_FEN = '8/P7/8/8/8/8/8/k6K w - - 0 1';

    it('offers all four promotion pieces as separate moves to the same square', () => {
      const chess = new ChessService(PROMO_FEN);
      const pawn = chess.getPiecesWithMoves().find((p) => p.type === 'p');
      expect(pawn).toBeDefined();
      const promos = pawn!.moves.filter((m) => m.to === 'a8').map((m) => m.promotion).sort();
      expect(promos).toEqual(['b', 'n', 'q', 'r']);
    });

    it('promotes to each chosen piece', () => {
      for (const piece of ['q', 'r', 'b', 'n'] as const) {
        const chess = new ChessService(PROMO_FEN);
        chess.makeMove('a7', 'a8', piece);
        expect(chess.getPieceAt('a8')).toMatchObject({ type: piece, color: 'w' });
        expect(chess.getPieceAt('a7')).toBeNull();
      }
    });

    it('supports capture-with-promotion', () => {
      const chess = new ChessService('r6k/1P6/8/8/8/8/8/7K w - - 0 1');
      const san = chess.makeMove('b7', 'a8', 'q');
      expect(san).toBe('bxa8=Q+'); // capture + promotion + check
      expect(chess.getPieceAt('a8')).toMatchObject({ type: 'q', color: 'w' });
    });
  });

  describe('en passant', () => {
    it('captures the passed pawn and vacates its square', () => {
      const chess = new ChessService('7k/8/8/3pP3/8/8/8/7K w - d6 0 1');
      const pawn = chess.getPiecesWithMoves().find((p) => p.square === 'e5');
      expect(pawn!.moves.some((m) => m.to === 'd6')).toBe(true);
      expect(chess.makeMove('e5', 'd6')).toBe('exd6');
      expect(chess.getPieceAt('d6')).toMatchObject({ type: 'p', color: 'w' });
      expect(chess.getPieceAt('d5')).toBeNull(); // en-passant-captured pawn removed
    });
  });

  describe('game-end detection', () => {
    it('detects stalemate', () => {
      const chess = new ChessService('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
      expect(chess.isStalemate()).toBe(true);
      expect(chess.isGameOver()).toBe(true);
      expect(chess.getGameOverReason()).toBe('stalemate');
    });

    it('detects insufficient material (K vs K)', () => {
      const chess = new ChessService('7k/8/8/8/8/8/8/7K w - - 0 1');
      expect(chess.isGameOver()).toBe(true);
      expect(chess.getGameOverReason()).toBe('insufficient');
    });

    it('detects check without game over', () => {
      const chess = new ChessService('4k3/8/8/8/8/8/8/4R2K b - - 0 1'); // Re1 checks Ke8 down the e-file
      expect(chess.isInCheck()).toBe(true);
      expect(chess.isGameOver()).toBe(false);
    });
  });
});
