import { describe, it, expect } from 'vitest';
import {
  encodeUnpackedToGray4,
  encodePackedToGray4,
  gray4ByteLength,
  GRAY4_OFF,
  GRAY4_ON,
} from '../../src/render/gray4';

describe('gray4 encoders', () => {
  it('packs unpacked 1-byte-per-pixel into nibble pairs (high=left)', () => {
    // 4 wide × 2 tall. Row 0: 1,0,1,1. Row 1: 0,1,0,0.
    const src = new Uint8Array([1, 0, 1, 1, 0, 1, 0, 0]);
    const out = encodeUnpackedToGray4(src, 4, 2);
    expect(Array.from(out)).toEqual([0xf0, 0xff, 0x0f, 0x00]);
  });

  it('packs bit-packed MSB-first rows into nibble pairs', () => {
    // 8 pixels, single row, input 0b10110100.
    // Bits MSB-first: 1,0,1,1,0,1,0,0. Expected packing:
    //   (1,0)=0xF0, (1,1)=0xFF, (0,1)=0x0F, (0,0)=0x00
    const src = new Uint8Array([0b10110100]);
    const out = encodePackedToGray4(src, 8, 1);
    expect(Array.from(out)).toEqual([0xf0, 0xff, 0x0f, 0x00]);
  });

  it('produces the correct byte length for production dimensions', () => {
    expect(gray4ByteLength(200, 100)).toBe(10_000);
    expect(gray4ByteLength(200, 24)).toBe(2_400);
    expect(encodeUnpackedToGray4(new Uint8Array(200 * 100), 200, 100).length).toBe(10_000);
    expect(encodePackedToGray4(new Uint8Array(25 * 24), 200, 24).length).toBe(2_400);
  });

  it('rejects odd widths (guards against misuse)', () => {
    expect(() => encodeUnpackedToGray4(new Uint8Array(201), 201, 1)).toThrow(/even/);
    expect(() => encodePackedToGray4(new Uint8Array(26), 201, 1)).toThrow(/even/);
  });

  it('reuses a caller-provided `out` buffer without reallocating', () => {
    const src = new Uint8Array([1, 0]);
    const out = new Uint8Array(1);
    const returned = encodeUnpackedToGray4(src, 2, 1, out);
    expect(returned).toBe(out); // identity — no allocation
    expect(returned[0]).toBe(0xf0);
  });

  it('throws when the out buffer is too small', () => {
    const src = new Uint8Array(4);
    const out = new Uint8Array(1);
    expect(() => encodeUnpackedToGray4(src, 4, 1, out)).toThrow(/too small/);
  });

  it('exposes the expected nibble constants', () => {
    expect(GRAY4_OFF).toBe(0x0);
    expect(GRAY4_ON).toBe(0xf);
  });
});
