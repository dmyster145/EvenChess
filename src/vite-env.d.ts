/// <reference types="vite/client" />

declare module "upng-js" {
  /** Encode RGBA or indexed image data as PNG. */
  function encode(
    imgs: ArrayBuffer[],
    w: number,
    h: number,
    /** Color count for indexed mode (e.g. 4 for 2-bit). 0 = lossless RGBA. */
    cnum: number,
    dels?: number[],
    forbidPlte?: boolean
  ): ArrayBuffer;

  /** Decode PNG file bytes into image frames. */
  function decode(buffer: ArrayBuffer): {
    width: number;
    height: number;
    depth: number;
    ctype: number;
    frames: Array<{ rect: { x: number; y: number; width: number; height: number }; delay: number; dispose: number; blend: number }>;
    tabs: Record<string, unknown>;
    data: Uint8Array;
  };

  /** Convert decoded PNG to flat RGBA8 buffer. */
  function toRGBA8(img: ReturnType<typeof decode>): ArrayBuffer[];
}
