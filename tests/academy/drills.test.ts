/**
 * Unit tests for coordinate drill functions.
 * Verifies square generation, answer checking, and cursor movement.
 */

import { describe, it, expect } from 'vitest';
import {
  generateRandomSquare,
  checkCoordinateAnswer,
  getFileIndex,
  getRankIndex,
  fileRankToSquare,
  moveFile,
  moveRank,
  moveCursorAxis,
  getDefaultCursorPosition,
  getFileLetter,
  getRankNumber,
} from '../../src/academy/drills';

describe('generateRandomSquare', () => {
  it('generates valid chess squares', () => {
    for (let i = 0; i < 100; i++) {
      const square = generateRandomSquare();
      expect(square).toMatch(/^[a-h][1-8]$/);
    }
  });

  it('generates all files over many iterations', () => {
    const files = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const square = generateRandomSquare();
      files.add(square[0]);
    }
    expect(files.size).toBe(8);
  });

  it('generates all ranks over many iterations', () => {
    const ranks = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const square = generateRandomSquare();
      ranks.add(square[1]);
    }
    expect(ranks.size).toBe(8);
  });
});

describe('checkCoordinateAnswer', () => {
  it('returns true for exact match', () => {
    expect(checkCoordinateAnswer('e4', 'e4')).toBe(true);
    expect(checkCoordinateAnswer('a1', 'a1')).toBe(true);
    expect(checkCoordinateAnswer('h8', 'h8')).toBe(true);
  });

  it('returns true for case-insensitive match', () => {
    expect(checkCoordinateAnswer('e4', 'E4')).toBe(true);
    expect(checkCoordinateAnswer('E4', 'e4')).toBe(true);
    expect(checkCoordinateAnswer('A1', 'a1')).toBe(true);
    expect(checkCoordinateAnswer('H8', 'h8')).toBe(true);
  });

  it('returns false for non-matching squares', () => {
    expect(checkCoordinateAnswer('e4', 'e5')).toBe(false);
    expect(checkCoordinateAnswer('e4', 'd4')).toBe(false);
    expect(checkCoordinateAnswer('a1', 'h8')).toBe(false);
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

describe('fileRankToSquare', () => {
  it('converts indices to square notation', () => {
    expect(fileRankToSquare(0, 0)).toBe('a1');
    expect(fileRankToSquare(4, 3)).toBe('e4');
    expect(fileRankToSquare(7, 7)).toBe('h8');
  });

  it('converts all corners correctly', () => {
    expect(fileRankToSquare(0, 0)).toBe('a1');
    expect(fileRankToSquare(7, 0)).toBe('h1');
    expect(fileRankToSquare(0, 7)).toBe('a8');
    expect(fileRankToSquare(7, 7)).toBe('h8');
  });

  it('roundtrips with getFileIndex and getRankIndex', () => {
    const squares = ['a1', 'e4', 'h8', 'b5', 'g2'];
    for (const square of squares) {
      const file = getFileIndex(square);
      const rank = getRankIndex(square);
      expect(fileRankToSquare(file, rank)).toBe(square);
    }
  });
});

describe('moveFile', () => {
  it('moves right on up direction', () => {
    expect(moveFile(0, 'up')).toBe(1); // a -> b
    expect(moveFile(3, 'up')).toBe(4); // d -> e
    expect(moveFile(6, 'up')).toBe(7); // g -> h
  });

  it('moves left on down direction', () => {
    expect(moveFile(7, 'down')).toBe(6); // h -> g
    expect(moveFile(4, 'down')).toBe(3); // e -> d
    expect(moveFile(1, 'down')).toBe(0); // b -> a
  });

  it('wraps around from h to a', () => {
    expect(moveFile(7, 'up')).toBe(0);
  });

  it('wraps around from a to h', () => {
    expect(moveFile(0, 'down')).toBe(7);
  });
});

describe('moveRank', () => {
  it('moves up on up direction', () => {
    expect(moveRank(0, 'up')).toBe(1); // 1 -> 2
    expect(moveRank(3, 'up')).toBe(4); // 4 -> 5
    expect(moveRank(6, 'up')).toBe(7); // 7 -> 8
  });

  it('moves down on down direction', () => {
    expect(moveRank(7, 'down')).toBe(6); // 8 -> 7
    expect(moveRank(4, 'down')).toBe(3); // 5 -> 4
    expect(moveRank(1, 'down')).toBe(0); // 2 -> 1
  });

  it('wraps around from 8 to 1', () => {
    expect(moveRank(7, 'up')).toBe(0);
  });

  it('wraps around from 1 to 8', () => {
    expect(moveRank(0, 'down')).toBe(7);
  });
});

describe('moveCursorAxis', () => {
  it('moves file when axis is file', () => {
    const result = moveCursorAxis(3, 4, 'file', 'up');
    expect(result.file).toBe(4);
    expect(result.rank).toBe(4); // Unchanged
  });

  it('moves rank when axis is rank', () => {
    const result = moveCursorAxis(3, 4, 'rank', 'up');
    expect(result.file).toBe(3); // Unchanged
    expect(result.rank).toBe(5);
  });

  it('handles file wrap-around', () => {
    const result = moveCursorAxis(7, 3, 'file', 'up');
    expect(result.file).toBe(0);
    expect(result.rank).toBe(3);
  });

  it('handles rank wrap-around', () => {
    const result = moveCursorAxis(3, 7, 'rank', 'up');
    expect(result.file).toBe(3);
    expect(result.rank).toBe(0);
  });

  it('moves file down with wrap-around', () => {
    const result = moveCursorAxis(0, 3, 'file', 'down');
    expect(result.file).toBe(7);
    expect(result.rank).toBe(3);
  });

  it('moves rank down with wrap-around', () => {
    const result = moveCursorAxis(3, 0, 'rank', 'down');
    expect(result.file).toBe(3);
    expect(result.rank).toBe(7);
  });
});

describe('getDefaultCursorPosition', () => {
  it('returns e4 as default', () => {
    const pos = getDefaultCursorPosition();
    expect(pos.file).toBe(4); // e
    expect(pos.rank).toBe(3); // 4
  });

  it('can be converted to e4 square', () => {
    const pos = getDefaultCursorPosition();
    expect(fileRankToSquare(pos.file, pos.rank)).toBe('e4');
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
  it('returns correct numbers for valid indices', () => {
    expect(getRankNumber(0)).toBe('1');
    expect(getRankNumber(1)).toBe('2');
    expect(getRankNumber(2)).toBe('3');
    expect(getRankNumber(3)).toBe('4');
    expect(getRankNumber(4)).toBe('5');
    expect(getRankNumber(5)).toBe('6');
    expect(getRankNumber(6)).toBe('7');
    expect(getRankNumber(7)).toBe('8');
  });

  it('returns 1 for invalid indices', () => {
    expect(getRankNumber(-1)).toBe('1');
    expect(getRankNumber(8)).toBe('1');
    expect(getRankNumber(100)).toBe('1');
  });
});
