import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from '../../src/state/store';
import { buildInitialState } from '../../src/state/contracts';
import { ChessService } from '../../src/chess/chessservice';
import { createBulletTimer } from '../../src/app/bullet-timer';

describe('createBulletTimer', () => {
  let chess: ChessService;
  let store: ReturnType<typeof createStore>;
  let ticks: number;

  beforeEach(() => {
    vi.useFakeTimers();
    chess = new ChessService();
    store = createStore({ ...buildInitialState(chess), mode: 'bullet', timerActive: true });
    ticks = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeTimer(): ReturnType<typeof createBulletTimer> {
    return createBulletTimer({ store, onTick: () => { ticks += 1; } });
  }

  it('start() ticks at the configured interval; stop() halts ticks', () => {
    const timer = makeTimer();
    timer.start();
    vi.advanceTimersByTime(1500);
    expect(ticks).toBe(3);
    timer.stop();
    vi.advanceTimersByTime(2000);
    expect(ticks).toBe(3);
  });

  it('suspend() stops ticking; resume() restarts based on store state', () => {
    const timer = makeTimer();
    timer.start();
    vi.advanceTimersByTime(500);
    expect(ticks).toBe(1);
    timer.suspend();
    vi.advanceTimersByTime(2000);
    expect(ticks).toBe(1);
    timer.resume();
    vi.advanceTimersByTime(500);
    expect(ticks).toBe(2);
  });

  it('onStateChange() starts when state wants the timer; stops when it does not', () => {
    const timer = makeTimer();
    expect(timer.isRunning()).toBe(false);
    timer.onStateChange();
    expect(timer.isRunning()).toBe(true);

    // Replace state with one where timerActive=false and re-evaluate.
    store.dispatch({ type: 'RESTORE_STATE', state: { ...store.getState(), timerActive: false } });
    timer.onStateChange();
    expect(timer.isRunning()).toBe(false);
  });

  it('start() is a no-op while suspended', () => {
    const timer = makeTimer();
    timer.suspend();
    timer.start();
    vi.advanceTimersByTime(2000);
    expect(ticks).toBe(0);
  });
});
