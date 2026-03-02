/**
 * Encode 1-bit monochrome pixels to PNG via canvas.
 * Used for smaller BLE payloads (PNG compresses better than raw BMP for sparse art).
 * Falls back to empty buffer in non-browser (tests).
 * Reuses four canvases (slots 0–3) so refill can encode next+prev in parallel.
 */

import { PERF_LOG_ENABLED, perfLogLazyIfEnabled, perfNowMs } from '../perf/log';

const REUSED_CANVAS_COUNT = 4;
const reusedCanvases: (HTMLCanvasElement | null)[] = new Array(REUSED_CANVAS_COUNT).fill(null);
const reusedImageData: (ImageData | null)[] = new Array(REUSED_CANVAS_COUNT).fill(null);
const reusedImageDataDims: { w: number; h: number }[] = new Array(REUSED_CANVAS_COUNT).fill(null).map(() => ({ w: 0, h: 0 }));
const EMPTY_PNG_BYTES = new Uint8Array(0);

const PNG_ENCODE_PERF_SUMMARY_EVERY = 20;
const PNG_ENCODE_PERF_SLOW_TOTAL_MS = 35;

type PngEncodePerfSample = {
  slot: number;
  width: number;
  height: number;
  toBlobMs: number;
  readMs: number;
  totalMs: number;
  bytes: number;
};

let pngEncodePerfCount = 0;
let pngEncodePerfTotalBytes = 0;
let pngEncodePerfTotalToBlobMs = 0;
let pngEncodePerfTotalReadMs = 0;
let pngEncodePerfTotalMs = 0;
let pngEncodePerfMaxToBlobMs = 0;
let pngEncodePerfMaxReadMs = 0;
let pngEncodePerfMaxTotalMs = 0;
let pngEncodePerfSlowCount = 0;

function recordPngEncodePerf(sample: PngEncodePerfSample): void {
  pngEncodePerfCount += 1;
  pngEncodePerfTotalBytes += sample.bytes;
  pngEncodePerfTotalToBlobMs += sample.toBlobMs;
  pngEncodePerfTotalReadMs += sample.readMs;
  pngEncodePerfTotalMs += sample.totalMs;
  pngEncodePerfMaxToBlobMs = Math.max(pngEncodePerfMaxToBlobMs, sample.toBlobMs);
  pngEncodePerfMaxReadMs = Math.max(pngEncodePerfMaxReadMs, sample.readMs);
  pngEncodePerfMaxTotalMs = Math.max(pngEncodePerfMaxTotalMs, sample.totalMs);

  if (sample.totalMs >= PNG_ENCODE_PERF_SLOW_TOTAL_MS) {
    pngEncodePerfSlowCount += 1;
    perfLogLazyIfEnabled?.(
      () =>
        `[Perf][PngEncode] slot=${sample.slot} size=${sample.width}x${sample.height} ` +
        `toBlob=${sample.toBlobMs.toFixed(1)}ms read=${sample.readMs.toFixed(1)}ms ` +
        `total=${sample.totalMs.toFixed(1)}ms bytes=${sample.bytes}`,
    );
  }

  if (pngEncodePerfCount % PNG_ENCODE_PERF_SUMMARY_EVERY !== 0) return;

  const avg = (value: number): number => value / Math.max(1, pngEncodePerfCount);
  perfLogLazyIfEnabled?.(
    () =>
      `[Perf][PngEncodeSummary] n=${pngEncodePerfCount} avgBytes=${Math.round(avg(pngEncodePerfTotalBytes))} ` +
      `avgBlob=${avg(pngEncodePerfTotalToBlobMs).toFixed(1)}ms avgRead=${avg(pngEncodePerfTotalReadMs).toFixed(1)}ms ` +
      `avgTotal=${avg(pngEncodePerfTotalMs).toFixed(1)}ms maxBlob=${pngEncodePerfMaxToBlobMs.toFixed(1)}ms ` +
      `maxRead=${pngEncodePerfMaxReadMs.toFixed(1)}ms maxTotal=${pngEncodePerfMaxTotalMs.toFixed(1)}ms slow=${pngEncodePerfSlowCount}`,
  );
}

function getCanvasSlot(slot: number, width: number, height: number): { canvas: HTMLCanvasElement; imageData: ImageData; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const s = slot % REUSED_CANVAS_COUNT;
  let canvas = reusedCanvases[s];
  if (!canvas) {
    canvas = document.createElement('canvas');
    reusedCanvases[s] = canvas;
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const dims = reusedImageDataDims[s];
  let imageData = reusedImageData[s];
  if (!imageData || !dims || dims.w !== width || dims.h !== height) {
    imageData = ctx.createImageData(width, height);
    reusedImageData[s] = imageData;
    reusedImageDataDims[s] = { w: width, h: height };
  }
  return { canvas, imageData, ctx };
}

function canvasToBlobPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      'image/png',
    );
  });
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return await blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsArrayBuffer(blob);
  });
}

async function canvasToPngBytes(canvas: HTMLCanvasElement, slot: number): Promise<Uint8Array> {
  const perfEnabled = PERF_LOG_ENABLED;
  const totalStartMs = perfEnabled ? perfNowMs() : 0;
  const blobStartMs = perfEnabled ? perfNowMs() : 0;
  const blob = await canvasToBlobPng(canvas);
  const toBlobMs = perfEnabled ? perfNowMs() - blobStartMs : 0;
  if (!blob) {
    if (perfEnabled) {
      recordPngEncodePerf({
        slot,
        width: canvas.width,
        height: canvas.height,
        toBlobMs,
        readMs: 0,
        totalMs: perfNowMs() - totalStartMs,
        bytes: 0,
      });
    }
    return EMPTY_PNG_BYTES;
  }

  const readStartMs = perfEnabled ? perfNowMs() : 0;
  const bytes = new Uint8Array(await blobToArrayBuffer(blob));
  if (perfEnabled) {
    recordPngEncodePerf({
      slot,
      width: canvas.width,
      height: canvas.height,
      toBlobMs,
      readMs: perfNowMs() - readStartMs,
      totalMs: perfNowMs() - totalStartMs,
      bytes: bytes.length,
    });
  }
  return bytes;
}

/** 1-bit pixels (0 or 1), row-major, width*height. Returns PNG file bytes. slot 0–3 for parallel use. */
export function encodePixelsToPng(
  pixels: Uint8Array,
  width: number,
  height: number,
  slot: number = 0,
): Promise<Uint8Array> {
  const slotCtx = getCanvasSlot(slot, width, height);
  if (!slotCtx) return Promise.resolve(EMPTY_PNG_BYTES);
  const { canvas, imageData, ctx } = slotCtx;
  for (let i = 0; i < width * height; i++) {
    const v = pixels[i] ? 255 : 0;
    imageData.data[i * 4] = v;
    imageData.data[i * 4 + 1] = v;
    imageData.data[i * 4 + 2] = v;
    imageData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  // Intentionally not serialized: BoardRenderer already encodes top+bottom in parallel and transport dominates once encoded.
  return canvasToPngBytes(canvas, slot);
}
