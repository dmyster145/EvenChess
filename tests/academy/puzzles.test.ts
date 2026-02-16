/**
 * Unit tests for tactics and mate puzzles.
 * Verifies that all puzzles have valid positions and correct solutions.
 */

import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { TACTICS_PUZZLES, MATE_PUZZLES } from '../../src/academy/puzzles';

describe('MATE_PUZZLES', () => {
  MATE_PUZZLES.forEach((puzzle, index) => {
    describe(`Puzzle ${index + 1}: ${puzzle.description}`, () => {
      it('should have a valid FEN position', () => {
        const chess = new Chess();
        expect(() => chess.load(puzzle.fen)).not.toThrow();
      });

      it('should not already be in checkmate', () => {
        const chess = new Chess();
        chess.load(puzzle.fen);
        expect(chess.isCheckmate()).toBe(false);
      });

      it('should not be stalemate', () => {
        const chess = new Chess();
        chess.load(puzzle.fen);
        expect(chess.isStalemate()).toBe(false);
      });

      it('should have exactly one solution move', () => {
        expect(puzzle.solution.length).toBe(1);
      });

      it('should have a legal solution move', () => {
        const chess = new Chess();
        chess.load(puzzle.fen);
        const move = puzzle.solution[0];
        expect(move).toBeDefined();
        
        // Convert UCI to move object
        const from = move!.slice(0, 2);
        const to = move!.slice(2, 4);
        const promotion = move!.length > 4 ? move![4] : undefined;
        
        const result = chess.move({ from, to, promotion });
        expect(result).not.toBeNull();
      });

      it('should result in checkmate after the solution', () => {
        const chess = new Chess();
        chess.load(puzzle.fen);
        const move = puzzle.solution[0]!;
        
        const from = move.slice(0, 2);
        const to = move.slice(2, 4);
        const promotion = move.length > 4 ? move[4] : undefined;
        
        chess.move({ from, to, promotion });
        expect(chess.isCheckmate()).toBe(true);
      });
    });
  });
});

describe('TACTICS_PUZZLES', () => {
  TACTICS_PUZZLES.forEach((puzzle, index) => {
    describe(`Puzzle ${index + 1}: ${puzzle.description}`, () => {
      it('should have a valid FEN position', () => {
        const chess = new Chess();
        expect(() => chess.load(puzzle.fen)).not.toThrow();
      });

      it('should not already be in checkmate', () => {
        const chess = new Chess();
        chess.load(puzzle.fen);
        expect(chess.isCheckmate()).toBe(false);
      });

      it('should have at least one solution move', () => {
        expect(puzzle.solution.length).toBeGreaterThan(0);
      });

      it('should have a legal first solution move', () => {
        const chess = new Chess();
        chess.load(puzzle.fen);
        const move = puzzle.solution[0];
        expect(move).toBeDefined();
        
        const from = move!.slice(0, 2);
        const to = move!.slice(2, 4);
        const promotion = move!.length > 4 ? move![4] : undefined;
        
        const result = chess.move({ from, to, promotion });
        expect(result).not.toBeNull();
      });
    });
  });
});
