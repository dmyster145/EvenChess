/**
 * Thin wrapper over vosk-browser.
 *
 * vosk-browser is fully self-contained: its worker is an inlined Blob and the Kaldi
 * WASM is embedded in the bundle, so there is NO CDN/network dependency. Only the
 * speech model archive is fetched — from a bundled, relative URL (offline).
 *
 * The model is loaded once; each listening session opens its own grammar-constrained
 * recognizer and removes it when the session ends, so audio and results from a cancelled
 * session can never leak into the next one. The chess grammar both boosts accuracy on the
 * small model and shrinks decoder memory (important on iOS WKWebView).
 */

import { Model } from 'vosk-browser';
import { VOICE_GRAMMAR } from './grammar';
import { VOICE_SAMPLE_RATE } from './pcm';

export interface RecognizerCallbacks {
  onPartial?(text: string): void;
  /**
   * A result segment. Vosk emits one at each of its own end-of-speech points (so a command
   * spoken with a pause arrives in pieces) and one after finalize(); text may be empty.
   */
  onResult(text: string): void;
  onError(error: string): void;
}

export interface Recognizer {
  /** Feed mono Float32 samples at 16 kHz. */
  accept(samples: Float32Array): void;
  /** Force end-of-utterance; the last segment arrives via onResult. */
  finalize(): void;
  dispose(): void;
}

/** The speech engine: one model, a fresh recognizer per listening session. */
export interface VoiceEngine {
  /** Load the model (once). Rejects if it can't be loaded. */
  load(): Promise<void>;
  /** Open a recognizer for one listening session. Only valid after load() resolved. */
  open(cb: RecognizerCallbacks): Recognizer;
  /** Terminate the model's worker and free its memory. */
  release(): void;
}

interface VoskMessage {
  event?: string;
  error?: unknown;
  result?: { text?: string; partial?: string } | boolean;
}

export function createVoskEngine(modelUrl: string): VoiceEngine {
  let model: Model | null = null;
  let loading: Promise<void> | null = null;

  return {
    load(): Promise<void> {
      if (!loading) {
        loading = new Promise<void>((resolve, reject) => {
          const m = new Model(modelUrl);
          m.on('load', (msg: VoskMessage) => {
            if (msg.result === true) {
              model = m;
              resolve();
            } else {
              m.terminate(); // a failed load would otherwise leave its worker running
              reject(new Error('Vosk model failed to load'));
            }
          });
          m.on('error', (msg: VoskMessage) => {
            m.terminate();
            reject(new Error(`Vosk model error: ${String(msg.error)}`));
          });
        });
      }
      return loading;
    },

    open(cb: RecognizerCallbacks): Recognizer {
      if (!model) throw new Error('Voice model not loaded');
      const rec = new model.KaldiRecognizer(VOICE_SAMPLE_RATE, JSON.stringify(VOICE_GRAMMAR));
      rec.setWords(true);
      rec.on('result', (m: VoskMessage) => {
        const r = m.result;
        cb.onResult(typeof r === 'object' && r ? (r.text ?? '').trim() : '');
      });
      rec.on('partialresult', (m: VoskMessage) => {
        const r = m.result;
        const partial = typeof r === 'object' && r ? (r.partial ?? '').trim() : '';
        if (partial && cb.onPartial) cb.onPartial(partial);
      });
      rec.on('error', (m: VoskMessage) => {
        cb.onError(typeof m.error === 'string' ? m.error : 'recognizer error');
      });

      let disposed = false;
      return {
        accept(samples: Float32Array): void {
          if (disposed || samples.length === 0) return;
          try {
            rec.acceptWaveformFloat(samples, VOICE_SAMPLE_RATE);
          } catch (err) {
            cb.onError(`acceptWaveform failed: ${String(err)}`);
          }
        },
        finalize(): void {
          if (disposed) return;
          try {
            rec.retrieveFinalResult();
          } catch {
            /* a final result may already be in flight */
          }
        },
        dispose(): void {
          if (disposed) return;
          disposed = true;
          try {
            rec.remove();
          } catch {
            /* worker may already be gone */
          }
        },
      };
    },

    release(): void {
      model?.terminate();
      model = null;
      loading = null;
    },
  };
}
