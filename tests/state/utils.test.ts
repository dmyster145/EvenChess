/**
 * Unit tests for state utility functions.
 * Verifies move number calculation, Play As color resolution, the phase groups and the
 * Custom skill clamp.
 */

import { describe, it, expect } from 'vitest';
import {
  getMoveNumber,
  resolvePlayerColor,
  GAME_PHASES,
  MENU_PHASES,
  SUBMENU_PHASES,
  INVERTED_SCROLL_PHASES,
} from '../../src/state/utils';
import { clampCustomSkillLevel, CUSTOM_SKILL_LEVEL_DEFAULT } from '../../src/state/contracts';

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

  it('returns 2 once White and Black have each moved (White\'s second move is next)', () => {
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

describe('phase groups', () => {
  it('splits gameplay, the menu screens and the drills apart', () => {
    expect([...GAME_PHASES]).toEqual(['idle', 'rowSelect', 'pieceSelect', 'destSelect', 'promotionSelect']);
    expect([...SUBMENU_PHASES].sort()).toEqual([
      'academySelect', 'bulletSetup', 'customDifficultySelect', 'difficultySelect',
      'displayOptionsSelect', 'modeSelect', 'playAsSelect', 'resetConfirm', 'viewLog',
    ]);
    expect([...MENU_PHASES].sort()).toEqual(['menu', ...SUBMENU_PHASES].sort());
    for (const drill of ['coordinateDrill', 'tacticsDrill', 'mateDrill', 'knightPathDrill', 'pgnStudy'] as const) {
      expect(GAME_PHASES.has(drill) || MENU_PHASES.has(drill)).toBe(false);
    }
  });

  it('inverts scrolling on every menu screen except View Log', () => {
    expect(SUBMENU_PHASES.has('viewLog')).toBe(true);
    expect(INVERTED_SCROLL_PHASES.has('viewLog')).toBe(false);
    expect([...INVERTED_SCROLL_PHASES].sort()).toEqual([...MENU_PHASES].filter((p) => p !== 'viewLog').sort());
  });
});

describe('clampCustomSkillLevel', () => {
  it('rounds into 0..9 and maps non-finite input to the default', () => {
    expect(clampCustomSkillLevel(-3)).toBe(0);
    expect(clampCustomSkillLevel(0)).toBe(0);
    expect(clampCustomSkillLevel(4.6)).toBe(5);
    expect(clampCustomSkillLevel(9)).toBe(9);
    expect(clampCustomSkillLevel(42)).toBe(9);
    expect(clampCustomSkillLevel(Number.NaN)).toBe(CUSTOM_SKILL_LEVEL_DEFAULT);
    expect(clampCustomSkillLevel(Number.POSITIVE_INFINITY)).toBe(CUSTOM_SKILL_LEVEL_DEFAULT);
  });
});
