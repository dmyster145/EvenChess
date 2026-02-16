/**
 * Branding image generator — renders "EvenChess" logo as 1-bit BMP.
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
};

function drawBrandChar(
  pixels: Uint8Array,
  x: number,
  y: number,
  ch: string,
): number {
  const glyph = BRAND_FONT[ch];
  if (!glyph) return 0;
  
  const charWidth = ch === '.' ? 4 : 12;
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

let cachedBrandImage: ImageRawDataUpdate | null = null;
let cachedBlankBrandImage: ImageRawDataUpdate | null = null;

export function renderBrandingImage(): ImageRawDataUpdate {
  if (cachedBrandImage) return cachedBrandImage;

  const rowBytes = getBmpRowBytes(BRAND_WIDTH);
  const pixels = new Uint8Array(rowBytes * BRAND_HEIGHT);

  const text = 'EVEN.CHESS';
  let xPos = 2;
  const yPos = Math.floor((BRAND_HEIGHT - 16) / 2);

  for (const ch of text) {
    xPos += drawBrandChar(pixels, xPos, yPos, ch);
  }

  const knightX = xPos + 4;
  const knightY = Math.floor((BRAND_HEIGHT - 19) / 2);
  drawKnightIcon(pixels, knightX, knightY);

  const bmpData = create1BitBmp(pixels);

  cachedBrandImage = new ImageRawDataUpdate({
    containerID: CONTAINER_ID_BRAND,
    containerName: CONTAINER_NAME_BRAND,
    imageData: Array.from(bmpData),
  });

  return cachedBrandImage;
}

export function renderBlankBrandingImage(): ImageRawDataUpdate {
  if (cachedBlankBrandImage) return cachedBlankBrandImage;

  const rowBytes = Math.ceil(BRAND_WIDTH / 8);
  const pixels = new Uint8Array(rowBytes * BRAND_HEIGHT); // All zeros = blank

  const bmpData = create1BitBmp(pixels);

  cachedBlankBrandImage = new ImageRawDataUpdate({
    containerID: CONTAINER_ID_BRAND,
    containerName: CONTAINER_NAME_BRAND,
    imageData: Array.from(bmpData),
  });

  return cachedBlankBrandImage;
}

let cachedCheckBrandImage: ImageRawDataUpdate | null = null;

export function renderCheckBrandingImage(): ImageRawDataUpdate {
  if (cachedCheckBrandImage) return cachedCheckBrandImage;

  const rowBytes = getBmpRowBytes(BRAND_WIDTH);
  const pixels = new Uint8Array(rowBytes * BRAND_HEIGHT);

  const text = 'CHECK!';
  let totalWidth = 0;
  for (const ch of text) {
    totalWidth += (BRAND_FONT[ch]?.[0]?.toString(2).length ?? 8) + 2;
  }
  totalWidth -= 2;
  
  let xPos = Math.floor((BRAND_WIDTH - totalWidth) / 2);
  const yPos = Math.floor((BRAND_HEIGHT - 16) / 2);

  for (const ch of text) {
    xPos += drawBrandChar(pixels, xPos, yPos, ch);
  }

  const bmpData = create1BitBmp(pixels);

  cachedCheckBrandImage = new ImageRawDataUpdate({
    containerID: CONTAINER_ID_BRAND,
    containerName: CONTAINER_NAME_BRAND,
    imageData: Array.from(bmpData),
  });

  return cachedCheckBrandImage;
}
