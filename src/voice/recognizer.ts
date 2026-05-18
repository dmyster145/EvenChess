/**
 * Thin wrapper over vosk-browser.
 *
 * vosk-browser is fully self-contained: its worker is an inlined Blob and the Kaldi
 * WASM is embedded in the bundle, so there is NO CDN/network dependency. Only the
 * speech model archive is fetched — from a bundled, relative URL (offline).
 *
 * The recognizer is grammar-constrained to the chess vocabulary, which both boosts
 * accuracy on the small model and shrinks decoder memory (important on iOS WKWebView).
 */

import { createModel, type Model } from 'vosk-browser';
import { VOICE_GRAMMAR } from './grammar';
import { VOICE_SAMPLE_RATE } from './pcm';

export interface RecognizerCallbacks {
  onPartial?(text: string): void;
  onFinal(text: string): void;
  onError(error: string): void;
}

export interface Recognizer {
  /** Feed mono Float32 samples at 16 kHz. */
  accept(samples: Float32Array): void;
  /** Force end-of-utterance; the final transcript arrives via onFinal. */
  finalize(): void;
  dispose(): void;
}

interface VoskMessage {
  event?: string;
  error?: unknown;
  result?: { text?: string; partial?: string };
}

let modelPromise: Promise<Model> | null = null;

/** Load (once) and cache the model. Safe to call eagerly to warm the cache. */
export function preloadVoiceModel(modelUrl: string): Promise<Model> {
  if (!modelPromise) {
    modelPromise = createModel(modelUrl).catch((err) => {
      modelPromise = null; // allow a later retry
      throw err;
    });
  }
  return modelPromise;
}

export async function createRecognizer(
  modelUrl: string,
  cb: RecognizerCallbacks,
): Promise<Recognizer> {
  const model = await preloadVoiceModel(modelUrl);
  const grammar = JSON.stringify(VOICE_GRAMMAR);
  const rec = new model.KaldiRecognizer(VOICE_SAMPLE_RATE, grammar);
  rec.setWords(true);

  rec.on('result', (m: VoskMessage) => {
    const text = m?.result?.text?.trim();
    if (text) cb.onFinal(text);
  });
  rec.on('partialresult', (m: VoskMessage) => {
    const partial = m?.result?.partial?.trim();
    if (partial && cb.onPartial) cb.onPartial(partial);
  });
  rec.on('error', (m: VoskMessage) => {
    cb.onError(typeof m?.error === 'string' ? m.error : 'recognizer error');
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
}
