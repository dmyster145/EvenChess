/**
 * Encode 1-bit monochrome pixels to PNG.
 * Produces 1-bit grayscale PNG (color type 0, bit depth 1) for minimal BLE payload.
 * Falls back to empty buffer if CompressionStream is unavailable.
 */

import { PERF_LOG_ENABLED, perfLogLazyIfEnabled, perfNowMs } from '../perf/log';

const EMPTY_PNG_BYTES = new Uint8Array(0);

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

// ── CRC-32 ────────────────────────────────────────────────────────────────

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(data: Uint8Array, offset: number, length: number): number {
  let crc = 0xFFFFFFFF;
  const end = offset + length;
  for (let i = offset; i < end; i++) {
    crc = (crcTable[(crc ^ (data[i] ?? 0)) & 0xFF] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Chunk helpers ─────────────────────────────────────────────────────────

function writeU32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset]     = (value >>> 24) & 0xFF;
  buf[offset + 1] = (value >>> 16) & 0xFF;
  buf[offset + 2] = (value >>>  8) & 0xFF;
  buf[offset + 3] =  value         & 0xFF;
}

const TYPE_IHDR = new Uint8Array([73, 72, 68, 82]); // "IHDR"
const TYPE_IDAT = new Uint8Array([73, 68, 65, 84]); // "IDAT"
const TYPE_IEND = new Uint8Array([73, 69, 78, 68]); // "IEND"

function buildChunk(type: Uint8Array, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  writeU32BE(chunk, 0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  writeU32BE(chunk, 8 + data.length, crc32(chunk, 4, 4 + data.length));
  return chunk;
}

// ── PNG chunks ────────────────────────────────────────────────────────────

function ihdrChunk(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  writeU32BE(data, 0, width);
  writeU32BE(data, 4, height);
  data[8] = 8; // bit depth: 8 (device gray4 conversion requires 8-bit+)
  data[9] = 0; // color type: 0 = grayscale
  // compression (10), filter method (11), interlace (12) all 0 by default
  return buildChunk(TYPE_IHDR, data);
}

// IEND is invariant; pre-compute once.
const IEND_CHUNK = buildChunk(TYPE_IEND, new Uint8Array(0));

// ── Zlib compression ──────────────────────────────────────────────────────

async function zlibCompress(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new CompressionStream('deflate');
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    writer.write(data as unknown as Uint8Array<ArrayBuffer>);
    writer.close();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (value) chunks.push(value);
      if (done) break;
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const result = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) { result.set(c, pos); pos += c.length; }
    return result;
  } catch {
    return null;
  }
}

// ── Scanline builders ─────────────────────────────────────────────────────

/**
 * Build 8-bit grayscale PNG scanlines from unpacked pixels (1 byte per pixel, 0 or 1).
 * Used by the board renderer (workPixels layout).
 */
function buildScanlines(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array(height * (1 + width)); // filter byte + 1 byte per pixel per row
  for (let y = 0; y < height; y++) {
    const rowBase = y * (1 + width);
    // raw[rowBase] = 0 — filter type: None (already zero)
    for (let x = 0; x < width; x++) {
      raw[rowBase + 1 + x] = pixels[y * width + x] ? 255 : 0;
    }
  }
  return raw;
}

/**
 * Build 8-bit grayscale PNG scanlines from bit-packed pixels (8 pixels per byte, MSB first).
 * Used by the branding renderer.
 */
function buildScanlinesFromPacked(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const packedRowBytes = Math.ceil(width / 8);
  const raw = new Uint8Array(height * (1 + width));
  for (let y = 0; y < height; y++) {
    const rowBase = y * (1 + width);
    // raw[rowBase] = 0 — filter type: None (already zero)
    for (let x = 0; x < width; x++) {
      const byteVal = pixels[y * packedRowBytes + (x >> 3)] ?? 0;
      raw[rowBase + 1 + x] = (byteVal & (0x80 >> (x & 7))) ? 255 : 0;
    }
  }
  return raw;
}

// ── PNG assembly ──────────────────────────────────────────────────────────

async function encodeScanlines(scanlines: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const compressed = await zlibCompress(scanlines);
  if (!compressed) return EMPTY_PNG_BYTES;
  const ihdr = ihdrChunk(width, height);
  const idat = buildChunk(TYPE_IDAT, compressed);
  const png = new Uint8Array(PNG_SIGNATURE.length + ihdr.length + idat.length + IEND_CHUNK.length);
  let pos = 0;
  png.set(PNG_SIGNATURE, pos); pos += PNG_SIGNATURE.length;
  png.set(ihdr, pos);          pos += ihdr.length;
  png.set(idat, pos);          pos += idat.length;
  png.set(IEND_CHUNK, pos);
  return png;
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

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Encode unpacked 1-bit pixels (1 byte per pixel, 0 or 1) to a 1-bit grayscale PNG.
 * Used by the board renderer. _slot is unused (kept for API compatibility with the prior canvas-based encoder).
 */
export async function encodePixelsToPng(
  pixels: Uint8Array,
  width: number,
  height: number,
  _slot = 0,
): Promise<Uint8Array> {
  const startMs = PERF_LOG_ENABLED ? perfNowMs() : 0;
  const png = await encodeScanlines(buildScanlines(pixels, width, height), width, height);
  if (PERF_LOG_ENABLED && png.length > 0) recordPngEncodePerf(width, height, perfNowMs() - startMs, png.length);
  return png;
}

/**
 * Encode bit-packed 1-bit pixels (8 pixels per byte, MSB first) to a 1-bit grayscale PNG.
 * Used by the branding renderer.
 */
export async function encodePackedPixelsToPng(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  return encodeScanlines(buildScanlinesFromPacked(pixels, width, height), width, height);
}
