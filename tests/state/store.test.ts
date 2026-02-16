/**
 * Unit tests for the reactive store implementation.
 * Verifies createStore, dispatch, and subscribe behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../../src/state/store';
import type { GameState, PieceEntry, Action } from '../../src/state/contracts';

function createTestState(overrides?: Partial<GameState>): GameState {
  const pieces: PieceEntry[] = [
    {
      id: 'w-n-g1',
      label: 'Ng1',
      color: 'w',
      type: 'n',
      square: 'g1',
      moves: [
        { uci: 'g1f3', san: 'Nf3', from: 'g1', to: 'f3' },
      ],
    },
  ];

  return {
    fen: 'startpos',
    turn: 'w',
    pieces,
    phase: 'idle',
    selectedPieceId: null,
    selectedMoveIndex: 0,
    mode: 'play',
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
    timerActive: false,
    lastTickTime: null,
    selectedTimeControlIndex: 2,
    showBoardMarkers: true,
    ...overrides,
  };
}

describe('createStore', () => {
  it('returns a store with getState, dispatch, and subscribe methods', () => {
    const initialState = createTestState();
    const store = createStore(initialState);

    expect(typeof store.getState).toBe('function');
    expect(typeof store.dispatch).toBe('function');
    expect(typeof store.subscribe).toBe('function');
  });

  it('getState returns the current state', () => {
    const initialState = createTestState({ turn: 'w', phase: 'idle' });
    const store = createStore(initialState);

    expect(store.getState()).toBe(initialState);
    expect(store.getState().turn).toBe('w');
    expect(store.getState().phase).toBe('idle');
  });
});

describe('dispatch', () => {
  it('updates state via reducer', () => {
    const initialState = createTestState({ phase: 'idle' });
    const store = createStore(initialState);

    store.dispatch({ type: 'SCROLL', direction: 'down' });

    expect(store.getState().phase).toBe('pieceSelect');
  });

  it('notifies listeners when state changes', () => {
    const initialState = createTestState({ phase: 'idle' });
    const store = createStore(initialState);
    const listener = vi.fn();

    store.subscribe(listener);
    store.dispatch({ type: 'SCROLL', direction: 'down' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'pieceSelect' }),
      initialState
    );
  });

  it('passes both new state and previous state to listeners', () => {
    const initialState = createTestState({ phase: 'idle' });
    const store = createStore(initialState);
    const listener = vi.fn();

    store.subscribe(listener);
    store.dispatch({ type: 'SCROLL', direction: 'down' });

    const [newState, prevState] = listener.mock.calls[0];
    expect(prevState.phase).toBe('idle');
    expect(newState.phase).toBe('pieceSelect');
  });

  it('does not notify listeners when state unchanged', () => {
    const initialState = createTestState({ gameOver: 'checkmate' });
    const store = createStore(initialState);
    const listener = vi.fn();

    store.subscribe(listener);
    // SCROLL is blocked when gameOver is set, so state shouldn't change
    store.dispatch({ type: 'SCROLL', direction: 'down' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies multiple listeners', () => {
    const initialState = createTestState();
    const store = createStore(initialState);
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const listener3 = vi.fn();

    store.subscribe(listener1);
    store.subscribe(listener2);
    store.subscribe(listener3);

    store.dispatch({ type: 'SCROLL', direction: 'down' });

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
    expect(listener3).toHaveBeenCalledTimes(1);
  });

  it('handles listener errors gracefully', () => {
    const initialState = createTestState();
    const store = createStore(initialState);
    const errorListener = vi.fn(() => {
      throw new Error('Listener error');
    });
    const normalListener = vi.fn();

    store.subscribe(errorListener);
    store.subscribe(normalListener);

    // Should not throw
    expect(() => {
      store.dispatch({ type: 'SCROLL', direction: 'down' });
    }).not.toThrow();

    // Both listeners should have been called
    expect(errorListener).toHaveBeenCalled();
    expect(normalListener).toHaveBeenCalled();
  });
});

describe('subscribe', () => {
  it('returns an unsubscribe function', () => {
    const initialState = createTestState();
    const store = createStore(initialState);
    const listener = vi.fn();

    const unsubscribe = store.subscribe(listener);

    expect(typeof unsubscribe).toBe('function');
  });

  it('unsubscribe prevents further notifications', () => {
    const initialState = createTestState();
    const store = createStore(initialState);
    const listener = vi.fn();

    const unsubscribe = store.subscribe(listener);
    store.dispatch({ type: 'SCROLL', direction: 'down' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.dispatch({ type: 'DOUBLE_TAP' });
    expect(listener).toHaveBeenCalledTimes(1); // Still 1, not notified again
  });

  it('unsubscribe only affects the specific listener', () => {
    const initialState = createTestState();
    const store = createStore(initialState);
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const unsubscribe1 = store.subscribe(listener1);
    store.subscribe(listener2);

    unsubscribe1();
    store.dispatch({ type: 'SCROLL', direction: 'down' });

    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it('can unsubscribe multiple times safely', () => {
    const initialState = createTestState();
    const store = createStore(initialState);
    const listener = vi.fn();

    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    unsubscribe(); // Second call should be safe
    unsubscribe(); // Third call should be safe

    store.dispatch({ type: 'SCROLL', direction: 'down' });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('state immutability', () => {
  it('each dispatch creates a new state reference when changed', () => {
    const initialState = createTestState();
    const store = createStore(initialState);

    const stateBefore = store.getState();
    store.dispatch({ type: 'SCROLL', direction: 'down' });
    const stateAfter = store.getState();

    expect(stateBefore).not.toBe(stateAfter);
  });

  it('state reference unchanged when action has no effect', () => {
    const initialState = createTestState({ gameOver: 'checkmate' });
    const store = createStore(initialState);

    const stateBefore = store.getState();
    store.dispatch({ type: 'SCROLL', direction: 'down' });
    const stateAfter = store.getState();

    expect(stateBefore).toBe(stateAfter);
  });
});

describe('action sequence', () => {
  it('handles a sequence of actions correctly', () => {
    const initialState = createTestState({ phase: 'idle' });
    const store = createStore(initialState);

    // Enter piece selection
    store.dispatch({ type: 'SCROLL', direction: 'down' });
    expect(store.getState().phase).toBe('pieceSelect');
    expect(store.getState().selectedPieceId).toBe('w-n-g1');

    // Confirm piece selection
    store.dispatch({ type: 'TAP', selectedIndex: 0, selectedName: 'Ng1' });
    expect(store.getState().phase).toBe('destSelect');

    // Go back to pieceSelect
    store.dispatch({ type: 'DOUBLE_TAP' });
    expect(store.getState().phase).toBe('pieceSelect');

    // Note: Double-tap from pieceSelect may open menu if within gesture
    // disambiguation window (200ms). In a real scenario, enough time passes.
    // For this test, we just verify state transitions work correctly.
  });
});
