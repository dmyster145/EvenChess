import { describe, it, expect } from 'vitest';
import { ChessService } from '../../src/chess/chessservice';

describe('ChessService', () => {
  it('starts at the initial position', () => {
    const chess = new ChessService();
    expect(chess.getTurn()).toBe('w');
    expect(chess.isGameOver()).toBe(false);
    expect(chess.getFen()).toContain('rnbqkbnr');
  });

  it('returns pieces with legal moves', () => {
    const chess = new ChessService();
    const pieces = chess.getPiecesWithMoves();

    // White should have pieces with moves at start
    expect(pieces.length).toBeGreaterThan(0);

    // All returned pieces should be white (it's white's turn)
    for (const piece of pieces) {
      expect(piece.color).toBe('w');
      expect(piece.moves.length).toBeGreaterThan(0);
    }
  });

  it('generates stable piece IDs', () => {
    const id = ChessService.pieceId('w', 'n', 'g1');
    expect(id).toBe('w-n-g1');
  });

  it('sorts pieces by value (high first)', () => {
    const chess = new ChessService();
    const pieces = chess.getPiecesWithMoves();

    // In starting position, only pawns and knights can move
    // Knights (value 3) should come before pawns (value 1)
    const types = pieces.map((p) => p.type);
    const firstKnight = types.indexOf('n');
    const firstPawn = types.indexOf('p');

    if (firstKnight >= 0 && firstPawn >= 0) {
      expect(firstKnight).toBeLessThan(firstPawn);
    }
  });

  it('makes a valid move and updates state', () => {
    const chess = new ChessService();
    const result = chess.makeMove('e2', 'e4');
    expect(result).toBe('e4');
    expect(chess.getTurn()).toBe('b');
  });

  it('makes a move via UCI notation', () => {
    const chess = new ChessService();
    const result = chess.makeMoveUci('e2e4');
    expect(result).toBe('e4');
    expect(chess.getTurn()).toBe('b');
  });

  it('rejects illegal moves', () => {
    const chess = new ChessService();
    const result = chess.makeMove('e2', 'e5'); // can't jump 3 squares
    expect(result).toBeNull();
  });

  it('detects checkmate', () => {
    const chess = new ChessService();
    // Scholar's mate
    chess.makeMove('e2', 'e4');
    chess.makeMove('e7', 'e5');
    chess.makeMove('f1', 'c4');
    chess.makeMove('b8', 'c6');
    chess.makeMove('d1', 'h5');
    chess.makeMove('g8', 'f6');
    chess.makeMove('h5', 'f7');

    expect(chess.isGameOver()).toBe(true);
    expect(chess.isCheckmate()).toBe(true);
    expect(chess.getGameOverReason()).toBe('checkmate');
  });

  it('resets to starting position', () => {
    const chess = new ChessService();
    chess.makeMove('e2', 'e4');
    chess.reset();
    expect(chess.getTurn()).toBe('w');
    expect(chess.getHistory()).toHaveLength(0);
  });

  it('gets piece at a square', () => {
    const chess = new ChessService();
    const piece = chess.getPieceAt('e2');
    expect(piece).not.toBeNull();
    expect(piece!.type).toBe('p');
    expect(piece!.color).toBe('w');

    const empty = chess.getPieceAt('e4');
    expect(empty).toBeNull();
  });

  it('orders moves with captures first, then by progress towards opponent side', () => {
    // After 1.e4 e5 2.Nf3 Nc6: white to move, knight on f3 can capture on e5 or make quiet moves
    const chess = new ChessService();
    chess.makeMove('e2', 'e4');
    chess.makeMove('e7', 'e5');
    chess.makeMove('g1', 'f3');
    chess.makeMove('b8', 'c6');
    const pieces = chess.getPiecesWithMoves();
    const knight = pieces.find((p) => p.square === 'f3');
    expect(knight).toBeDefined();
    expect(knight!.moves.length).toBeGreaterThan(0);
    const firstMove = knight!.moves[0];
    expect(firstMove.san).toBe('Nxe5'); // capture should be first
  });
});
