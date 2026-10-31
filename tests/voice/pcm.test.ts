import { describe, it, expect } from 'vitest';
import { payloadToInt16, int16ToFloat32, payloadToFloat32, meanAbsAmplitude } from '../../src/voice/pcm';

// Little-endian samples: 0, 1, -1, 32767, -32768
const i16 = new Int16Array([0, 1, -1, 32767, -32768]);
const bytes = new Uint8Array(i16.buffer.slice(0));

describe('pcm', () => {
  it('reads little-endian Int16 from a Uint8Array', () => {
    expect(Array.from(payloadToInt16(bytes))).toEqual([0, 1, -1, 32767, -32768]);
  });

  it('reads Int16 from a number[] of byte values (JSON-bridged form)', () => {
    expect(Array.from(payloadToInt16(Array.from(bytes)))).toEqual([0, 1, -1, 32767, -32768]);
  });

  it('reads Int16 from a base64 string', () => {
    const b64 = btoa(String.fromCharCode(...bytes));
    expect(Array.from(payloadToInt16(b64))).toEqual([0, 1, -1, 32767, -32768]);
  });

  it('reads Int16 from an ArrayBuffer', () => {
    expect(Array.from(payloadToInt16(bytes.buffer.slice(0)))).toEqual([0, 1, -1, 32767, -32768]);
  });

  it('reads only the viewed bytes of a Uint8Array that starts partway into its buffer', () => {
    // 3 junk bytes, then the samples: an odd byteOffset, so the view must honour it.
    const backing = new Uint8Array(3 + bytes.length + 2).fill(0x7f);
    backing.set(bytes, 3);
    const view = backing.subarray(3, 3 + bytes.length);
    expect(Array.from(payloadToInt16(view))).toEqual([0, 1, -1, 32767, -32768]);
  });

  it('drops a trailing odd byte instead of throwing', () => {
    expect(Array.from(payloadToInt16(new Uint8Array([1, 0, 2])))).toEqual([1]);
  });

  // Positive samples scale by 1/32767 and negative by 1/32768, so both extremes map to exactly ±1.
  const EXPECTED_FLOATS = [0, 1 / 32767, -1 / 32768, 1, -1];

  it('normalizes Int16 to Float32 within [-1, 1]', () => {
    const f = Array.from(int16ToFloat32(i16));
    f.forEach((s, i) => expect(s).toBeCloseTo(EXPECTED_FLOATS[i]!, 9));
    expect(f[3]).toBe(1);
    expect(f[4]).toBe(-1);
  });

  it('payloadToFloat32 decodes bytes and normalizes them in one step', () => {
    const f = Array.from(payloadToFloat32(bytes));
    expect(f).toHaveLength(5);
    f.forEach((s, i) => expect(s).toBeCloseTo(EXPECTED_FLOATS[i]!, 9));
  });

  it('meanAbsAmplitude is 0 for silence and >0 for signal', () => {
    expect(meanAbsAmplitude(new Float32Array(0))).toBe(0);
    expect(meanAbsAmplitude(new Float32Array([0, 0, 0]))).toBe(0);
    expect(meanAbsAmplitude(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5, 5);
  });
});
