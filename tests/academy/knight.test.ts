/**
 * Unit tests for knight path challenge logic.
 * Verifies puzzle generation and pathfinding work correctly.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  getKnightMoves,
  findKnightDistance,
  generateKnightPuzzle,
  isValidKnightMove,
} from '../../src/academy/knight';
import { squareToIndices } from '../../src/chess/square-utils';

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

  it('should return 6 for corner to opposite corner (the board maximum)', () => {
    expect(findKnightDistance('a1', 'h8')).toBe(6);
    expect(findKnightDistance('h8', 'a1')).toBe(6);
  });

  it('should return 4 for a1 to b2 (diagonal neighbour of a corner)', () => {
    expect(findKnightDistance('a1', 'b2')).toBe(4);
  });

  it('should return 5 for a1 to h7', () => {
    expect(findKnightDistance('a1', 'h7')).toBe(5);
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
    const [startFile, startRank] = squareToIndices(puzzle.start);
    const [targetFile, targetRank] = squareToIndices(puzzle.target);
    
    expect(startFile).toBeGreaterThanOrEqual(0);
    expect(startFile).toBeLessThanOrEqual(7);
    expect(startRank).toBeGreaterThanOrEqual(0);
    expect(startRank).toBeLessThanOrEqual(7);
    
    expect(targetFile).toBeGreaterThanOrEqual(0);
    expect(targetFile).toBeLessThanOrEqual(7);
    expect(targetRank).toBeGreaterThanOrEqual(0);
    expect(targetRank).toBeLessThanOrEqual(7);
  });

  it('should respect custom minMoves parameter', () => {
    for (let i = 0; i < 10; i++) {
      const puzzle = generateKnightPuzzle(3, 4);
      expect(puzzle.optimalMoves).toBeGreaterThanOrEqual(3);
      expect(puzzle.optimalMoves).toBeLessThanOrEqual(4);
    }
  });
});

describe('generateKnightPuzzle with scripted random picks', () => {
  /** Math.random returns these in order; each value v picks index floor(v * 8). */
  function withRandom<T>(values: number[], fn: () => T): T {
    let i = 0;
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => values[i++]!);
    try {
      return fn();
    } finally {
      spy.mockRestore();
    }
  }
  const pick = (index: number) => (index + 0.5) / 8;

  it('returns the first in-range pick with its BFS distance as optimalMoves', () => {
    // Picks: e4 → c4 (distance 2).
    const p = withRandom([pick(4), pick(3), pick(2), pick(3)], () => generateKnightPuzzle());
    expect(p).toEqual({ start: 'e4', target: 'c4', optimalMoves: 2 });
  });

  it('skips a pick whose distance is out of range and uses the next one', () => {
    // First pick a1 → h8 (6 moves, above the default max of 4), then a1 → b2 (4 moves).
    const p = withRandom(
      [pick(0), pick(0), pick(7), pick(7), pick(0), pick(0), pick(1), pick(1)],
      () => generateKnightPuzzle(),
    );
    expect(p).toEqual({ start: 'a1', target: 'b2', optimalMoves: 4 });
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

describe('generateKnightPuzzle fallback (when every random pick is out of range)', () => {
  it('still returns a puzzle in range with its true optimal move count', () => {
    // Every random pick lands on a1 → a1 (start === target), so all attempts are rejected.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      for (const [min, max] of [[2, 4], [5, 6], [3, 3]] as const) {
        const p = generateKnightPuzzle(min, max);
        expect(p.optimalMoves).toBe(findKnightDistance(p.start, p.target));
        expect(p.optimalMoves).toBeGreaterThanOrEqual(min);
        expect(p.optimalMoves).toBeLessThanOrEqual(max);
      }
    } finally {
      spy.mockRestore();
    }
  });
});
