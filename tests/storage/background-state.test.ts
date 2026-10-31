import { describe, it, expect, beforeEach } from 'vitest';
import {
  setBackgroundState,
  onBackgroundRestore,
  _resetBackgroundStateRegistry,
  _backgroundStateGlobalsInstalled,
} from '../../src/storage/background-state';

interface BackgroundStateGlobal {
  __getStateSnapshot?: () => string;
  __restoreState?: (snapshot: string) => void;
}

// `globalThis` mirrors `window` in any WebView the host runs us in, and is available in the test
// node environment as well — the module installs its callbacks on globalThis for both reasons.
function g(): BackgroundStateGlobal {
  return globalThis as unknown as BackgroundStateGlobal;
}

describe('background-state shim', () => {
  beforeEach(() => {
    _resetBackgroundStateRegistry();
  });

  it('installs window.__getStateSnapshot and window.__restoreState at module load', () => {
    expect(_backgroundStateGlobalsInstalled()).toBe(true);
    expect(typeof g().__getStateSnapshot).toBe('function');
    expect(typeof g().__restoreState).toBe('function');
  });

  it('__getStateSnapshot returns "{}" when no exporters are registered', () => {
    expect(g().__getStateSnapshot!()).toBe('{}');
  });

  it('__getStateSnapshot serializes registered exporters by key', () => {
    setBackgroundState('counter', () => ({ value: 42 }));
    setBackgroundState('label', () => 'hello');
    const snap = JSON.parse(g().__getStateSnapshot!()) as Record<string, unknown>;
    expect(snap.counter).toEqual({ value: 42 });
    expect(snap.label).toBe('hello');
  });

  it('snapshot reflects state at the moment of export (not at registration)', () => {
    const live = { count: 0 };
    setBackgroundState('live', () => ({ count: live.count }));
    live.count = 7;
    const snap = JSON.parse(g().__getStateSnapshot!()) as { live: { count: number } };
    expect(snap.live.count).toBe(7);
  });

  it('__restoreState replays each key into its registered restorer', () => {
    let restored: unknown = null;
    onBackgroundRestore('myKey', (v) => {
      restored = v;
    });
    g().__restoreState!(JSON.stringify({ myKey: { ok: true } }));
    expect(restored).toEqual({ ok: true });
  });

  it('buffers snapshots that arrive before a restorer registers', () => {
    // Race: host calls __restoreState before initApp wires onBackgroundRestore.
    g().__restoreState!(JSON.stringify({ early: { id: 'pending' } }));
    let received: unknown = null;
    onBackgroundRestore('early', (v) => {
      received = v;
    });
    // Registering the restorer drains the buffered value immediately.
    expect(received).toEqual({ id: 'pending' });
  });

  it('drains the buffer only for the registering key, not others', () => {
    g().__restoreState!(JSON.stringify({ a: 1, b: 2 }));
    let receivedA: unknown = null;
    let receivedB: unknown = null;
    onBackgroundRestore('a', (v) => {
      receivedA = v;
    });
    expect(receivedA).toBe(1);
    expect(receivedB).toBeNull();
    onBackgroundRestore('b', (v) => {
      receivedB = v;
    });
    expect(receivedB).toBe(2);
  });

  it('ignores malformed or non-object snapshots without throwing or calling restorers', () => {
    const received: unknown[] = [];
    onBackgroundRestore('k', (v) => received.push(v));
    // A bare JSON string has index keys ("0", "1", ...); they must not be read as snapshot keys.
    onBackgroundRestore('0', (v) => received.push(v));
    expect(() => g().__restoreState!('not json')).not.toThrow();
    expect(() => g().__restoreState!('null')).not.toThrow();
    expect(() => g().__restoreState!('[]')).not.toThrow();
    expect(() => g().__restoreState!('"k"')).not.toThrow();
    expect(received).toEqual([]);
  });

  it('does not call restorers for keys absent from the snapshot', () => {
    let called = false;
    onBackgroundRestore('present', () => {
      called = true;
    });
    g().__restoreState!(JSON.stringify({ other: 1 }));
    expect(called).toBe(false);
  });

  it('passes a null snapshot value through to the restorer', () => {
    // JSON has no `undefined`, so null is the only "empty" value a snapshot can carry; it is a
    // real value and reaches the restorer, which decides what null means for its key.
    const received: unknown[] = [];
    onBackgroundRestore('present', (v) => received.push(v));
    g().__restoreState!(JSON.stringify({ present: null }));
    expect(received).toEqual([null]);
  });

  it('isolates exporter errors so other exporters still run', () => {
    setBackgroundState('bad', () => {
      throw new Error('boom');
    });
    setBackgroundState('good', () => ({ ok: true }));
    const snap = JSON.parse(g().__getStateSnapshot!()) as Record<string, unknown>;
    expect(snap.good).toEqual({ ok: true });
    expect(snap.bad).toBeUndefined();
  });

  it('isolates restorer errors so a later restorer still runs', () => {
    let goodCalled = false;
    onBackgroundRestore('bad', () => {
      throw new Error('boom');
    });
    onBackgroundRestore('good', () => {
      goodCalled = true;
    });
    g().__restoreState!(JSON.stringify({ bad: 'x', good: 'y' }));
    expect(goodCalled).toBe(true);
  });

  it('replacing a key overwrites the old exporter/restorer', () => {
    setBackgroundState('k', () => 'first');
    setBackgroundState('k', () => 'second');
    const snap = JSON.parse(g().__getStateSnapshot!()) as Record<string, unknown>;
    expect(snap.k).toBe('second');
  });
});
