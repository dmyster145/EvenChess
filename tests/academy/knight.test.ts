/**
 * Unit tests for knight path challenge logic.
 * Verifies puzzle generation and pathfinding work correctly.
 */

import { describe, it, expect } from 'vitest';
import {
  getKnightMoves,
  findKnightDistance,
  generateKnightPuzzle,
  isValidKnightMove,
  getSquareIndices,
} from '../../src/academy/knight';

describe('getSquareIndices', () => {
  it('should convert a1 to file 0, rank 0', () => {
    expect(getSquareIndices('a1')).toEqual({ file: 0, rank: 0 });
  });

  it('should convert h8 to file 7, rank 7', () => {
    expect(getSquareIndices('h8')).toEqual({ file: 7, rank: 7 });
  });

  it('should convert e4 to file 4, rank 3', () => {
    expect(getSquareIndices('e4')).toEqual({ file: 4, rank: 3 });
  });
});

describe('getKnightMoves', () => {
  it('should return all valid moves from center square', () => {
    const moves = getKnightMoves('e4');
    expect(moves).toHaveLength(8);
    expect(moves).toContain('d2');
    expect(moves).toContain('f2');
    expect(moves).toContain('c3');
    expect(moves).toContain('g3');
    expect(moves).toContain('c5');
    expect(moves).toContain('g5');
    expect(moves).toContain('d6');
    expect(moves).toContain('f6');
  });

  it('should return fewer moves from corner', () => {
    const moves = getKnightMoves('a1');
    expect(moves).toHaveLength(2);
    expect(moves).toContain('b3');
    expect(moves).toContain('c2');
  });

  it('should return fewer moves from edge', () => {
    const moves = getKnightMoves('a4');
    expect(moves).toHaveLength(4);
  });
});

describe('findKnightDistance', () => {
  it('should return 0 for same square', () => {
    expect(findKnightDistance('e4', 'e4')).toBe(0);
  });

  it('should return 1 for adjacent knight move', () => {
    expect(findKnightDistance('e4', 'f6')).toBe(1);
    expect(findKnightDistance('e4', 'd2')).toBe(1);
  });

  it('should return 2 for two moves away', () => {
    // e4 -> d6 -> c4 or e4 -> f6 -> g4
    expect(findKnightDistance('e4', 'c4')).toBe(2);
    expect(findKnightDistance('e4', 'g4')).toBe(2);
  });

  it('should return 3 for a1 to b1', () => {
    // a1 is tricky - need 3 moves to reach b1
    expect(findKnightDistance('a1', 'b1')).toBe(3);
  });

  it('should handle maximum distance across board', () => {
    // a1 to h8 should be reachable
    const distance = findKnightDistance('a1', 'h8');
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThanOrEqual(6);
  });
});

describe('generateKnightPuzzle', () => {
  it('should generate puzzle with different start and target', () => {
    const puzzle = generateKnightPuzzle();
    expect(puzzle.start).not.toBe(puzzle.target);
  });

  it('should have optimal moves between 2 and 4 by default', () => {
    for (let i = 0; i < 10; i++) {
      const puzzle = generateKnightPuzzle();
      expect(puzzle.optimalMoves).toBeGreaterThanOrEqual(2);
      expect(puzzle.optimalMoves).toBeLessThanOrEqual(4);
    }
  });

  it('should have valid squares', () => {
    const puzzle = generateKnightPuzzle();
    const startIndices = getSquareIndices(puzzle.start);
    const targetIndices = getSquareIndices(puzzle.target);
    
    expect(startIndices.file).toBeGreaterThanOrEqual(0);
    expect(startIndices.file).toBeLessThanOrEqual(7);
    expect(startIndices.rank).toBeGreaterThanOrEqual(0);
    expect(startIndices.rank).toBeLessThanOrEqual(7);
    
    expect(targetIndices.file).toBeGreaterThanOrEqual(0);
    expect(targetIndices.file).toBeLessThanOrEqual(7);
    expect(targetIndices.rank).toBeGreaterThanOrEqual(0);
    expect(targetIndices.rank).toBeLessThanOrEqual(7);
  });

  it('should respect custom minMoves parameter', () => {
    for (let i = 0; i < 10; i++) {
      const puzzle = generateKnightPuzzle(3, 4);
      expect(puzzle.optimalMoves).toBeGreaterThanOrEqual(3);
      expect(puzzle.optimalMoves).toBeLessThanOrEqual(4);
    }
  });
});

describe('isValidKnightMove', () => {
  it('should return true for valid knight moves', () => {
    expect(isValidKnightMove('e4', 'f6')).toBe(true);
    expect(isValidKnightMove('e4', 'd6')).toBe(true);
    expect(isValidKnightMove('e4', 'c5')).toBe(true);
    expect(isValidKnightMove('e4', 'c3')).toBe(true);
    expect(isValidKnightMove('e4', 'd2')).toBe(true);
    expect(isValidKnightMove('e4', 'f2')).toBe(true);
    expect(isValidKnightMove('e4', 'g3')).toBe(true);
    expect(isValidKnightMove('e4', 'g5')).toBe(true);
  });

  it('should return false for invalid knight moves', () => {
    expect(isValidKnightMove('e4', 'e5')).toBe(false);
    expect(isValidKnightMove('e4', 'e6')).toBe(false);
    expect(isValidKnightMove('e4', 'f5')).toBe(false);
    expect(isValidKnightMove('e4', 'a1')).toBe(false);
    expect(isValidKnightMove('e4', 'e4')).toBe(false);
  });
});
