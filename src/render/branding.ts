/**
 * Branding image generator — renders "Chess" logo as 1-bit PNG (BMP fallback if compression unavailable).
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
  BMP_SIGNATURE,
  getBmpRowBytes,
  getBmpRowStride,
  getBmpFileSize,
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

// Font: 12 wide x 16 tall
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
  'V': [
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b011000000110,
    0b011000000110,
    0b011000000110,
    0b001100001100,
    0b001100001100,
    0b001100001100,
    0b000110011000,
    0b000110011000,
    0b000011110000,
    0b000011110000,
    0b000001100000,
    0b000001100000,
    0b000000000000,
  ],
  'N': [
    0b110000000011,
    0b111000000011,
    0b111100000011,
    0b111110000011,
    0b110111000011,
    0b110011100011,
    0b110001110011,
    0b110000111011,
    0b110000011111,
    0b110000001111,
    0b110000000111,
    0b110000000011,
    0b110000000011,
    0b110000000011,
    0b110000000011,
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
  'S': [
    0b001111111100,
    0b011111111110,
    0b111000000111,
    0b110000000011,
    0b110000000000,
    0b111000000000,
    0b011111100000,
    0b001111111100,
    0b000001111110,
    0b000000000111,
    0b000000000011,
    0b110000000011,
    0b111000000111,
    0b011111111110,
    0b001111111100,
    0b000000000000,
  ],
  '.': [
    0b0000,
    0b0000,
    0b0000,
    0b0000,
    0b0000,
    0b0000,
    0b0110,
    0b1111,
    0b1111,
    0b0110,
    0b0000,
    0b0000,
    0b0000,
    0b0000,
    0b0000,
    0b0000,
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

function brandCharWidth(ch: string): number {
  return ch === '.' ? 4 : 12;
}

function drawBrandChar(
  pixels: Uint8Array,
  x: number,
  y: number,
  ch: string,
): number {
  const glyph = BRAND_FONT[ch];
  if (!glyph) return 0;
  
  const charWidth = brandCharWidth(ch);
  const charHeight = 16;
  
  for (let row = 0; row < charHeight; row++) {
    const bits = glyph[row] ?? 0;
    for (let col = 0; col < charWidth; col++) {
      if (bits & (1 << (charWidth - 1 - col))) {
        setPixel(pixels, x + col, y + row, 1);
      }
    }
  }
  
  return charWidth + 2;
}

function drawKnightIcon(pixels: Uint8Array, x: number, y: number): void {
  const knightBitmap = PIECE_SILHOUETTES['n'];
  if (!knightBitmap) return;
  
  for (let row = 0; row < PIECE_SIZE; row++) {
    const bits = knightBitmap[row] ?? 0;
    for (let col = 0; col < PIECE_SIZE; col++) {
      if (bits & (1 << (PIECE_SIZE - 1 - col))) {
        setPixel(pixels, x + col, y + row, 1);
      }
    }
  }
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

function entryWidth(n: number): number {
  return PIECE_SIZE + (n > 1 ? DIGIT_W + 1 : 0) + ENTRY_GAP;
}

function groupWidth(counts: Record<string, number>): number {
  let w = 0;
  for (const t of CAPTURE_ORDER) {
    const n = counts[t] ?? 0;
    if (n > 0) w += entryWidth(n);
  }
  return w;
}

/** Draw a captured group left→right from startX; returns the x just past it. */
function drawGroup(
  pixels: Uint8Array,
  startX: number,
  y: number,
  counts: Record<string, number>,
  outline: boolean,
): number {
  let x = startX;
  for (const t of CAPTURE_ORDER) {
    const n = counts[t] ?? 0;
    if (n <= 0) continue;
    if (x + PIECE_SIZE > BRAND_WIDTH - 1) break; // clip overflow
    drawSilhouette(pixels, x, y, t, outline);
    x += PIECE_SIZE;
    if (n > 1) {
      drawDigit(pixels, x, y + Math.floor((PIECE_SIZE - 7) / 2), String(n));
      x += DIGIT_W + 1;
    }
    x += ENTRY_GAP;
  }
  return x;
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

  const whiteEnd = drawGroup(pixels, 2, y, white, false); // White solid, left
  const bw = groupWidth(black);
  const blackStart = Math.max(whiteEnd + 4, BRAND_WIDTH - 2 - bw);
  drawGroup(pixels, blackStart, y, black, true); // Black outline, right
  return pixels;
}

function create1BitBmp(pixels: Uint8Array): Uint8Array {
  const rowBytes = getBmpRowBytes(BRAND_WIDTH);
  const rowPadded = getBmpRowStride(BRAND_WIDTH);
  const fileSize = getBmpFileSize(BRAND_WIDTH, BRAND_HEIGHT);

  const bmp = new Uint8Array(fileSize);

  bmp[0] = BMP_SIGNATURE[0]; bmp[1] = BMP_SIGNATURE[1];
  bmp[2] = fileSize & 0xff;
  bmp[3] = (fileSize >> 8) & 0xff;
  bmp[4] = (fileSize >> 16) & 0xff;
  bmp[5] = (fileSize >> 24) & 0xff;
  bmp[10] = BMP_HEADER_SIZE;

  bmp[14] = 40;
  bmp[18] = BRAND_WIDTH & 0xff;
  bmp[19] = (BRAND_WIDTH >> 8) & 0xff;
  bmp[22] = BRAND_HEIGHT & 0xff;
  bmp[23] = (BRAND_HEIGHT >> 8) & 0xff;
  bmp[26] = 1;
  bmp[28] = 1;

  bmp[54] = 0; bmp[55] = 0; bmp[56] = 0; bmp[57] = 0;
  bmp[58] = 0; bmp[59] = 255; bmp[60] = 0; bmp[61] = 0;

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

function makeBrandPixels(): Uint8Array {
  const rowBytes = getBmpRowBytes(BRAND_WIDTH);
  const pixels = new Uint8Array(rowBytes * BRAND_HEIGHT);
  let xPos = 2;
  const yPos = Math.floor((BRAND_HEIGHT - 16) / 2);
  for (const ch of 'CHESS') {
    xPos += drawBrandChar(pixels, xPos, yPos, ch);
  }
  drawKnightIcon(pixels, xPos + 4, Math.floor((BRAND_HEIGHT - 19) / 2));
  return pixels;
}

function makeBlankPixels(): Uint8Array {
  return new Uint8Array(Math.ceil(BRAND_WIDTH / 8) * BRAND_HEIGHT);
}

function makeStatusPixels(text: string): Uint8Array {
  const rowBytes = getBmpRowBytes(BRAND_WIDTH);
  const pixels = new Uint8Array(rowBytes * BRAND_HEIGHT);
  let totalWidth = 0;
  for (const ch of text) totalWidth += brandCharWidth(ch) + 2;
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

let cachedBrandImage: ImageRawDataUpdate | null = null;
let cachedBlankBrandImage: ImageRawDataUpdate | null = null;
let cachedCheckBrandImage: ImageRawDataUpdate | null = null;
let cachedCheckmateBrandImage: ImageRawDataUpdate | null = null;

// ── Sync BMP render (fallback) ────────────────────────────────────────────

export function renderBrandingImage(): ImageRawDataUpdate {
  if (cachedBrandImage) return cachedBrandImage;
  cachedBrandImage = makeBrandingUpdate(Array.from(create1BitBmp(makeBrandPixels())));
  return cachedBrandImage;
}

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

/**
 * Pre-encode all branding images as 1-bit PNG and replace the BMP caches.
 * Call once at startup; runs in parallel with hub init so PNG is ready before first branding send.
 * Silently keeps BMP fallbacks if PNG encoding is unavailable.
 */
export async function preloadBrandingImages(): Promise<void> {
  const [brandPng, blankPng, checkPng, checkmatePng] = await Promise.all([
    encodePackedPixelsToPng(makeBrandPixels(), BRAND_WIDTH, BRAND_HEIGHT),
    encodePackedPixelsToPng(makeBlankPixels(), BRAND_WIDTH, BRAND_HEIGHT),
    encodePackedPixelsToPng(makeStatusPixels('CHECK!'), BRAND_WIDTH, BRAND_HEIGHT),
    encodePackedPixelsToPng(makeStatusPixels('CHECKMATE!'), BRAND_WIDTH, BRAND_HEIGHT),
  ]);
  if (brandPng.length > 0)     cachedBrandImage         = makeBrandingUpdate(brandPng);
  if (blankPng.length > 0)     cachedBlankBrandImage    = makeBrandingUpdate(blankPng);
  if (checkPng.length > 0)     cachedCheckBrandImage    = makeBrandingUpdate(checkPng);
  if (checkmatePng.length > 0) cachedCheckmateBrandImage = makeBrandingUpdate(checkmatePng);
}
