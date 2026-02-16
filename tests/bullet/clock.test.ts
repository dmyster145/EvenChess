/**
 * Unit tests for bullet mode timer logic.
 * Verifies timer tick, increment, expiration, and formatting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tickTimer, applyIncrement, isTimeExpired, formatTime } from '../../src/bullet/clock';
import type { GameState } from '../../src/state/contracts';

function createTimerState(overrides?: Partial<GameState>): GameState {
  return {
    fen: 'startpos',
    turn: 'w',
    pieces: [],
    phase: 'idle',
    selectedPieceId: null,
    selectedMoveIndex: 0,
    mode: 'bullet',
    history: [],
    lastMove: null,
    engineThinking: false,
    inCheck: false,
    gameOver: null,
    pendingMove: null,
    menuSelectedIndex: 0,
    hasUnsavedChanges: false,
    previousPhase: null,
    difficulty: 'casual',
    logScrollOffset: 0,
    phaseEnteredAt: Date.now(),
    timerActive: true,
    lastTickTime: Date.now(),
    selectedTimeControlIndex: 0,
    showBoardMarkers: true,
    timers: {
      whiteMs: 60000, // 1 minute
      blackMs: 60000,
      incrementMs: 0,
    },
    ...overrides,
  };
}

describe('tickTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty object when timer not active', () => {
    const state = createTimerState({ timerActive: false });
    const result = tickTimer(state);
    expect(result).toEqual({});
  });

  it('returns empty object when no timers configured', () => {
    const state = createTimerState({ timers: undefined });
    const result = tickTimer(state);
    expect(result).toEqual({});
  });

  it('decrements white time when it is white turn', () => {
    const now = Date.now();
    const state = createTimerState({
      turn: 'w',
      lastTickTime: now - 1000, // 1 second ago
    });
    
    const result = tickTimer(state);
    
    expect(result.timers).toBeDefined();
    expect(result.timers!.whiteMs).toBe(59000); // 60000 - 1000
    expect(result.timers!.blackMs).toBe(60000); // Unchanged
  });

  it('decrements black time when it is black turn', () => {
    const now = Date.now();
    const state = createTimerState({
      turn: 'b',
      lastTickTime: now - 2000, // 2 seconds ago
    });
    
    const result = tickTimer(state);
    
    expect(result.timers).toBeDefined();
    expect(result.timers!.blackMs).toBe(58000); // 60000 - 2000
    expect(result.timers!.whiteMs).toBe(60000); // Unchanged
  });

  it('clamps time to zero (never negative)', () => {
    const now = Date.now();
    const state = createTimerState({
      turn: 'w',
      lastTickTime: now - 100000, // More than available time
      timers: {
        whiteMs: 5000,
        blackMs: 60000,
        incrementMs: 0,
      },
    });
    
    const result = tickTimer(state);
    
    expect(result.timers!.whiteMs).toBe(0);
  });

  it('handles null lastTickTime (first tick)', () => {
    const state = createTimerState({
      lastTickTime: null,
    });
    
    const result = tickTimer(state);
    
    // With null lastTickTime, elapsed is 0, so time shouldn't change
    expect(result.timers!.whiteMs).toBe(60000);
    expect(result.lastTickTime).toBeDefined();
  });

  it('updates lastTickTime to current time', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    
    const state = createTimerState({
      lastTickTime: now - 500,
    });
    
    const result = tickTimer(state);
    
    expect(result.lastTickTime).toBe(now);
  });
});

describe('applyIncrement', () => {
  it('returns empty object when no timers configured', () => {
    const state = createTimerState({ timers: undefined });
    const result = applyIncrement(state, 'w');
    expect(result).toEqual({});
  });

  it('adds increment to white time', () => {
    const state = createTimerState({
      timers: {
        whiteMs: 50000,
        blackMs: 60000,
        incrementMs: 2000, // 2 second increment
      },
    });
    
    const result = applyIncrement(state, 'w');
    
    expect(result.timers!.whiteMs).toBe(52000);
    expect(result.timers!.blackMs).toBe(60000); // Unchanged
  });

  it('adds increment to black time', () => {
    const state = createTimerState({
      timers: {
        whiteMs: 60000,
        blackMs: 45000,
        incrementMs: 3000, // 3 second increment
      },
    });
    
    const result = applyIncrement(state, 'b');
    
    expect(result.timers!.blackMs).toBe(48000);
    expect(result.timers!.whiteMs).toBe(60000); // Unchanged
  });

  it('handles zero increment', () => {
    const state = createTimerState({
      timers: {
        whiteMs: 60000,
        blackMs: 60000,
        incrementMs: 0,
      },
    });
    
    const result = applyIncrement(state, 'w');
    
    expect(result.timers!.whiteMs).toBe(60000); // Unchanged
  });
});

describe('isTimeExpired', () => {
  it('returns false when no timers configured', () => {
    const state = createTimerState({ timers: undefined });
    expect(isTimeExpired(state, 'w')).toBe(false);
    expect(isTimeExpired(state, 'b')).toBe(false);
  });

  it('returns false when time remaining', () => {
    const state = createTimerState({
      timers: {
        whiteMs: 30000,
        blackMs: 30000,
        incrementMs: 0,
      },
    });
    
    expect(isTimeExpired(state, 'w')).toBe(false);
    expect(isTimeExpired(state, 'b')).toBe(false);
  });

  it('returns true when white time is zero', () => {
    const state = createTimerState({
      timers: {
        whiteMs: 0,
        blackMs: 30000,
        incrementMs: 0,
      },
    });
    
    expect(isTimeExpired(state, 'w')).toBe(true);
    expect(isTimeExpired(state, 'b')).toBe(false);
  });

  it('returns true when black time is zero', () => {
    const state = createTimerState({
      timers: {
        whiteMs: 30000,
        blackMs: 0,
        incrementMs: 0,
      },
    });
    
    expect(isTimeExpired(state, 'w')).toBe(false);
    expect(isTimeExpired(state, 'b')).toBe(true);
  });

  it('returns true when time is negative (edge case)', () => {
    const state = createTimerState({
      timers: {
        whiteMs: -100,
        blackMs: 30000,
        incrementMs: 0,
      },
    });
    
    expect(isTimeExpired(state, 'w')).toBe(true);
  });
});

describe('formatTime', () => {
  it('formats zero as 0:00', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('formats seconds correctly', () => {
    expect(formatTime(5000)).toBe('0:05');
    expect(formatTime(30000)).toBe('0:30');
    expect(formatTime(59000)).toBe('0:59');
  });

  it('formats minutes and seconds', () => {
    expect(formatTime(60000)).toBe('1:00');
    expect(formatTime(90000)).toBe('1:30');
    expect(formatTime(125000)).toBe('2:05');
  });

  it('formats large times', () => {
    expect(formatTime(300000)).toBe('5:00'); // 5 minutes
    expect(formatTime(600000)).toBe('10:00'); // 10 minutes
  });

  it('pads single-digit seconds with zero', () => {
    expect(formatTime(61000)).toBe('1:01');
    expect(formatTime(65000)).toBe('1:05');
    expect(formatTime(69000)).toBe('1:09');
  });

  it('handles sub-second precision (floors)', () => {
    expect(formatTime(1500)).toBe('0:01'); // 1.5 seconds -> 1 second
    expect(formatTime(999)).toBe('0:00'); // 0.999 seconds -> 0 seconds
  });
});
