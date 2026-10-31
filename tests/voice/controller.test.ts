import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createVoiceController, type VoiceController } from '../../src/voice/controller';
import type { Recognizer, RecognizerCallbacks, VoiceEngine } from '../../src/voice/recognizer';
import { createStore, type Store } from '../../src/state/store';
import { VOICE_GRAMMAR } from '../../src/voice/grammar';
import { baseGameState } from '../helpers/game-state';

/** A fake engine whose recognizers the test drives directly. */
class FakeEngine implements VoiceEngine {
  sessions: Array<{ cb: RecognizerCallbacks; accepted: number; finalized: number; disposed: boolean }> = [];
  releases = 0;
  loads = 0;
  /** Make load() reject, as when the model archive can't be fetched. */
  failLoad = false;
  async load(): Promise<void> {
    this.loads += 1;
    if (this.failLoad) throw new Error('model download failed');
  }
  open(cb: RecognizerCallbacks): Recognizer {
    const s = { cb, accepted: 0, finalized: 0, disposed: false };
    this.sessions.push(s);
    return {
      accept: () => { s.accepted += 1; },
      finalize: () => { s.finalized += 1; },
      dispose: () => { s.disposed = true; },
    };
  }
  release(): void { this.releases += 1; }
  get last() { return this.sessions[this.sessions.length - 1]!; }
}

/** A mic whose start can be held open to test races. */
function makeBridge() {
  const calls: boolean[] = [];
  let releaseStart: ((ok: boolean) => void) | null = null;
  let holdNextStart = false;
  return {
    calls,
    holdNextStart() { holdNextStart = true; },
    finishStart(ok = true) { releaseStart?.(ok); releaseStart = null; },
    audioControl(on: boolean): Promise<boolean> {
      calls.push(on);
      if (on && holdNextStart) {
        holdNextStart = false;
        return new Promise((r) => { releaseStart = r; });
      }
      return Promise.resolve(true);
    },
  };
}

// 100ms of 16 kHz little-endian Int16 PCM, the format the SDK delivers.
const LOUD = new Uint8Array(new Int16Array(1600).fill(16000).buffer); // "speech"
const QUIET = new Uint8Array(3200);                                    // silence

let store: Store;
let engine: FakeEngine;
let bridge: ReturnType<typeof makeBridge>;
let voice: VoiceController;

async function startListening(): Promise<void> {
  expect(voice.start()).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(voice.isListening()).toBe(true);
}

beforeEach(async () => {
  vi.useFakeTimers();
  store = createStore(baseGameState()); // idle, White to move, player White
  engine = new FakeEngine();
  bridge = makeBridge();
  voice = createVoiceController({ store, bridge, modelUrl: 'unused', engine });
  voice.warm();
  await vi.advanceTimersByTimeAsync(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('voice controller', () => {
  it('a command spoken with a pause is resolved whole, not cut at the first pause', async () => {
    await startListening();
    voice.feed(LOUD);
    engine.last.cb.onResult('knight');      // Vosk's own endpoint mid-command
    expect(store.getState().voice?.pendingConfirm ?? null).toBeNull();
    voice.feed(LOUD);
    await vi.advanceTimersByTimeAsync(1100); // silence → the controller finalizes
    expect(engine.last.finalized).toBe(1);
    engine.last.cb.onResult('f three');      // the final segment
    await vi.advanceTimersByTimeAsync(200);
    expect(store.getState().voice?.pendingConfirm?.san).toBe('Nf3');
  });

  it('cancelling while the mic is still starting abandons the session', async () => {
    bridge.holdNextStart();
    expect(voice.start()).toBe(true);
    voice.cancel();
    bridge.finishStart(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(voice.isListening()).toBe(false);
    expect(store.getState().voice?.listening ?? false).toBe(false);
    expect(bridge.calls[bridge.calls.length - 1]).toBe(false); // mic left off
    expect(engine.sessions).toHaveLength(0);
  });

  it('results from a cancelled session never reach the next one', async () => {
    await startListening();
    const old = engine.last;
    voice.feed(LOUD);
    voice.cancel();
    expect(old.disposed).toBe(true);
    await startListening();
    old.cb.onResult('e four');               // stale result from the cancelled recognizer
    voice.feed(LOUD);
    await vi.advanceTimersByTimeAsync(1100);
    engine.last.cb.onResult('d four');
    await vi.advanceTimersByTimeAsync(200);
    expect(store.getState().voice?.pendingConfirm?.san).toBe('d4');
  });

  it('stops feeding audio once finalizing', async () => {
    await startListening();
    voice.feed(LOUD);
    await vi.advanceTimersByTimeAsync(1100); // finalize
    const before = engine.last.accepted;
    voice.feed(LOUD);
    voice.feed(QUIET);
    expect(engine.last.accepted).toBe(before);
  });

  it('every way a session ends clears the store\'s listening flag', async () => {
    await startListening();
    expect(store.getState().voice?.listening).toBe(true);
    voice.feed(LOUD);
    await vi.advanceTimersByTimeAsync(1100);
    engine.last.cb.onResult('');             // nothing recognized
    await vi.advanceTimersByTimeAsync(200);
    expect(store.getState().voice?.listening).toBe(false);
    expect(store.getState().voice?.status).toBe('Didn’t catch that');
  });

  it('dispose tears down the session and releases the model', async () => {
    await startListening();
    voice.dispose();
    expect(engine.last.disposed).toBe(true);
    expect(engine.releases).toBe(1);
    expect(store.getState().voice?.listening).toBe(false);
  });

  it('cancel while listening turns the mic off, disposes the recognizer and clears the status', async () => {
    await startListening();
    voice.cancel();
    expect(bridge.calls).toEqual([true, false]);
    expect(engine.last.disposed).toBe(true);
    expect(voice.isListening()).toBe(false);
    expect(store.getState().voice).toMatchObject({ listening: false, status: null });
  });

  it('finalizes once 900ms of silence follow speech, not earlier', async () => {
    await startListening();
    voice.feed(LOUD);
    await vi.advanceTimersByTimeAsync(900);  // the 900ms poll sees exactly 900ms of silence
    expect(engine.last.finalized).toBe(0);
    await vi.advanceTimersByTimeAsync(150);  // next poll: 1050ms of silence
    expect(engine.last.finalized).toBe(1);
  });

  it('with no speech at all, finalizes at the 7s cap and reports nothing heard 1.8s later', async () => {
    await startListening();
    await vi.advanceTimersByTimeAsync(6999);
    expect(engine.last.finalized).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.last.finalized).toBe(1);
    await vi.advanceTimersByTimeAsync(1799);  // no result arrives…
    expect(voice.isListening()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);     // …so the result timeout ends the session
    expect(voice.isListening()).toBe(false);
    expect(store.getState().voice?.status).toBe('Didn’t catch that');
    expect(bridge.calls).toEqual([true, false]);
  });

  it('if the final result never arrives, the segments already heard are still resolved', async () => {
    await startListening();
    voice.feed(LOUD);
    engine.last.cb.onResult('knight f three'); // a mid-utterance segment
    await vi.advanceTimersByTimeAsync(1050);  // silence → finalize
    expect(engine.last.finalized).toBe(1);
    await vi.advanceTimersByTimeAsync(1800);  // RESULT_TIMEOUT_MS with no final segment
    expect(store.getState().voice?.pendingConfirm?.san).toBe('Nf3');
  });

  it('cancels itself when the game stops accepting a move while listening', async () => {
    await startListening();
    store.dispatch({ type: 'ENGINE_THINKING' });
    await vi.advanceTimersByTimeAsync(150);   // next endpoint poll
    expect(voice.isListening()).toBe(false);
    expect(engine.last.disposed).toBe(true);
    expect(bridge.calls).toEqual([true, false]);
  });

  it('a mic that fails to start reports "Mic unavailable" and opens no recognizer', async () => {
    bridge.holdNextStart();
    expect(voice.start()).toBe(true);
    bridge.finishStart(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(voice.isListening()).toBe(false);
    expect(engine.sessions).toHaveLength(0);
    expect(bridge.calls).toEqual([true, false]);
    expect(store.getState().voice?.status).toBe('Mic unavailable');
  });

  it('confirm plays the parked move', () => {
    voice.injectTranscript('knight f three');
    expect(voice.hasPendingConfirm()).toBe(true);
    voice.confirm();
    expect(voice.hasPendingConfirm()).toBe(false);
    expect(store.getState().pendingMove?.uci).toBe('g1f3');
    expect(store.getState().history).toEqual(['Nf3']);
  });

  it('abort discards the parked move without playing it', () => {
    voice.injectTranscript('knight f three');
    expect(voice.hasPendingConfirm()).toBe(true);
    voice.abort();
    expect(voice.hasPendingConfirm()).toBe(false);
    expect(store.getState().pendingMove).toBeNull();
    expect(store.getState().history).toEqual([]);
  });
});

describe('voice controller before the model is ready', () => {
  it('a press before the model has loaded falls through to the carousel and starts the load', async () => {
    vi.useFakeTimers();
    const fresh = new FakeEngine();
    const mic = makeBridge();
    const v = createVoiceController({ store: createStore(baseGameState()), bridge: mic, modelUrl: 'unused', engine: fresh });
    expect(v.start()).toBe(false);
    expect(fresh.loads).toBe(1);
    expect(mic.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(v.start()).toBe(true);             // loaded now
  });

  it('a failed model load disables voice for the session without retrying the download', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const broken = new FakeEngine();
      broken.failLoad = true;
      const mic = makeBridge();
      const v = createVoiceController({ store: createStore(baseGameState()), bridge: mic, modelUrl: 'unused', engine: broken });
      v.warm();
      await vi.advanceTimersByTimeAsync(0);
      expect(v.start()).toBe(false);
      v.warm();
      expect(v.start()).toBe(false);
      expect(broken.loads).toBe(1);
      expect(mic.calls).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });
});

describe('voice grammar', () => {
  it('spells castling sides as words the bundled model can decode', () => {
    expect(VOICE_GRAMMAR).toContain('side');
    expect(VOICE_GRAMMAR).not.toContain('kingside');
    expect(VOICE_GRAMMAR).not.toContain('queenside');
  });
});
