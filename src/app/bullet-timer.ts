/**
 * bullet-timer.ts — owns the TIMER_TICK interval for bullet mode.
 *
 * The reducer uses Date.now() deltas, so timer accuracy is independent of the tick frequency. The
 * interval drives display flushes (so the user sees the clock move) and is paused on
 * background/foreground per ER lifecycle guidance.
 */

import type { Store } from '../state/store';

const TICK_INTERVAL_MS = 500;

export interface BulletTimerDeps {
  store: Store;
  /** Called every tick to dispatch the TIMER_TICK action. Pulled in as a dependency so the timer
   *  module doesn't import the action types directly. */
  onTick: () => void;
}

export interface BulletTimerController {
  /** Start ticking if state allows it. Idempotent. */
  start(): void;
  /** Stop ticking. Idempotent. */
  stop(): void;
  /** Suspend ticking until resume() is called. Used on background. */
  suspend(): void;
  /** Resume ticking if state still wants it. */
  resume(): void;
  /** True iff the timer is currently ticking. */
  isRunning(): boolean;
  /** Wire to a store subscription change — starts or stops based on (mode, timerActive). */
  onStateChange(): void;
}

export function createBulletTimer(deps: BulletTimerDeps): BulletTimerController {
  let interval: ReturnType<typeof setInterval> | null = null;
  let suspended = false;

  function start(): void {
    if (interval || suspended) return;
    interval = setInterval(deps.onTick, TICK_INTERVAL_MS);
  }

  function stop(): void {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  function suspend(): void {
    suspended = true;
    stop();
  }

  function resume(): void {
    suspended = false;
    onStateChange();
  }

  function isRunning(): boolean {
    return interval !== null;
  }

  function onStateChange(): void {
    const state = deps.store.getState();
    const wantsRunning = state.mode === 'bullet' && state.timerActive;
    if (wantsRunning) start();
    else stop();
  }

  return { start, stop, suspend, resume, isRunning, onStateChange };
}
