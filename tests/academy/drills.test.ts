/**
 * Unit tests for coordinate drill functions.
 * Verifies square generation and cursor movement.
 */

import { describe, it, expect } from 'vitest';
import {
  generateRandomSquare,
  moveFile,
  moveRank,
  moveCursorAxis,
  getDefaultCursorPosition,
} from '../../src/academy/drills';
import { indicesToSquare } from '../../src/chess/square-utils';

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
      files.add(square.charAt(0));
    }
    expect(files.size).toBe(8);
  });

  it('generates all ranks over many iterations', () => {
    const ranks = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const square = generateRandomSquare();
      ranks.add(square.charAt(1));
    }
    expect(ranks.size).toBe(8);
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
    expect(indicesToSquare(pos.file, pos.rank)).toBe('e4');
  });
});
