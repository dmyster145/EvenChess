/**
 * autosave.ts — defers per-move localStorage saves so they don't compete with image sends.
 *
 * The bridge's storage path serializes localStorage writes (durable layer) and best-effort SDK
 * mirror; we still debounce by 180ms here so a rapid sequence of moves coalesces to one save
 * write at the end. The latest snapshot wins — earlier queued snapshots are discarded.
 */

import type { Store } from '../state/store';
import type { GameState, Action } from '../state/contracts';
import { saveGame } from '../storage/persistence';

const IDLE_DELAY_MS = 180;

type Snapshot = Pick<GameState, 'fen' | 'history' | 'turn' | 'difficulty'>;

export interface AutosaveDeps {
  store: Store;
  /** Used to dispatch MARK_SAVED after a successful save. Optional dependency so tests can pass a no-op. */
  dispatch: (action: Action) => void;
}

export interface AutosaveController {
  /** Schedule an autosave for the given state. Latest snapshot wins. */
  queue(state: GameState): void;
  /** Cancel any pending autosave without writing. */
  clear(): void;
  /** Force the pending snapshot to be written immediately (even if just queued). */
  flushNow(): void;
}

export function createAutosave(deps: AutosaveDeps): AutosaveController {
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSnapshot: Snapshot | null = null;

  function schedule(): void {
    if (pendingTimer) return;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      doFlush();
    }, IDLE_DELAY_MS);
  }

  function queue(state: GameState): void {
    if (state.history.length === 0) return;
    pendingSnapshot = {
      fen: state.fen,
      history: [...state.history],
      turn: state.turn,
      difficulty: state.difficulty,
    };
    schedule();
  }

  function clear(): void {
    pendingSnapshot = null;
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  function flushNow(): void {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    doFlush();
  }

  function doFlush(): void {
    const snapshot = pendingSnapshot;
    if (!snapshot) return;
    pendingSnapshot = null;
    void saveGame(snapshot.fen, snapshot.history, snapshot.turn, snapshot.difficulty);

    const current = deps.store.getState();
    const sameAsSaved =
      current.fen === snapshot.fen &&
      current.turn === snapshot.turn &&
      current.difficulty === snapshot.difficulty &&
      current.history.length === snapshot.history.length &&
      current.history.every((move, idx) => move === snapshot.history[idx]);

    if (sameAsSaved && current.hasUnsavedChanges) {
      deps.dispatch({ type: 'MARK_SAVED' });
      return;
    }

    if (current.hasUnsavedChanges && current.history.length > 0) {
      queue(current);
    }
  }

  return { queue, clear, flushNow };
}
