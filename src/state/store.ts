/**
 * Store — minimal reactive state container.
 *
 * Provides getState(), dispatch(action), and subscribe(listener).
 * Listeners receive both the new state and the previous state
 * so they can diff and decide whether to act.
 *
 * Listeners may dispatch. The state updates at once (getState() sees it right away), but the
 * notification for a nested dispatch waits until every listener has seen the current change, so
 * each listener receives the changes in order and each (state, prev) pair is one real transition.
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
  const pending: Array<{ next: GameState; prev: GameState }> = [];
  let notifying = false;

  function getState(): GameState {
    return state;
  }

  function dispatch(action: Action): void {
    const prev = state;
    state = reduce(state, action);

    // Only notify if state actually changed (reference equality)
    if (state === prev) return;
    pending.push({ next: state, prev });
    if (notifying) return; // the outer dispatch's loop below delivers it

    notifying = true;
    try {
      for (let change = pending.shift(); change; change = pending.shift()) {
        for (const listener of listeners) {
          try {
            listener(change.next, change.prev);
          } catch (err) {
            console.error('[Store] Listener error:', err);
          }
        }
      }
    } finally {
      notifying = false;
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
