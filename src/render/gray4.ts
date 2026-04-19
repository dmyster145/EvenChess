/**
 * 4-bit greyscale packing — matches the Even Hub SDK's documented contract for
 * `updateImageRawData` ("raw pixel data in 4-bit greyscale").
 *
 * Byte layout produced by the encoders below:
 *   - No header, no row padding.
 *   - Rows run top-to-bottom (y=0 first).
 *   - Each output byte holds two pixels: the high nibble is the LEFT pixel
 *     (x = 2k), the low nibble is the right pixel (x = 2k + 1).
 *   - Values: 0x0 = black, 0xF = white. Intermediate nibble values (0x1–0xE)
 *     are reserved for future anti-aliased greyscale rendering.
 *
 * Width must be even (200 is the only production width for this app).
 */

/** Output nibble for a "pixel off" (black). */
export const GRAY4_OFF = 0x0;

/** Output nibble for a "pixel on" (white). */
export const GRAY4_ON = 0xf;

/** Size of a packed 4-bit greyscale buffer for the given dimensions. */
export function gray4ByteLength(width: number, height: number): number {
  return (width * height) >> 1;
}

function assertEvenWidth(width: number): void {
  if ((width & 1) !== 0) {
    throw new Error(`gray4: width must be even, got ${width}`);
  }
}

/**
 * Encode unpacked pixels (1 byte per pixel, 0 or non-zero) into packed 4-bit
 * greyscale bytes. Used by the board renderer — its pixel buffer is kept as
 * one byte per pixel for cheap in-place mutation during highlight compositing.
 *
 * If `out` is provided it must be at least `gray4ByteLength(width, height)`
 * bytes; the function reuses and returns it to preserve zero-alloc behaviour
 * in the steady state.
 */
export function encodeUnpackedToGray4(
  src: Uint8Array,
  width: number,
  height: number,
  out?: Uint8Array,
): Uint8Array {
  assertEvenWidth(width);
  const outLen = gray4ByteLength(width, height);
  const dst = out ?? new Uint8Array(outLen);
  if (dst.length < outLen) {
    throw new Error(`gray4: out buffer too small (${dst.length} < ${outLen})`);
  }

  const halfW = width >> 1;
  for (let y = 0; y < height; y++) {
    const srcRow = y * width;
    const dstRow = y * halfW;
    for (let k = 0; k < halfW; k++) {
      const left = src[srcRow + (k << 1)] ? GRAY4_ON : GRAY4_OFF;
      const right = src[srcRow + (k << 1) + 1] ? GRAY4_ON : GRAY4_OFF;
      dst[dstRow + k] = (left << 4) | right;
    }
  }
  return dst;
}

/**
 * Encode bit-packed pixels (8 pixels per byte, MSB first) into packed 4-bit
 * greyscale bytes. Used by the branding renderer — its glyph drawing code
 * emits bit-packed rows because that's what the original 1-bit BMP path
 * consumed.
 */
export function encodePackedToGray4(
  src: Uint8Array,
  width: number,
  height: number,
  out?: Uint8Array,
): Uint8Array {
  assertEvenWidth(width);
  const outLen = gray4ByteLength(width, height);
  const dst = out ?? new Uint8Array(outLen);
  if (dst.length < outLen) {
    throw new Error(`gray4: out buffer too small (${dst.length} < ${outLen})`);
  }

  const packedRowBytes = (width + 7) >> 3;
  const halfW = width >> 1;
  for (let y = 0; y < height; y++) {
    const srcRow = y * packedRowBytes;
    const dstRow = y * halfW;
    for (let k = 0; k < halfW; k++) {
      const xLeft = k << 1;
      const xRight = xLeft + 1;
      const byteLeft = src[srcRow + (xLeft >> 3)] ?? 0;
      const byteRight = src[srcRow + (xRight >> 3)] ?? 0;
      const left = byteLeft & (0x80 >> (xLeft & 7)) ? GRAY4_ON : GRAY4_OFF;
      const right = byteRight & (0x80 >> (xRight & 7)) ? GRAY4_ON : GRAY4_OFF;
      dst[dstRow + k] = (left << 4) | right;
    }
  }
  return dst;
}
