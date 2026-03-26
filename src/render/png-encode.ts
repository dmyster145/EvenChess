/**
 * Encode 1-bit monochrome pixels to 2-bit indexed PNG via UPNG.
 * cnum=4 (4 grey levels) is the minimum depth accepted by the G2 display.
 * cnum=2 (1-bit) renders solid green on device — do not use.
 * Encodes are serialized to avoid contention on device WebViews.
 */

import UPNG from 'upng-js';
import { PERF_LOG_ENABLED, perfLogLazyIfEnabled, perfNowMs } from '../perf/log';

const EMPTY_PNG_BYTES = new Uint8Array(0);

// ── Serialized encode queue ────────────────────────────────────────────────
// UPNG.encode is synchronous but wrapping in the queue prevents concurrent
// encode calls from stacking up and causing jitter on slow WebViews.

let pngEncodeQueueTail: Promise<void> = Promise.resolve();

function enqueueSerializedPngEncode<T>(task: () => T): Promise<T> {
  const run = pngEncodeQueueTail.then(task, task);
  pngEncodeQueueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ── RGBA pixel builders ────────────────────────────────────────────────────

/**
 * Convert unpacked 1-bit pixels (1 byte per pixel, 0 or 1) to RGBA.
 * 0 → black (0,0,0,255), 1 → white (255,255,255,255).
 */
function pixelsToRGBA(pixels: Uint8Array, count: number): Uint8Array {
  const rgba = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const v = pixels[i] ? 255 : 0;
    rgba[i * 4]     = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/**
 * Convert bit-packed pixels (8 pixels per byte, MSB first) to RGBA.
 * Used by the branding renderer.
 */
function packedPixelsToRGBA(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const packedRowBytes = Math.ceil(width / 8);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byteVal = pixels[y * packedRowBytes + (x >> 3)] ?? 0;
      const v = (byteVal & (0x80 >> (x & 7))) ? 255 : 0;
      const i = (y * width + x) * 4;
      rgba[i]     = v;
      rgba[i + 1] = v;
      rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

// ── Perf tracking ─────────────────────────────────────────────────────────

const PNG_ENCODE_PERF_SUMMARY_EVERY = 20;
const PNG_ENCODE_PERF_SLOW_TOTAL_MS = 35;

let pngEncodePerfCount = 0;
let pngEncodePerfTotalBytes = 0;
let pngEncodePerfTotalMs = 0;
let pngEncodePerfMaxTotalMs = 0;
let pngEncodePerfSlowCount = 0;

function recordPngEncodePerf(width: number, height: number, totalMs: number, bytes: number): void {
  pngEncodePerfCount += 1;
  pngEncodePerfTotalBytes += bytes;
  pngEncodePerfTotalMs += totalMs;
  pngEncodePerfMaxTotalMs = Math.max(pngEncodePerfMaxTotalMs, totalMs);

  if (totalMs >= PNG_ENCODE_PERF_SLOW_TOTAL_MS) {
    pngEncodePerfSlowCount += 1;
    perfLogLazyIfEnabled?.(
      () => `[Perf][PngEncode] size=${width}x${height} total=${totalMs.toFixed(1)}ms bytes=${bytes}`,
    );
  }

  if (pngEncodePerfCount % PNG_ENCODE_PERF_SUMMARY_EVERY !== 0) return;
  const avg = (v: number): number => v / Math.max(1, pngEncodePerfCount);
  perfLogLazyIfEnabled?.(
    () =>
      `[Perf][PngEncodeSummary] n=${pngEncodePerfCount} avgBytes=${Math.round(avg(pngEncodePerfTotalBytes))} ` +
      `avgTotal=${avg(pngEncodePerfTotalMs).toFixed(1)}ms maxTotal=${pngEncodePerfMaxTotalMs.toFixed(1)}ms slow=${pngEncodePerfSlowCount}`,
  );
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Encode unpacked 1-bit pixels (1 byte per pixel, 0 or 1) to a 2-bit indexed PNG.
 * Used by the board renderer. _slot is unused (kept for API compatibility).
 */
export async function encodePixelsToPng(
  pixels: Uint8Array,
  width: number,
  height: number,
  _slot = 0,
): Promise<Uint8Array> {
  const startMs = PERF_LOG_ENABLED ? perfNowMs() : 0;
  return enqueueSerializedPngEncode(() => {
    try {
      const rgba = pixelsToRGBA(pixels, width * height);
      const arrayBuffer = UPNG.encode([rgba.buffer as ArrayBuffer], width, height, 4);
      const png = new Uint8Array(arrayBuffer);
      if (PERF_LOG_ENABLED && png.length > 0) recordPngEncodePerf(width, height, perfNowMs() - startMs, png.length);
      return png;
    } catch {
      return EMPTY_PNG_BYTES;
    }
  });
}

/**
 * Encode bit-packed 1-bit pixels (8 pixels per byte, MSB first) to a 2-bit indexed PNG.
 * Used by the branding renderer.
 */
export async function encodePackedPixelsToPng(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  return enqueueSerializedPngEncode(() => {
    try {
      const rgba = packedPixelsToRGBA(pixels, width, height);
      const arrayBuffer = UPNG.encode([rgba.buffer as ArrayBuffer], width, height, 4);
      return new Uint8Array(arrayBuffer);
    } catch {
      return EMPTY_PNG_BYTES;
    }
  });
}
