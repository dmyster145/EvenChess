import { describe, it, expect } from 'vitest';
import { encodePixelsToPng, encodePackedPixelsToPng } from '../../src/render/png-encode';

// The PNG byte layout:
//   [0..7]   signature
//   [8..11]  IHDR chunk length (= 13)
//   [12..15] "IHDR"
//   [16..19] width (big-endian)
//   [20..23] height (big-endian)
//   [24]     bit depth  ← we assert on this
//   [25]     color type
const PNG_IHDR_BIT_DEPTH_OFFSET = 24;

describe('png-encode bit depth', () => {
  it('produces a PNG whose IHDR bit depth is at least 2 (firmware rejects 1-bit)', async () => {
    // Seed two colors (0 and 1) so the palette has both entries. The G2
    // firmware renders 1-bit PNGs as solid green; anything >=2-bit is safe.
    const pixels = new Uint8Array(16 * 4);
    pixels[0] = 1;
    pixels[17] = 1;
    const png = await encodePixelsToPng(pixels, 16, 4);
    expect(png.length).toBeGreaterThan(24);
    const bd = png[PNG_IHDR_BIT_DEPTH_OFFSET];
    // 1 = solid green on device; 2/4/8 all decode correctly.
    expect(bd).not.toBe(1);
    expect([2, 4, 8]).toContain(bd);
  });

  it('packed input path also produces a PNG with bit depth >= 2', async () => {
    // 16 pixels wide, 1 tall, bit-packed. 0b10110100_00110010 → two bytes.
    const packed = new Uint8Array([0b10110100, 0b00110010]);
    const png = await encodePackedPixelsToPng(packed, 16, 1);
    expect(png.length).toBeGreaterThan(24);
    const bd = png[PNG_IHDR_BIT_DEPTH_OFFSET];
    expect(bd).not.toBe(1);
    expect([2, 4, 8]).toContain(bd);
  });

  it('begins with the standard PNG signature', async () => {
    const pixels = new Uint8Array(4);
    pixels[0] = 1;
    const png = await encodePixelsToPng(pixels, 2, 2);
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
