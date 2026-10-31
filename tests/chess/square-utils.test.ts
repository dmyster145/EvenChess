/**
 * Square notation helpers and board-orientation coordinate mapping.
 */

import { describe, it, expect } from 'vitest';
import {
  squareToDisplayCoords,
  rankToDisplayRank,
  getFileIndex,
  getRankIndex,
  indicesToSquare,
  squareToIndices,
  getFileLetter,
  getRankNumber,
} from '../../src/chess/square-utils';

describe('rankToDisplayRank', () => {
  it('White: rank 8 → row 0 (top), rank 1 → row 7 (bottom)', () => {
    expect(rankToDisplayRank(8, 'w')).toBe(0);
    expect(rankToDisplayRank(1, 'w')).toBe(7);
    expect(rankToDisplayRank(4, 'w')).toBe(4);
  });

  it('Black (flipped): rank 1 → row 0 (top), rank 8 → row 7 (bottom)', () => {
    expect(rankToDisplayRank(1, 'b')).toBe(0);
    expect(rankToDisplayRank(8, 'b')).toBe(7);
    expect(rankToDisplayRank(4, 'b')).toBe(3);
  });

  it('defaults to White when no color given', () => {
    expect(rankToDisplayRank(8)).toBe(0);
  });
});

describe('squareToDisplayCoords', () => {
  it('White: a1 bottom-left, h8 top-right', () => {
    expect(squareToDisplayCoords('a1', 'w')).toEqual({ file: 0, displayRank: 7 });
    expect(squareToDisplayCoords('h8', 'w')).toEqual({ file: 7, displayRank: 0 });
    expect(squareToDisplayCoords('e2', 'w')).toEqual({ file: 4, displayRank: 6 });
  });

  it('Black (180° flip): a1 top-right, h8 bottom-left', () => {
    expect(squareToDisplayCoords('a1', 'b')).toEqual({ file: 7, displayRank: 0 });
    expect(squareToDisplayCoords('h8', 'b')).toEqual({ file: 0, displayRank: 7 });
    expect(squareToDisplayCoords('e2', 'b')).toEqual({ file: 3, displayRank: 1 });
  });

  it('defaults to White when no color given', () => {
    expect(squareToDisplayCoords('a1')).toEqual({ file: 0, displayRank: 7 });
  });
});

describe('getFileIndex', () => {
  it('returns correct index for each file', () => {
    expect(getFileIndex('a1')).toBe(0);
    expect(getFileIndex('b2')).toBe(1);
    expect(getFileIndex('c3')).toBe(2);
    expect(getFileIndex('d4')).toBe(3);
    expect(getFileIndex('e5')).toBe(4);
    expect(getFileIndex('f6')).toBe(5);
    expect(getFileIndex('g7')).toBe(6);
    expect(getFileIndex('h8')).toBe(7);
  });

  it('handles uppercase files', () => {
    expect(getFileIndex('A1')).toBe(0);
    expect(getFileIndex('H8')).toBe(7);
  });

  it('returns -1 for invalid file', () => {
    expect(getFileIndex('i1')).toBe(-1);
    expect(getFileIndex('z5')).toBe(-1);
  });

  it('returns -1 for empty string', () => {
    expect(getFileIndex('')).toBe(-1);
  });
});

describe('getRankIndex', () => {
  it('returns correct index for each rank', () => {
    expect(getRankIndex('a1')).toBe(0);
    expect(getRankIndex('a2')).toBe(1);
    expect(getRankIndex('a3')).toBe(2);
    expect(getRankIndex('a4')).toBe(3);
    expect(getRankIndex('a5')).toBe(4);
    expect(getRankIndex('a6')).toBe(5);
    expect(getRankIndex('a7')).toBe(6);
    expect(getRankIndex('a8')).toBe(7);
  });

  it('returns -1 for invalid rank', () => {
    expect(getRankIndex('a0')).toBe(-1);
    expect(getRankIndex('a9')).toBe(-1);
  });

  it('returns -1 for single character', () => {
    expect(getRankIndex('a')).toBe(-1);
  });
});

describe('indicesToSquare', () => {
  it('converts indices to square notation', () => {
    expect(indicesToSquare(0, 0)).toBe('a1');
    expect(indicesToSquare(4, 3)).toBe('e4');
    expect(indicesToSquare(7, 7)).toBe('h8');
  });

  it('converts all corners correctly', () => {
    expect(indicesToSquare(0, 0)).toBe('a1');
    expect(indicesToSquare(7, 0)).toBe('h1');
    expect(indicesToSquare(0, 7)).toBe('a8');
    expect(indicesToSquare(7, 7)).toBe('h8');
  });

  it('roundtrips with getFileIndex and getRankIndex', () => {
    const squares = ['a1', 'e4', 'h8', 'b5', 'g2'];
    for (const square of squares) {
      const file = getFileIndex(square);
      const rank = getRankIndex(square);
      expect(indicesToSquare(file, rank)).toBe(square);
    }
  });
});

describe('squareToIndices', () => {
  it('should convert a1 to file 0, rank 0', () => {
    expect(squareToIndices('a1')).toEqual([0, 0]);
  });

  it('should convert h8 to file 7, rank 7', () => {
    expect(squareToIndices('h8')).toEqual([7, 7]);
  });

  it('should convert e4 to file 4, rank 3', () => {
    expect(squareToIndices('e4')).toEqual([4, 3]);
  });
});

describe('getFileLetter', () => {
  it('returns correct letters for valid indices', () => {
    expect(getFileLetter(0)).toBe('a');
    expect(getFileLetter(1)).toBe('b');
    expect(getFileLetter(2)).toBe('c');
    expect(getFileLetter(3)).toBe('d');
    expect(getFileLetter(4)).toBe('e');
    expect(getFileLetter(5)).toBe('f');
    expect(getFileLetter(6)).toBe('g');
    expect(getFileLetter(7)).toBe('h');
  });

  it('returns a for invalid indices', () => {
    expect(getFileLetter(-1)).toBe('a');
    expect(getFileLetter(8)).toBe('a');
    expect(getFileLetter(100)).toBe('a');
  });
});

describe('getRankNumber', () => {
  it('returns the chess rank number for a rank index', () => {
    expect(getRankNumber(0)).toBe(1);
    expect(getRankNumber(3)).toBe(4);
    expect(getRankNumber(7)).toBe(8);
  });
});
