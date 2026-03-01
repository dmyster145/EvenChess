/**
 * Lightweight dispatch-source tagging for perf logs.
 *
 * Purpose:
 * - Distinguish "user input" latency from engine/timer/app follow-up updates
 * - Keep instrumentation cheap (single mutable snapshot, no event queue)
 */
import type { Action } from '../state/contracts';

export type PerfDispatchSource = 'input' | 'player' | 'engine' | 'timer' | 'app' | 'unknown';

interface DispatchTrace {
  seq: number;
  atMs: number;
  source: PerfDispatchSource;
  actionType: Action['type'] | '-';
}

let lastDispatchTrace: DispatchTrace = {
  seq: 0,
  atMs: 0,
  source: 'unknown',
  actionType: '-',
};

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function recordPerfDispatch(source: PerfDispatchSource, action: Pick<Action, 'type'>): void {
  lastDispatchTrace = {
    seq: lastDispatchTrace.seq + 1,
    atMs: nowMs(),
    source,
    actionType: action.type,
  };
}

export function getLastPerfDispatchTrace(): DispatchTrace {
  // Flush code reads the most recent dispatch to tag the resulting render/update work.
  return lastDispatchTrace;
}
