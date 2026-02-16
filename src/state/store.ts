/**
 * Store — minimal reactive state container.
 *
 * Provides getState(), dispatch(action), and subscribe(listener).
 * Listeners receive both the new state and the previous state
 * so they can diff and decide whether to act.
 */

import type { GameState, Action, StoreListener } from './contracts';
import { reduce } from './reducer';

export interface Store {
  getState(): GameState;
  dispatch(action: Action): void;
  subscribe(listener: StoreListener): () => void;
}

export function createStore(initialState: GameState): Store {
  let state = initialState;
  const listeners = new Set<StoreListener>();

  function getState(): GameState {
    return state;
  }

  function dispatch(action: Action): void {
    const prev = state;
    state = reduce(state, action);

    // Only notify if state actually changed (reference equality)
    if (state !== prev) {
      for (const listener of listeners) {
        try {
          listener(state, prev);
        } catch (err) {
          console.error('[Store] Listener error:', err);
        }
      }
    }
  }

  function subscribe(listener: StoreListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return { getState, dispatch, subscribe };
}
