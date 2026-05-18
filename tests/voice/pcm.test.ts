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
    const b64 = Buffer.from(bytes).toString('base64');
    expect(Array.from(payloadToInt16(b64))).toEqual([0, 1, -1, 32767, -32768]);
  });

  it('drops a trailing odd byte instead of throwing', () => {
    expect(Array.from(payloadToInt16(new Uint8Array([1, 0, 2])))).toEqual([1]);
  });

  it('normalizes Int16 to Float32 within [-1, 1]', () => {
    const f = int16ToFloat32(i16);
    expect(f[0]).toBe(0);
    expect(f[3]).toBeCloseTo(1, 5);
    expect(f[4]).toBeCloseTo(-1, 5);
    for (const s of f) expect(Math.abs(s)).toBeLessThanOrEqual(1);
  });

  it('payloadToFloat32 composes both steps', () => {
    expect(payloadToFloat32(bytes).length).toBe(5);
  });

  it('meanAbsAmplitude is 0 for silence and >0 for signal', () => {
    expect(meanAbsAmplitude(new Float32Array(0))).toBe(0);
    expect(meanAbsAmplitude(new Float32Array([0, 0, 0]))).toBe(0);
    expect(meanAbsAmplitude(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5, 5);
  });
});
