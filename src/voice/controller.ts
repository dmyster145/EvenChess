/**
 * Push-to-talk voice controller.
 *
 * Lifecycle: tap-in-idle → start() → mic on → stream PCM to the recognizer →
 * end-of-speech (silence) or timeout → finalize → parse → resolve → dispatch a move
 * or a status → mic off.
 *
 * Voice is purely additive: if the model fails to load or the mic is unavailable,
 * start() returns false so the caller falls back to the manual scroll carousel.
 * The mic is force-closed on every exit path (lifecycle teardown / dispose).
 */

import type { Store } from '../state/store';
import type { EvenHubBridge } from '../evenhub/bridge';
import { createRecognizer, type Recognizer } from './recognizer';
import { parseVoiceCommand } from './parse';
import { resolveVoiceMove } from './resolve';
import { payloadToFloat32, meanAbsAmplitude, type AudioPayload } from './pcm';

export interface VoiceControllerDeps {
  store: Store;
  bridge: EvenHubBridge;
  /** Relative URL of the bundled Vosk model archive (offline). */
  modelUrl: string;
}

const SPEECH_AMPLITUDE = 0.012;
const SILENCE_MS = 900;
const MIN_LISTEN_MS = 400;
const MAX_LISTEN_MS = 7000;
const RESULT_TIMEOUT_MS = 1800;
const ENDPOINT_POLL_MS = 150;
const ERROR_STATUS_MS = 3500;

export interface VoiceController {
  /** Begin a fresh preload of the model (call once at app init to warm the cache). */
  warm(): void;
  /** Attempt to start listening. Returns false if voice isn't usable right now. */
  start(): boolean;
  /** Feed a raw SDK audio payload (no-op unless listening). */
  feed(payload: AudioPayload): void;
  /** Abort listening (user tapped/scrolled away). */
  cancel(): void;
  isListening(): boolean;
  /** Debug/verification: run parse→resolve→dispatch on a transcript, no audio. */
  injectTranscript(text: string): void;
  /** Mic-off + recognizer teardown. Idempotent. Call on every exit path. */
  dispose(): void;
}

export function createVoiceController(deps: VoiceControllerDeps): VoiceController {
  const { store, bridge, modelUrl } = deps;

  let recognizer: Recognizer | null = null;
  let modelFailed = false;
  let warming = false;
  let starting = false;
  let listening = false;
  let finalizing = false;

  let heardSpeech = false;
  let lastVoiceAt = 0;
  let startedAt = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let resultTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimers(): void {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (resultTimer) { clearTimeout(resultTimer); resultTimer = null; }
    if (maxTimer) { clearTimeout(maxTimer); maxTimer = null; }
  }

  function eligible(): boolean {
    const s = store.getState();
    return (
      s.phase === 'idle' &&
      !s.gameOver &&
      !s.engineThinking &&
      !s.pendingMove &&
      s.turn === s.playerColor
    );
  }

  function stopMic(): void {
    void bridge.audioControl(false);
  }

  function endSession(): void {
    listening = false;
    finalizing = false;
    heardSpeech = false;
    clearTimers();
    stopMic();
  }

  function resolveAndDispatch(text: string): void {
    const intent = parseVoiceCommand(text);
    const res = resolveVoiceMove(intent, store.getState());
    if (res.kind === 'move') {
      store.dispatch({ type: 'VOICE_MOVE_RESOLVED', move: res.move });
    } else {
      store.dispatch({ type: 'VOICE_STATUS', message: res.message, durationMs: ERROR_STATUS_MS });
    }
  }

  function handleTranscript(text: string): void {
    if (!listening && !finalizing) return;
    endSession();
    resolveAndDispatch(text);
  }

  function finalizeUtterance(): void {
    if (finalizing || !listening) return;
    finalizing = true;
    clearTimers();
    recognizer?.finalize();
    resultTimer = setTimeout(() => {
      if (!finalizing) return;
      endSession();
      store.dispatch({ type: 'VOICE_STATUS', message: 'Didn’t catch that', durationMs: ERROR_STATUS_MS });
    }, RESULT_TIMEOUT_MS);
  }

  function onEndpointPoll(): void {
    if (!listening) return;
    const now = Date.now();
    if (now - startedAt > MIN_LISTEN_MS && heardSpeech && now - lastVoiceAt > SILENCE_MS) {
      finalizeUtterance();
    }
  }

  async function ensureRecognizer(): Promise<Recognizer | null> {
    if (recognizer) return recognizer;
    try {
      recognizer = await createRecognizer(modelUrl, {
        onFinal: handleTranscript,
        onPartial: (t) => {
          if (listening && t) {
            store.dispatch({ type: 'VOICE_STATUS', message: `Hearing: ${t}`, keepListening: true });
          }
        },
        onError: (e) => {
          console.error('[voice] recognizer error:', e);
        },
      });
      return recognizer;
    } catch (err) {
      console.error('[voice] model load failed:', err);
      modelFailed = true;
      return null;
    }
  }

  function warm(): void {
    if (modelFailed || recognizer || warming) return;
    warming = true;
    void ensureRecognizer().finally(() => {
      warming = false;
    });
  }

  function start(): boolean {
    if (modelFailed || starting || listening || !eligible()) return false;
    // Recognizer must be ready for the press to feel instant. If it isn't, kick a
    // preload and let this tap fall through to the manual carousel.
    if (!recognizer) {
      warm();
      return false;
    }
    starting = true;
    void (async () => {
      try {
        const ok = await bridge.audioControl(true);
        if (!ok || !eligible()) {
          stopMic();
          starting = false;
          store.dispatch({ type: 'VOICE_STATUS', message: 'Mic unavailable', durationMs: ERROR_STATUS_MS });
          return;
        }
        listening = true;
        finalizing = false;
        heardSpeech = false;
        startedAt = Date.now();
        lastVoiceAt = startedAt;
        store.dispatch({ type: 'VOICE_LISTEN_START' });
        pollTimer = setInterval(onEndpointPoll, ENDPOINT_POLL_MS);
        maxTimer = setTimeout(finalizeUtterance, MAX_LISTEN_MS);
      } finally {
        starting = false;
      }
    })();
    return true;
  }

  function feed(payload: AudioPayload): void {
    if (!listening || !recognizer) return;
    const samples = payloadToFloat32(payload);
    if (samples.length === 0) return;
    if (meanAbsAmplitude(samples) >= SPEECH_AMPLITUDE) {
      heardSpeech = true;
      lastVoiceAt = Date.now();
    }
    recognizer.accept(samples);
  }

  function cancel(): void {
    if (!listening && !starting) return;
    endSession();
    store.dispatch({ type: 'VOICE_STATUS', message: '' });
  }

  function dispose(): void {
    endSession();
    recognizer?.dispose();
    recognizer = null;
  }

  return {
    warm,
    start,
    feed,
    cancel,
    isListening: () => listening,
    injectTranscript: resolveAndDispatch,
    dispose,
  };
}
