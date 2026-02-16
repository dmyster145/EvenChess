/**
 * Unit tests for state utility functions.
 * Verifies move number calculation and phase type checking.
 */

import { describe, it, expect } from 'vitest';
import { getMoveNumber, isMenuPhase, isConfirmPhase } from '../../src/state/utils';
import type { UIPhase } from '../../src/state/contracts';

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

describe('isMenuPhase', () => {
  const menuPhases: UIPhase[] = [
    'menu',
    'viewLog',
    'difficultySelect',
    'resetConfirm',
    'exitConfirm',
    'modeSelect',
    'bulletSetup',
    'academySelect',
    'coordinateDrill',
    'tacticsDrill',
    'mateDrill',
    'knightPathDrill',
    'pgnStudy',
  ];

  const nonMenuPhases: UIPhase[] = [
    'idle',
    'pieceSelect',
    'destSelect',
    'confirm',
    'boardMarkersSelect',
  ];

  it('returns true for menu-related phases', () => {
    for (const phase of menuPhases) {
      expect(isMenuPhase(phase)).toBe(true);
    }
  });

  it('returns false for non-menu phases', () => {
    for (const phase of nonMenuPhases) {
      expect(isMenuPhase(phase)).toBe(false);
    }
  });
});

describe('isConfirmPhase', () => {
  it('returns true for resetConfirm', () => {
    expect(isConfirmPhase('resetConfirm')).toBe(true);
  });

  it('returns true for exitConfirm', () => {
    expect(isConfirmPhase('exitConfirm')).toBe(true);
  });

  it('returns false for all other phases', () => {
    const otherPhases: UIPhase[] = [
      'idle',
      'pieceSelect',
      'destSelect',
      'confirm',
      'menu',
      'viewLog',
      'difficultySelect',
      'boardMarkersSelect',
      'modeSelect',
      'bulletSetup',
      'academySelect',
      'coordinateDrill',
      'tacticsDrill',
      'mateDrill',
      'knightPathDrill',
      'pgnStudy',
    ];

    for (const phase of otherPhases) {
      expect(isConfirmPhase(phase)).toBe(false);
    }
  });
});
