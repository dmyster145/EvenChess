import { describe, it, expect } from 'vitest';
import {
  renderBrandingImage,
  renderBlankBrandingImage,
  renderCheckBrandingImage,
  renderCheckmateBrandingImage,
} from '../../src/render/branding';

// Expected payload size = BRAND_WIDTH(200) * BRAND_HEIGHT(24) / 2 = 2400 bytes
// packed at 4-bit greyscale.
const EXPECTED_BYTES = 2_400;

describe('branding sync fallbacks', () => {
  it('renderBrandingImage returns a number[] of 2400 bytes targeting the brand container', () => {
    const update = renderBrandingImage();
    expect(Array.isArray(update.imageData)).toBe(true);
    expect((update.imageData as number[]).length).toBe(EXPECTED_BYTES);
    expect(update.containerName).toBe('brand');
  });

  it('renderBlankBrandingImage is all-off (every nibble = 0)', () => {
    const update = renderBlankBrandingImage();
    const data = update.imageData as number[];
    expect(data.length).toBe(EXPECTED_BYTES);
    expect(data.every((b) => b === 0)).toBe(true);
  });

  it('CHECK and CHECKMATE payloads are nonempty and the correct length', () => {
    const check = renderCheckBrandingImage();
    const checkmate = renderCheckmateBrandingImage();
    expect((check.imageData as number[]).length).toBe(EXPECTED_BYTES);
    expect((checkmate.imageData as number[]).length).toBe(EXPECTED_BYTES);
    // Both have some non-zero glyph pixels (not blank).
    expect((check.imageData as number[]).some((b) => b !== 0)).toBe(true);
    expect((checkmate.imageData as number[]).some((b) => b !== 0)).toBe(true);
  });

  it('only packs nibble values 0x0 (off) and 0xF (on); no intermediate greys', () => {
    const data = renderCheckBrandingImage().imageData as number[];
    for (const byte of data) {
      const hi = (byte >> 4) & 0xf;
      const lo = byte & 0xf;
      expect([0x0, 0xf]).toContain(hi);
      expect([0x0, 0xf]).toContain(lo);
    }
  });

  it('repeated calls return the cached instance', () => {
    expect(renderBrandingImage()).toBe(renderBrandingImage());
    expect(renderCheckBrandingImage()).toBe(renderCheckBrandingImage());
  });
});
