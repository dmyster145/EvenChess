/**
 * Audio payload normalization.
 *
 * The SDK types `audioEvent.audioPcm` as `Uint8Array`, but the host-side Uint8List is
 * JSON-bridged and in practice arrives as a `Uint8Array`, a `number[]` of byte values,
 * an `ArrayBuffer`, or a base64 `string` (see SDK index.d.ts comment ~L858). All of
 * them are little-endian signed 16-bit PCM, 16 kHz, mono. Normalize to Float32 [-1,1].
 */

export type AudioPayload = Uint8Array | ArrayBuffer | number[] | string;

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob !== 'function') return new Uint8Array(0);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBytes(payload: AudioPayload): Uint8Array {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (typeof payload === 'string') return base64ToBytes(payload);
  if (Array.isArray(payload)) return Uint8Array.from(payload, (n) => n & 0xff);
  return new Uint8Array(0);
}

/** Reinterpret a byte buffer as little-endian Int16 samples. */
export function payloadToInt16(payload: AudioPayload): Int16Array {
  const bytes = toBytes(payload);
  const usable = bytes.byteLength - (bytes.byteLength % 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, usable);
  const out = new Int16Array(usable / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

export function int16ToFloat32(int16: Int16Array): Float32Array {
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    const s = int16[i]!;
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}

export function payloadToFloat32(payload: AudioPayload): Float32Array {
  return int16ToFloat32(payloadToInt16(payload));
}

/** Mean absolute amplitude (0–1) — used for naive silence/end-of-speech detection. */
export function meanAbsAmplitude(float32: Float32Array): number {
  if (float32.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < float32.length; i++) sum += Math.abs(float32[i]!);
  return sum / float32.length;
}

export const VOICE_SAMPLE_RATE = 16000;
