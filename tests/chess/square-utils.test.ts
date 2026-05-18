/**
 * Board-orientation coordinate mapping (White vs flipped Black perspective).
 */

import { describe, it, expect } from 'vitest';
import { squareToDisplayCoords, rankToDisplayRank } from '../../src/chess/square-utils';

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
