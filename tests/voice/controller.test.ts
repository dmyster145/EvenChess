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
  async load(): Promise<void> {}
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
});

describe('voice grammar', () => {
  it('spells castling sides as words the bundled model can decode', () => {
    expect(VOICE_GRAMMAR).toContain('side');
    expect(VOICE_GRAMMAR).not.toContain('kingside');
    expect(VOICE_GRAMMAR).not.toContain('queenside');
  });
});
