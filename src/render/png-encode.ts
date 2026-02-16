/**
 * Encode 1-bit monochrome pixels to PNG via canvas.
 * Used for smaller BLE payloads (PNG compresses better than raw BMP for sparse art).
 * Falls back to empty buffer in non-browser (tests).
 * Reuses four canvases (slots 0–3) so refill can encode next+prev in parallel.
 */

const REUSED_CANVAS_COUNT = 4;
const reusedCanvases: (HTMLCanvasElement | null)[] = new Array(REUSED_CANVAS_COUNT).fill(null);
const reusedImageData: (ImageData | null)[] = new Array(REUSED_CANVAS_COUNT).fill(null);
const reusedImageDataDims: { w: number; h: number }[] = new Array(REUSED_CANVAS_COUNT).fill(null).map(() => ({ w: 0, h: 0 }));

/** 1-bit pixels (0 or 1), row-major, width*height. Returns PNG file bytes. slot 0–3 for parallel use. */
export function encodePixelsToPng(
  pixels: Uint8Array,
  width: number,
  height: number,
  slot: number = 0
): Promise<Uint8Array> {
  if (typeof document === 'undefined') {
    return Promise.resolve(new Uint8Array(0));
  }
  const s = slot % REUSED_CANVAS_COUNT;
  let canvas = reusedCanvases[s];
  if (!canvas) {
    canvas = document.createElement('canvas');
    reusedCanvases[s] = canvas;
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(new Uint8Array(0));

  const dims = reusedImageDataDims[s];
  let imageData = reusedImageData[s];
  if (!imageData || !dims || dims.w !== width || dims.h !== height) {
    imageData = ctx.createImageData(width, height);
    reusedImageData[s] = imageData;
    reusedImageDataDims[s] = { w: width, h: height };
  }
  for (let i = 0; i < width * height; i++) {
    const v = pixels[i] ? 255 : 0;
    imageData!.data[i * 4] = v;
    imageData!.data[i * 4 + 1] = v;
    imageData!.data[i * 4 + 2] = v;
    imageData!.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imageData!, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('toBlob failed'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      },
      'image/png'
    );
  });
}
