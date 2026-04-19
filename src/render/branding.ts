/**
 * Branding image generator — renders the "CHESS" logo / CHECK / CHECKMATE
 * badges as 4-bit indexed PNG (raw packed 4-bit greyscale fallback when the
 * PNG encode is unavailable). Output format matches the Even Hub SDK's
 * `updateImageRawData` contract ("raw pixel data in 4-bit greyscale").
 */

import { ImageRawDataUpdate } from '@evenrealities/even_hub_sdk';
import {
  CONTAINER_ID_BRAND,
  CONTAINER_NAME_BRAND,
  BRAND_WIDTH,
  BRAND_HEIGHT,
} from './composer';
import { PIECE_SILHOUETTES, PIECE_SIZE } from './pieces';
import { encodePackedToGray4 } from './gray4';
import { encodePackedPixelsToPng } from './png-encode';

/** Bytes per bit-packed row (8 pixels per byte, MSB first). Matches the
 * intermediate buffer shape consumed by both `encodePackedPixelsToPng` and
 * `encodePackedToGray4`. */
const PACKED_ROW_BYTES = (BRAND_WIDTH + 7) >> 3;

function setPixel(pixels: Uint8Array, x: number, y: number, on: number): void {
  if (x < 0 || x >= BRAND_WIDTH || y < 0 || y >= BRAND_HEIGHT) return;
  const byteIndex = y * PACKED_ROW_BYTES + Math.floor(x / 8);
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

// ── Pixel renderers (bit-packed, MSB first) ───────────────────────────────

function makeBrandPixels(): Uint8Array {
  const pixels = new Uint8Array(PACKED_ROW_BYTES * BRAND_HEIGHT);
  let xPos = 2;
  const yPos = Math.floor((BRAND_HEIGHT - 16) / 2);
  for (const ch of 'CHESS') {
    xPos += drawBrandChar(pixels, xPos, yPos, ch);
  }
  drawKnightIcon(pixels, xPos + 4, Math.floor((BRAND_HEIGHT - 19) / 2));
  return pixels;
}

function makeBlankPixels(): Uint8Array {
  return new Uint8Array(PACKED_ROW_BYTES * BRAND_HEIGHT);
}

function makeStatusPixels(text: string): Uint8Array {
  const pixels = new Uint8Array(PACKED_ROW_BYTES * BRAND_HEIGHT);
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

/** Convert a bit-packed brand buffer to the cached `number[]` payload. Per
 * the SDK README, `number[]` is the recommended `imageData` type — passing
 * `Uint8Array` forces the SDK to convert on every send. Pre-converting once
 * at cache-warm time avoids that cost for the CHECK/CHECKMATE hot path. */
function packedToCachedNumberArray(packed: Uint8Array): number[] {
  return Array.from(encodePackedToGray4(packed, BRAND_WIDTH, BRAND_HEIGHT));
}

// ── Caches ────────────────────────────────────────────────────────────────

let cachedBrandImage: ImageRawDataUpdate | null = null;
let cachedBlankBrandImage: ImageRawDataUpdate | null = null;
let cachedCheckBrandImage: ImageRawDataUpdate | null = null;
let cachedCheckmateBrandImage: ImageRawDataUpdate | null = null;

// ── Sync raw 4-bit render (fallback when PNG encode is unavailable) ────────

export function renderBrandingImage(): ImageRawDataUpdate {
  if (cachedBrandImage) return cachedBrandImage;
  cachedBrandImage = makeBrandingUpdate(packedToCachedNumberArray(makeBrandPixels()));
  return cachedBrandImage;
}

export function renderBlankBrandingImage(): ImageRawDataUpdate {
  if (cachedBlankBrandImage) return cachedBlankBrandImage;
  cachedBlankBrandImage = makeBrandingUpdate(packedToCachedNumberArray(makeBlankPixels()));
  return cachedBlankBrandImage;
}

export function renderCheckBrandingImage(): ImageRawDataUpdate {
  if (cachedCheckBrandImage) return cachedCheckBrandImage;
  cachedCheckBrandImage = makeBrandingUpdate(packedToCachedNumberArray(makeStatusPixels('CHECK!')));
  return cachedCheckBrandImage;
}

export function renderCheckmateBrandingImage(): ImageRawDataUpdate {
  if (cachedCheckmateBrandImage) return cachedCheckmateBrandImage;
  cachedCheckmateBrandImage = makeBrandingUpdate(packedToCachedNumberArray(makeStatusPixels('CHECKMATE!')));
  return cachedCheckmateBrandImage;
}

// ── PNG preload ───────────────────────────────────────────────────────────

/**
 * Pre-encode all branding images as 4-bit indexed PNG and replace the raw
 * greyscale fallback caches. Call once at startup; runs in parallel with hub
 * init so PNG is ready before the first branding send. Silently keeps the
 * raw 4-bit fallbacks if PNG encoding is unavailable.
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
