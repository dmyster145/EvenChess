/**
 * The strip image above the board: the captured-pieces strip, or a CHECK!/CHECKMATE! banner, or
 * blank. All are 1-bit BMPs; the two banners are also pre-encoded as PNG at startup
 * (preloadBrandingImages) and use the PNG once it is ready.
 */

import { ImageRawDataUpdate } from '@evenrealities/even_hub_sdk';
import {
  CONTAINER_ID_BRAND,
  CONTAINER_NAME_BRAND,
  BRAND_WIDTH,
  BRAND_HEIGHT,
} from './composer';
import { PIECE_SILHOUETTES, PIECE_SIZE } from './pieces';
import {
  BMP_HEADER_SIZE,
  getBmpRowBytes,
  getBmpRowStride,
  getBmpFileSize,
  writeMonoBmpHeader,
} from './bmp-constants';
import { encodePackedPixelsToPng } from './png-encode';

function setPixel(pixels: Uint8Array, x: number, y: number, on: number): void {
  if (x < 0 || x >= BRAND_WIDTH || y < 0 || y >= BRAND_HEIGHT) return;
  const byteIndex = y * Math.ceil(BRAND_WIDTH / 8) + Math.floor(x / 8);
  const bitIndex = 7 - (x % 8);
  const current = pixels[byteIndex] ?? 0;
  if (on) {
    pixels[byteIndex] = current | (1 << bitIndex);
  } else {
    pixels[byteIndex] = current & ~(1 << bitIndex);
  }
}

// Banner font: 12 wide x 16 tall, only the letters CHECK! and CHECKMATE! need.
const BRAND_CHAR_W = 12;
const BRAND_FONT: Record<string, number[]> = {
  'E': [
    0b011111111110,
    0b111111111111,
    0b110000000000,
    0b110000000000,
    0b110000000000,
    0b110000000000,
    0b111111111100,
    0b111111111100,
    0b110000000000,
    0b110000000000,
    0b110000000000,
    0b110000000000,
    0b110000000000,
    0b111111111111,
    0b011111111110,
    0b000000000000,
  ],
  'C': [
    0b001111111100,
    0b011111111110,
    0b111000000111,
    0b110000000011,
    0b110000000000,
    0b110000000000,
    0b110000000000,
    0b110000000000,
    0b110000000000,
    0b110000000000,
    0b110000000000,
    0b110000000011,
    0b111000000111,
    0b011111111110,
    0b001111111100,
    0b000000000000,
  ],
  'H': [
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b111111111111,
    0b111111111111,
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b000000000000,
  ],
  'K': [
    0b110000000111,
    0b110000001110,
    0b110000011100,
    0b110000111000,
    0b110001110000,
    0b110011100000,
    0b110111000000,
    0b111110000000,
    0b111111000000,
    0b110011100000,
    0b110001110000,
    0b110000111000,
    0b110000011100,
    0b110000001110,
    0b110000000111,
    0b000000000000,
  ],
  '!': [
    0b0110,
    0b0110,
    0b0110,
    0b0110,
    0b0110,
    0b0110,
    0b0110,
    0b0110,
    0b0110,
    0b0110,
    0b0000,
    0b0000,
    0b0110,
    0b0110,
    0b0110,
    0b0000,
  ],
  'A': [
    0b000111100000,
    0b001111110000,
    0b011000011000,
    0b011000011000,
    0b110000001100,
    0b110000001100,
    0b111111111100,
    0b111111111100,
    0b110000001100,
    0b110000001100,
    0b110000001100,
    0b110000001100,
    0b110000001100,
    0b110000001100,
    0b110000001100,
    0b000000000000,
  ],
  'M': [
    0b110000000011,
    0b111000000111,
    0b111100001111,
    0b111110011111,
    0b110111111011,
    0b110011110011,
    0b110001100011,
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b000000000000,
  ],
  'T': [
    0b111111111111,
    0b111111111111,
    0b000001100000,
    0b000001100000,
    0b000001100000,
    0b000001100000,
    0b000001100000,
    0b000001100000,
    0b000001100000,
    0b000001100000,
    0b000001100000,
    0b000001100000,
    0b000001100000,
    0b000001100000,
    0b000001100000,
    0b000000000000,
  ],
};

function drawBrandChar(
  pixels: Uint8Array,
  x: number,
  y: number,
  ch: string,
): number {
  const glyph = BRAND_FONT[ch];
  if (!glyph) return 0;
  
  const charHeight = 16;
  
  for (let row = 0; row < charHeight; row++) {
    const bits = glyph[row] ?? 0;
    for (let col = 0; col < BRAND_CHAR_W; col++) {
      if (bits & (1 << (BRAND_CHAR_W - 1 - col))) {
        setPixel(pixels, x + col, y + row, 1);
      }
    }
  }
  
  return BRAND_CHAR_W + 2;
}

// ── Captured-pieces strip ─────────────────────────────────────────────────
// One row, board-size (19px) silhouettes: White's lost pieces solid on the LEFT,
// Black's lost pieces as OUTLINES on the RIGHT. Counts (only ever 2–8: max 8 pawns)
// use a compact 5×7 digit font lifted from the board marker font.

const DIGIT_5x7: Record<string, number[]> = {
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '+': [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
};
const CAPTURE_ORDER = ['q', 'r', 'b', 'n', 'p'] as const;
const DIGIT_W = 5;
const ENTRY_GAP = 3;

function drawDigit(pixels: Uint8Array, x: number, y: number, ch: string): void {
  const glyph = DIGIT_5x7[ch];
  if (!glyph) return;
  for (let row = 0; row < 7; row++) {
    const bits = glyph[row] ?? 0;
    for (let col = 0; col < 5; col++) {
      if (bits & (1 << (4 - col))) setPixel(pixels, x + col, y + row, 1);
    }
  }
}

/** Native-size (19px) piece silhouette. `outline` draws only the perimeter. */
function drawSilhouette(pixels: Uint8Array, x: number, y: number, type: string, outline: boolean): void {
  const bmp = PIECE_SILHOUETTES[type];
  if (!bmp) return;
  const on = (r: number, c: number): boolean =>
    r >= 0 && r < PIECE_SIZE && c >= 0 && c < PIECE_SIZE &&
    ((bmp[r] ?? 0) & (1 << (PIECE_SIZE - 1 - c))) !== 0;
  for (let row = 0; row < PIECE_SIZE; row++) {
    for (let col = 0; col < PIECE_SIZE; col++) {
      if (!on(row, col)) continue;
      if (outline && on(row - 1, col) && on(row + 1, col) && on(row, col - 1) && on(row, col + 1)) {
        continue; // interior pixel — skip so only the edge remains
      }
      setPixel(pixels, x + col, y + row, 1);
    }
  }
}

/** A drawing instruction for the captured-pieces strip. x is the left edge of the 19px box. */
export type StripOp =
  | { kind: 'piece'; type: string; x: number; outline: boolean }
  | { kind: 'text'; text: string; x: number };

// Silhouettes only use columns 1–15 of their 19px box, so the compact layout packs them by that
// visible width.
const INK_LEFT = 1;
const INK_W = 15;
const STRIP_LEFT = 2;
const STRIP_RIGHT = BRAND_WIDTH - 2;
/** Space kept between White's group (left) and Black's (right). */
const GROUP_GAP = 6;

interface StripMode {
  /** Width one silhouette occupies, and where it sits in its 19px box. */
  cell: number;
  inkOffset: number;
  gap: number;
}
const NORMAL: StripMode = { cell: PIECE_SIZE, inkOffset: 0, gap: ENTRY_GAP };
const COMPACT: StripMode = { cell: INK_W, inkOffset: INK_LEFT, gap: 2 };

const textWidth = (text: string): number => text.length * (DIGIT_W + 1);

function entries(counts: Record<string, number>): Array<{ type: string; n: number }> {
  return CAPTURE_ORDER.filter((t) => (counts[t] ?? 0) > 0).map((t) => ({ type: t, n: counts[t]! }));
}

function entryWidth(n: number, mode: StripMode): number {
  return mode.cell + (n > 1 ? textWidth(String(n)) : 0);
}

function groupWidth(list: Array<{ n: number }>, mode: StripMode): number {
  return list.reduce((w, e, i) => w + entryWidth(e.n, mode) + (i > 0 ? mode.gap : 0), 0);
}

/**
 * Place one side's captured pieces from startX within maxWidth. Entries that don't fit are
 * summarized as "+N" (N = pieces not shown) instead of being silently dropped.
 */
function placeGroup(
  list: Array<{ type: string; n: number }>,
  startX: number,
  maxWidth: number,
  mode: StripMode,
  outline: boolean,
): StripOp[] {
  const ops: StripOp[] = [];
  const limit = startX + maxWidth;
  let x = startX;
  for (let i = 0; i < list.length; i++) {
    const e = list[i]!;
    const restAfter = list.slice(i + 1).reduce((sum, r) => sum + r.n, 0);
    const reserve = restAfter > 0 ? mode.gap + textWidth(`+${restAfter}`) : 0;
    if (x + entryWidth(e.n, mode) + reserve > limit) {
      const hidden = list.slice(i).reduce((sum, r) => sum + r.n, 0);
      ops.push({ kind: 'text', text: `+${hidden}`, x });
      return ops;
    }
    ops.push({ kind: 'piece', type: e.type, x: x - mode.inkOffset, outline });
    x += mode.cell;
    if (e.n > 1) {
      ops.push({ kind: 'text', text: String(e.n), x });
      x += textWidth(String(e.n));
    }
    x += mode.gap;
  }
  return ops;
}

/**
 * Lay out the captured-pieces strip: White's captured pieces solid on the left, Black's outlined on
 * the right. Uses the roomy layout when both groups fit, a compact one when they don't, and "+N"
 * for whatever still doesn't fit, so every captured piece is either shown or counted.
 */
export function layoutCapturedStrip(white: Record<string, number>, black: Record<string, number>): StripOp[] {
  const w = entries(white);
  const b = entries(black);
  const avail = STRIP_RIGHT - STRIP_LEFT - GROUP_GAP;
  const roomyW = groupWidth(w, NORMAL);
  const roomyB = groupWidth(b, NORMAL);
  if (roomyW + roomyB <= avail) {
    return [
      ...placeGroup(w, STRIP_LEFT, roomyW, NORMAL, false),
      ...placeGroup(b, STRIP_RIGHT - roomyB, roomyB, NORMAL, true),
    ];
  }
  // Compact: a side that fits in half the strip gets just what it needs and the other side gets
  // the rest; anything still over its space is summarized as "+N".
  const ww = groupWidth(w, COMPACT);
  const bw = groupWidth(b, COMPACT);
  const half = Math.floor(avail / 2);
  const whiteSpace = ww <= half ? ww : bw <= half ? avail - bw : half;
  const blackSpace = avail - whiteSpace;
  const blackStart = STRIP_RIGHT - Math.min(bw, blackSpace);
  return [
    ...placeGroup(w, STRIP_LEFT, whiteSpace, COMPACT, false),
    ...placeGroup(b, blackStart, Math.min(bw, blackSpace), COMPACT, true),
  ];
}

function hasAnyCapture(counts: Record<string, number>): boolean {
  return CAPTURE_ORDER.some((t) => (counts[t] ?? 0) > 0);
}

function makeCapturedPixels(black: Record<string, number>, white: Record<string, number>): Uint8Array {
  // Branding disabled: nothing captured → blank strip (no "CHESS" mark).
  if (!hasAnyCapture(black) && !hasAnyCapture(white)) return makeBlankPixels();
  const rowBytes = getBmpRowBytes(BRAND_WIDTH);
  const pixels = new Uint8Array(rowBytes * BRAND_HEIGHT);
  const y = Math.floor((BRAND_HEIGHT - PIECE_SIZE) / 2);
  const textY = y + Math.floor((PIECE_SIZE - 7) / 2);
  for (const op of layoutCapturedStrip(white, black)) {
    if (op.kind === 'piece') {
      drawSilhouette(pixels, op.x, y, op.type, op.outline);
    } else {
      [...op.text].forEach((ch, i) => drawDigit(pixels, op.x + i * (DIGIT_W + 1), textY, ch));
    }
  }
  return pixels;
}

function create1BitBmp(pixels: Uint8Array): Uint8Array {
  const rowBytes = getBmpRowBytes(BRAND_WIDTH);
  const rowPadded = getBmpRowStride(BRAND_WIDTH);
  const fileSize = getBmpFileSize(BRAND_WIDTH, BRAND_HEIGHT);

  const bmp = new Uint8Array(fileSize);
  // The strip's "on" colour has always been pure green; the board uses white.
  writeMonoBmpHeader(bmp, BRAND_WIDTH, BRAND_HEIGHT, 0x00ff00);

  for (let y = 0; y < BRAND_HEIGHT; y++) {
    const srcRow = BRAND_HEIGHT - 1 - y;
    const dstOffset = BMP_HEADER_SIZE + y * rowPadded;
    for (let b = 0; b < rowBytes; b++) {
      bmp[dstOffset + b] = pixels[srcRow * rowBytes + b] ?? 0;
    }
  }

  return bmp;
}

// ── Pixel renderers (bit-packed, MSB first) ───────────────────────────────

function makeBlankPixels(): Uint8Array {
  return new Uint8Array(Math.ceil(BRAND_WIDTH / 8) * BRAND_HEIGHT);
}

function makeStatusPixels(text: string): Uint8Array {
  const rowBytes = getBmpRowBytes(BRAND_WIDTH);
  const pixels = new Uint8Array(rowBytes * BRAND_HEIGHT);
  let totalWidth = 0;
  for (let i = 0; i < text.length; i++) totalWidth += BRAND_CHAR_W + 2;
  if (text.length > 0) totalWidth -= 2;
  let xPos = Math.floor((BRAND_WIDTH - totalWidth) / 2);
  const yPos = Math.floor((BRAND_HEIGHT - 16) / 2);
  for (const ch of text) xPos += drawBrandChar(pixels, xPos, yPos, ch);
  return pixels;
}

function makeBrandingUpdate(imageData: Uint8Array | number[]): ImageRawDataUpdate {
  return new ImageRawDataUpdate({ containerID: CONTAINER_ID_BRAND, containerName: CONTAINER_NAME_BRAND, imageData });
}

// ── Caches ────────────────────────────────────────────────────────────────

let cachedBlankBrandImage: ImageRawDataUpdate | null = null;
let cachedCheckBrandImage: ImageRawDataUpdate | null = null;
let cachedCheckmateBrandImage: ImageRawDataUpdate | null = null;

// ── Sync BMP render (fallback) ────────────────────────────────────────────

export function renderBlankBrandingImage(): ImageRawDataUpdate {
  if (cachedBlankBrandImage) return cachedBlankBrandImage;
  cachedBlankBrandImage = makeBrandingUpdate(Array.from(create1BitBmp(makeBlankPixels())));
  return cachedBlankBrandImage;
}

let cachedCapturedSig: string | null = null;
let cachedCapturedImage: ImageRawDataUpdate | null = null;

/** Captured-pieces strip (normal mode). `sig` lets the caller skip re-encode when unchanged. */
export function renderCapturedBrandingImage(
  black: Record<string, number>,
  white: Record<string, number>,
  sig: string,
): ImageRawDataUpdate {
  if (cachedCapturedImage && cachedCapturedSig === sig) return cachedCapturedImage;
  cachedCapturedSig = sig;
  cachedCapturedImage = makeBrandingUpdate(Array.from(create1BitBmp(makeCapturedPixels(black, white))));
  return cachedCapturedImage;
}

export function renderCheckBrandingImage(): ImageRawDataUpdate {
  if (cachedCheckBrandImage) return cachedCheckBrandImage;
  cachedCheckBrandImage = makeBrandingUpdate(Array.from(create1BitBmp(makeStatusPixels('CHECK!'))));
  return cachedCheckBrandImage;
}

export function renderCheckmateBrandingImage(): ImageRawDataUpdate {
  if (cachedCheckmateBrandImage) return cachedCheckmateBrandImage;
  cachedCheckmateBrandImage = makeBrandingUpdate(Array.from(create1BitBmp(makeStatusPixels('CHECKMATE!'))));
  return cachedCheckmateBrandImage;
}

// ── PNG preload ───────────────────────────────────────────────────────────

let preloadPromise: Promise<void> | null = null;

/**
 * Pre-encode the CHECK!/CHECKMATE! banners as PNG and replace their BMP caches. Idempotent;
 * keeps the BMP fallbacks if PNG encoding is unavailable.
 *
 * The blank strip is deliberately NOT PNG-encoded: an all-blank image comes out of the encoder as
 * a 1-bit PNG, which renders solid green on G2 firmware (see png-encode.ts). It stays a BMP.
 */
export function preloadBrandingImages(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = (async () => {
      const [checkPng, checkmatePng] = await Promise.all([
        encodePackedPixelsToPng(makeStatusPixels('CHECK!'), BRAND_WIDTH, BRAND_HEIGHT),
        encodePackedPixelsToPng(makeStatusPixels('CHECKMATE!'), BRAND_WIDTH, BRAND_HEIGHT),
      ]);
      if (checkPng.length > 0) cachedCheckBrandImage = makeBrandingUpdate(checkPng);
      if (checkmatePng.length > 0) cachedCheckmateBrandImage = makeBrandingUpdate(checkmatePng);
    })();
  }
  return preloadPromise;
}
