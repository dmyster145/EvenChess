/**
 * Unit tests for state utility functions.
 * Verifies move number calculation and Play As color resolution.
 */

import { describe, it, expect } from 'vitest';
import { getMoveNumber, resolvePlayerColor } from '../../src/state/utils';

describe('resolvePlayerColor', () => {
  it('maps white→w and black→b', () => {
    expect(resolvePlayerColor('white')).toBe('w');
    expect(resolvePlayerColor('black')).toBe('b');
  });

  it('random returns w or b (both reachable)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(resolvePlayerColor('random'));
    expect([...seen].every((c) => c === 'w' || c === 'b')).toBe(true);
    expect(seen.size).toBe(2);
  });
});

describe('getMoveNumber', () => {
  it('returns 1 for empty history', () => {
    expect(getMoveNumber(0)).toBe(1);
  });

  it('returns 1 for first move (white)', () => {
    expect(getMoveNumber(1)).toBe(1);
  });

  it('returns 2 for second move (black)', () => {
    expect(getMoveNumber(2)).toBe(2);
  });

  it('returns correct move number for various history lengths', () => {
    // Move 1: white (index 0), black (index 1)
    // Move 2: white (index 2), black (index 3)
    // Move 3: white (index 4), black (index 5)
    expect(getMoveNumber(0)).toBe(1); // Before white's first move
    expect(getMoveNumber(1)).toBe(1); // After white's first move
    expect(getMoveNumber(2)).toBe(2); // After black's first move (move 2)
    expect(getMoveNumber(3)).toBe(2); // After white's second move
    expect(getMoveNumber(4)).toBe(3); // After black's second move (move 3)
    expect(getMoveNumber(10)).toBe(6);
    expect(getMoveNumber(20)).toBe(11);
  });

  it('handles large move counts', () => {
    expect(getMoveNumber(100)).toBe(51);
    expect(getMoveNumber(199)).toBe(100);
    expect(getMoveNumber(200)).toBe(101);
  });
});
