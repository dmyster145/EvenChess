/**
 * Shared BMP format constants for 1-bit monochrome bitmap encoding.
 *
 * Used by both board renderer and branding renderer.
 */

// ── BMP File Format Constants ─────────────────────────────────────────────

/** BMP file signature bytes ('BM'). */
export const BMP_SIGNATURE = [0x42, 0x4d] as const;

/** BMP file header size (14 bytes). */
export const BMP_FILE_HEADER_SIZE = 14;

/** DIB header size (BITMAPINFOHEADER = 40 bytes). */
export const BMP_DIB_HEADER_SIZE = 40;

/** Color table size for 1-bit BMP (2 colors × 4 bytes each = 8 bytes). */
export const BMP_COLOR_TABLE_SIZE = 8;

/** Total header size (file header + DIB header + color table). */
export const BMP_HEADER_SIZE = BMP_FILE_HEADER_SIZE + BMP_DIB_HEADER_SIZE + BMP_COLOR_TABLE_SIZE; // 62 bytes

/** Pixels per meter for standard screen resolution (72 DPI ≈ 2835 PPM). */
export const BMP_PPM = 2835;

/** Number of colors in 1-bit palette. */
export const BMP_COLORS_USED = 2;

// ── Helper Functions ──────────────────────────────────────────────────────

/**
 * Calculate the number of bytes per row for a given width.
 * Each pixel is 1 bit, so we need width/8 bytes (rounded up).
 */
export function getBmpRowBytes(width: number): number {
  return Math.ceil(width / 8);
}

/**
 * Calculate the padded row stride (rows must be 4-byte aligned in BMP).
 */
export function getBmpRowStride(width: number): number {
  const rowBytes = getBmpRowBytes(width);
  return Math.ceil(rowBytes / 4) * 4;
}

/**
 * Calculate total pixel data size for a BMP image.
 */
export function getBmpPixelDataSize(width: number, height: number): number {
  return getBmpRowStride(width) * height;
}

/**
 * Calculate total BMP file size.
 */
export function getBmpFileSize(width: number, height: number): number {
  return BMP_HEADER_SIZE + getBmpPixelDataSize(width, height);
}

/**
 * Write a complete 1-bit BMP header (file header, BITMAPINFOHEADER and 2-color palette) for a
 * bottom-up image of the given size. Palette index 0 is black; index 1 is `onColor` (0xRRGGBB).
 */
export function writeMonoBmpHeader(bmp: Uint8Array, width: number, height: number, onColor: number): void {
  const view = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength);
  const fileSize = getBmpFileSize(width, height);
  view.setUint8(0, BMP_SIGNATURE[0]); view.setUint8(1, BMP_SIGNATURE[1]);
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true);
  view.setUint32(10, BMP_HEADER_SIZE, true);
  view.setUint32(14, BMP_DIB_HEADER_SIZE, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 1, true); // bits per pixel
  view.setUint32(30, 0, true); // no compression
  view.setUint32(34, getBmpPixelDataSize(width, height), true);
  view.setUint32(38, BMP_PPM, true);
  view.setUint32(42, BMP_PPM, true);
  view.setUint32(46, BMP_COLORS_USED, true);
  view.setUint32(50, BMP_COLORS_USED, true);
  view.setUint32(54, 0x00000000, true);
  view.setUint32(58, onColor & 0xffffff, true); // stored as B, G, R, 0
}
