/**
 * Board renderer — renders chess board as two stacked 200x100 images.
 * Base board cached (rebuilt on FEN change); highlight-based dirty tracking.
 */

import type { GameState } from '../state/contracts';
import type { ChessService } from '../chess/chessservice';
import { getSelectedPiece, getSelectedMove } from '../state/selectors';
import { ImageRawDataUpdate } from '@evenrealities/even_hub_sdk';
import {
  CONTAINER_ID_IMAGE_TOP,
  CONTAINER_ID_IMAGE_BOTTOM,
  CONTAINER_NAME_IMAGE_TOP,
  CONTAINER_NAME_IMAGE_BOTTOM,
  IMAGE_WIDTH,
  IMAGE_HEIGHT,
} from './composer';
import { PIECE_SILHOUETTES, PIECE_SIZE } from './pieces';
import {
  BMP_HEADER_SIZE,
  BMP_SIGNATURE,
  BMP_DIB_HEADER_SIZE,
  BMP_PPM,
  BMP_COLORS_USED,
  getBmpRowStride,
  getBmpPixelDataSize,
  getBmpFileSize,
} from './bmp-constants';
import { squareToDisplayCoords } from '../chess/square-utils';
import { encodePixelsToPng } from './png-encode';

const BUF_W = IMAGE_WIDTH;
const BUF_H = IMAGE_HEIGHT * 2;
const CELL = 23;
const GRID_SIZE = CELL * 8;
const LABEL_PAD = 10;
const BORDER_L = LABEL_PAD;
const GRID_X = LABEL_PAD + 1;
const BORDER_T = 2;
const GRID_Y = BORDER_T + 1;
const BORDER_R = GRID_X + GRID_SIZE;
const BORDER_B = GRID_Y + GRID_SIZE;
const LABEL_Y = BORDER_B + 5;
const SPLIT_Y = IMAGE_HEIGHT;

function hlKey(file: number, rank: number, style: string): string {
  return `${file},${rank},${style}`;
}

function rankToHalf(rank: number): 'top' | 'bottom' {
  return cellY(rank) + CELL <= SPLIT_Y ? 'top' : 'bottom';
}

const BMP_ROW_STRIDE = getBmpRowStride(IMAGE_WIDTH);
const BMP_PIXEL_DATA_SIZE = getBmpPixelDataSize(IMAGE_WIDTH, IMAGE_HEIGHT);
const BMP_FILE_SIZE = getBmpFileSize(IMAGE_WIDTH, IMAGE_HEIGHT);

function initBmpBuffer(): Uint8Array {
  const buf = new ArrayBuffer(BMP_FILE_SIZE);
  const view = new DataView(buf);
  const data = new Uint8Array(buf);

  view.setUint8(0, BMP_SIGNATURE[0]); view.setUint8(1, BMP_SIGNATURE[1]);
  view.setUint32(2, BMP_FILE_SIZE, true);
  view.setUint32(6, 0, true);
  view.setUint32(10, BMP_HEADER_SIZE, true);
  view.setUint32(14, BMP_DIB_HEADER_SIZE, true);
  view.setInt32(18, IMAGE_WIDTH, true);
  view.setInt32(22, IMAGE_HEIGHT, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 1, true);
  view.setUint32(30, 0, true);
  view.setUint32(34, BMP_PIXEL_DATA_SIZE, true);
  view.setUint32(38, BMP_PPM, true);
  view.setUint32(42, BMP_PPM, true);
  view.setUint32(46, BMP_COLORS_USED, true);
  view.setUint32(50, BMP_COLORS_USED, true);
  view.setUint32(54, 0x00000000, true);
  view.setUint32(58, 0x00ffffff, true);

  return data;
}

/** BMP encodes pixels bottom-up; this writes pixel data into preallocated buffer. */
function encodeBmpPixels(bmpBuffer: Uint8Array, pixels: Uint8Array): void {
  bmpBuffer.fill(0, BMP_HEADER_SIZE);

  for (let y = 0; y < IMAGE_HEIGHT; y++) {
    const srcRow = IMAGE_HEIGHT - 1 - y;
    const dstOffset = BMP_HEADER_SIZE + y * BMP_ROW_STRIDE;
    for (let x = 0; x < IMAGE_WIDTH; x++) {
      if (pixels[srcRow * IMAGE_WIDTH + x]) {
        const byteIdx = dstOffset + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        bmpBuffer[byteIdx]! |= 1 << bitIdx;
      }
    }
  }
}

export class BoardRenderer {
  private basePixels: Uint8Array = new Uint8Array(BUF_W * BUF_H);
  private workPixels: Uint8Array = new Uint8Array(BUF_W * BUF_H);
  private lastFen = '';
  private lastShowBoardMarkers = true;
  private prevHighlightKeys = new Set<string>();
  private currentHighlightKeys = new Set<string>();
  private cachedTopBmp: Uint8Array = initBmpBuffer();
  private cachedBottomBmp: Uint8Array = initBmpBuffer();
  private drillBasePixels: Uint8Array | null = null;

  /** Returns only the image halves that changed (highlight-based dirty tracking). */
  render(state: GameState, chess: ChessService): ImageRawDataUpdate[] {
    const fen = state.fen;
    const showBoardMarkers = state.showBoardMarkers;
    const fenChanged = fen !== this.lastFen;
    const markersChanged = showBoardMarkers !== this.lastShowBoardMarkers;

    if (fenChanged || markersChanged) {
      this.rebuildBase(chess, showBoardMarkers);
      this.lastFen = fen;
      this.lastShowBoardMarkers = showBoardMarkers;
    }

    const highlights = getHighlights(state);
    this.currentHighlightKeys.clear();
    for (const h of highlights) this.currentHighlightKeys.add(hlKey(h.file, h.rank, h.style));

    // Fast path: highlight-only changes use dirty tracking
    if (!fenChanged && !markersChanged) {
      let topDirty = false;
      let bottomDirty = false;

      const allKeys = new Set([...this.prevHighlightKeys, ...this.currentHighlightKeys]);
      for (const key of allKeys) {
        if (this.prevHighlightKeys.has(key) !== this.currentHighlightKeys.has(key)) {
          const rank = parseInt(key.split(',')[1]!, 10);
          if (rankToHalf(rank) === 'top') topDirty = true;
          else bottomDirty = true;
        }
      }

      if (!topDirty && !bottomDirty) return [];

      // Refresh each dirty half from base + current highlights so we never encode stale highlights
      // (e.g. after using cached images, workPixels was never updated).
      if (topDirty) {
        this.workPixels.subarray(0, BUF_W * IMAGE_HEIGHT).set(this.basePixels.subarray(0, BUF_W * IMAGE_HEIGHT));
        for (const hl of highlights) {
          if (rankToHalf(hl.rank) === 'top') highlightCell(this.workPixels, hl.file, hl.rank, hl.style);
        }
      }
      if (bottomDirty) {
        this.workPixels.subarray(BUF_W * IMAGE_HEIGHT).set(this.basePixels.subarray(BUF_W * IMAGE_HEIGHT));
        for (const hl of highlights) {
          if (rankToHalf(hl.rank) === 'bottom') highlightCell(this.workPixels, hl.file, hl.rank, hl.style);
        }
      }
      const tmp = this.prevHighlightKeys;
      this.prevHighlightKeys = this.currentHighlightKeys;
      this.currentHighlightKeys = tmp;

      const dirty: ImageRawDataUpdate[] = [];
      if (topDirty) {
        encodeBmpPixels(this.cachedTopBmp, this.workPixels.subarray(0, BUF_W * IMAGE_HEIGHT));
        dirty.push(new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_TOP, containerName: CONTAINER_NAME_IMAGE_TOP, imageData: this.cachedTopBmp.slice() }));
      }
      if (bottomDirty) {
        encodeBmpPixels(this.cachedBottomBmp, this.workPixels.subarray(BUF_W * IMAGE_HEIGHT));
        dirty.push(new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_BOTTOM, containerName: CONTAINER_NAME_IMAGE_BOTTOM, imageData: this.cachedBottomBmp.slice() }));
      }
      return dirty;
    }

    // FEN changed: encode both halves (piece moved)
    const tmp = this.prevHighlightKeys;
    this.prevHighlightKeys = this.currentHighlightKeys;
    this.currentHighlightKeys = tmp;
    this.workPixels.set(this.basePixels);
    for (const hl of highlights) highlightCell(this.workPixels, hl.file, hl.rank, hl.style);

    encodeBmpPixels(this.cachedTopBmp, this.workPixels.subarray(0, BUF_W * IMAGE_HEIGHT));
    encodeBmpPixels(this.cachedBottomBmp, this.workPixels.subarray(BUF_W * IMAGE_HEIGHT));

    return [
      new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_TOP, containerName: CONTAINER_NAME_IMAGE_TOP, imageData: this.cachedTopBmp.slice() }),
      new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_BOTTOM, containerName: CONTAINER_NAME_IMAGE_BOTTOM, imageData: this.cachedBottomBmp.slice() }),
    ];
  }

  renderFull(state: GameState, chess: ChessService): ImageRawDataUpdate[] {
    this.cachedTopBmp = initBmpBuffer();
    this.cachedBottomBmp = initBmpBuffer();
    this.prevHighlightKeys.clear();
    this.currentHighlightKeys.clear();
    this.lastFen = '';
    return this.render(state, chess);
  }

  /**
   * Sync internal highlight state to a state we displayed via cache.
   * Call after sending cached images so the next render() has correct dirty detection.
   */
  setStateForCache(state: GameState): void {
    const highlights = getHighlights(state);
    this.currentHighlightKeys.clear();
    for (const h of highlights) this.currentHighlightKeys.add(hlKey(h.file, h.rank, h.style));
    const tmp = this.prevHighlightKeys;
    this.prevHighlightKeys = this.currentHighlightKeys;
    this.currentHighlightKeys = tmp;
  }

  /**
   * Same as render() but encodes dirty halves as PNG for smaller BLE payload.
   * Returns [] in non-browser or if canvas fails (caller can fall back to render()).
   * slotBase 0 = main flush (uses canvas slots 0,1); slotBase 2 = refill (uses 2,3) for parallel next+prev.
   */
  async renderPngAsync(state: GameState, chess: ChessService, slotBase: 0 | 2 = 0): Promise<ImageRawDataUpdate[]> {
    const fen = state.fen;
    const showBoardMarkers = state.showBoardMarkers;
    const fenChanged = fen !== this.lastFen;
    const markersChanged = showBoardMarkers !== this.lastShowBoardMarkers;

    if (fenChanged || markersChanged) {
      this.rebuildBase(chess, showBoardMarkers);
      this.lastFen = fen;
      this.lastShowBoardMarkers = showBoardMarkers;
    }

    const highlights = getHighlights(state);
    this.currentHighlightKeys.clear();
    for (const h of highlights) this.currentHighlightKeys.add(hlKey(h.file, h.rank, h.style));

    if (!fenChanged && !markersChanged) {
      let topDirty = false;
      let bottomDirty = false;
      const allKeys = new Set([...this.prevHighlightKeys, ...this.currentHighlightKeys]);
      for (const key of allKeys) {
        if (this.prevHighlightKeys.has(key) !== this.currentHighlightKeys.has(key)) {
          const rank = parseInt(key.split(',')[1]!, 10);
          if (rankToHalf(rank) === 'top') topDirty = true;
          else bottomDirty = true;
        }
      }
      if (!topDirty && !bottomDirty) return [];

      // Refresh each dirty half from base + current highlights so we never encode stale highlights.
      if (topDirty) {
        this.workPixels.subarray(0, BUF_W * IMAGE_HEIGHT).set(this.basePixels.subarray(0, BUF_W * IMAGE_HEIGHT));
        for (const hl of highlights) {
          if (rankToHalf(hl.rank) === 'top') highlightCell(this.workPixels, hl.file, hl.rank, hl.style);
        }
      }
      if (bottomDirty) {
        this.workPixels.subarray(BUF_W * IMAGE_HEIGHT).set(this.basePixels.subarray(BUF_W * IMAGE_HEIGHT));
        for (const hl of highlights) {
          if (rankToHalf(hl.rank) === 'bottom') highlightCell(this.workPixels, hl.file, hl.rank, hl.style);
        }
      }
      const tmp = this.prevHighlightKeys;
      this.prevHighlightKeys = this.currentHighlightKeys;
      this.currentHighlightKeys = tmp;

      const topPixels = this.workPixels.subarray(0, BUF_W * IMAGE_HEIGHT);
      const bottomPixels = this.workPixels.subarray(BUF_W * IMAGE_HEIGHT);
      const [topPng, bottomPng] = await Promise.all([
        topDirty ? encodePixelsToPng(topPixels, IMAGE_WIDTH, IMAGE_HEIGHT, slotBase) : Promise.resolve(new Uint8Array(0)),
        bottomDirty ? encodePixelsToPng(bottomPixels, IMAGE_WIDTH, IMAGE_HEIGHT, slotBase + 1) : Promise.resolve(new Uint8Array(0)),
      ]);
      const dirty: ImageRawDataUpdate[] = [];
      if (topDirty && topPng.length > 0) dirty.push(new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_TOP, containerName: CONTAINER_NAME_IMAGE_TOP, imageData: topPng.slice() }));
      if (bottomDirty && bottomPng.length > 0) dirty.push(new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_BOTTOM, containerName: CONTAINER_NAME_IMAGE_BOTTOM, imageData: bottomPng.slice() }));
      if (dirty.length === 0) return this.render(state, chess);
      return dirty;
    }

    const tmpKeys = this.prevHighlightKeys;
    this.prevHighlightKeys = this.currentHighlightKeys;
    this.currentHighlightKeys = tmpKeys;
    this.workPixels.set(this.basePixels);
    for (const hl of highlights) highlightCell(this.workPixels, hl.file, hl.rank, hl.style);

    const [topPng, bottomPng] = await Promise.all([
      encodePixelsToPng(this.workPixels.subarray(0, BUF_W * IMAGE_HEIGHT), IMAGE_WIDTH, IMAGE_HEIGHT, slotBase),
      encodePixelsToPng(this.workPixels.subarray(BUF_W * IMAGE_HEIGHT), IMAGE_WIDTH, IMAGE_HEIGHT, slotBase + 1),
    ]);
    if (topPng.length === 0 || bottomPng.length === 0) return this.render(state, chess);
    return [
      new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_TOP, containerName: CONTAINER_NAME_IMAGE_TOP, imageData: topPng.slice() }),
      new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_BOTTOM, containerName: CONTAINER_NAME_IMAGE_BOTTOM, imageData: bottomPng.slice() }),
    ];
  }

  private rebuildBase(chess: ChessService, showBoardMarkers: boolean = true): void {
    const pixels = this.basePixels;
    pixels.fill(0);

    for (let y = GRID_Y; y < GRID_Y + GRID_SIZE; y++) {
      for (let x = GRID_X; x < GRID_X + GRID_SIZE; x++) {
        setPixel(pixels, x, y, 1);
      }
    }

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        if ((rank + file) % 2 === 1) {
          fillCell(pixels, file, rank, 0);
        }
      }
    }

    drawBorder(pixels);
    if (showBoardMarkers) {
      drawFileLabels(pixels);
      drawRankLabels(pixels);
    }

    const board = chess.getBoard();
    for (let rank = 0; rank < 8; rank++) {
      const row = board[rank];
      if (!row) continue;
      for (let file = 0; file < 8; file++) {
        const piece = row[file];
        if (piece) {
          drawPiece(pixels, file, rank, piece.color, piece.type);
        }
      }
    }
  }

  /** Fill a pixel buffer with the empty coordinate-drill grid (no highlight). */
  private fillDrillBase(pixels: Uint8Array): void {
    pixels.fill(0);
    for (let y = GRID_Y; y < GRID_Y + GRID_SIZE; y++) {
      for (let x = GRID_X; x < GRID_X + GRID_SIZE; x++) {
        setPixel(pixels, x, y, 1);
      }
    }
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        if ((rank + file) % 2 === 1) {
          fillCell(pixels, file, rank, 0);
        }
      }
    }
    drawBorder(pixels);
  }

  /** Render empty board for drill mode (no pieces, no labels). Uses cached base; always returns both halves for full board updates. */
  renderDrillBoard(cursorFile: number, cursorRank: number): ImageRawDataUpdate[] {
    if (!this.drillBasePixels) {
      this.drillBasePixels = new Uint8Array(BUF_W * BUF_H);
      this.fillDrillBase(this.drillBasePixels);
    }

    this.workPixels.set(this.drillBasePixels);
    const displayRank = 7 - cursorRank;
    highlightCell(this.workPixels, cursorFile, displayRank, 'selected');

    // Always return both halves for the coordinate drill so the device never shows a half-stale board
    // (one panel with old highlight, one with new). Cache and live updates both send full board.
    const topDirty = true;
    const bottomDirty = true;

    const dirty: ImageRawDataUpdate[] = [];
    if (topDirty) {
      encodeBmpPixels(this.cachedTopBmp, this.workPixels.subarray(0, BUF_W * IMAGE_HEIGHT));
      dirty.push(new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_TOP, containerName: CONTAINER_NAME_IMAGE_TOP, imageData: this.cachedTopBmp.slice() }));
    }
    if (bottomDirty) {
      encodeBmpPixels(this.cachedBottomBmp, this.workPixels.subarray(BUF_W * IMAGE_HEIGHT));
      dirty.push(new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_BOTTOM, containerName: CONTAINER_NAME_IMAGE_BOTTOM, imageData: this.cachedBottomBmp.slice() }));
    }
    return dirty;
  }

  renderKnightPathBoard(
    knightFile: number,
    knightRank: number,
    targetFile: number,
    targetRank: number,
    highlightFile: number,
    highlightRank: number,
  ): ImageRawDataUpdate[] {
    const pixels = this.workPixels;
    pixels.fill(0);

    for (let y = GRID_Y; y < GRID_Y + GRID_SIZE; y++) {
      for (let x = GRID_X; x < GRID_X + GRID_SIZE; x++) {
        setPixel(pixels, x, y, 1);
      }
    }

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        if ((rank + file) % 2 === 1) {
          fillCell(pixels, file, rank, 0);
        }
      }
    }

    drawBorder(pixels);

    // Convert rank indices to display coords (rank 1 at bottom = display row 7)
    const knightDisplayRank = 7 - knightRank;
    const targetDisplayRank = 7 - targetRank;
    const highlightDisplayRank = 7 - highlightRank;

    highlightCell(pixels, targetFile, targetDisplayRank, 'destination');
    drawPiece(pixels, knightFile, knightDisplayRank, 'w', 'n');

    if (highlightFile !== knightFile || highlightRank !== knightRank) {
      highlightCell(pixels, highlightFile, highlightDisplayRank, 'selected');
    }

    encodeBmpPixels(this.cachedTopBmp, pixels.subarray(0, BUF_W * IMAGE_HEIGHT));
    encodeBmpPixels(this.cachedBottomBmp, pixels.subarray(BUF_W * IMAGE_HEIGHT));

    return [
      new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_TOP, containerName: CONTAINER_NAME_IMAGE_TOP, imageData: this.cachedTopBmp.slice() }),
      new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_BOTTOM, containerName: CONTAINER_NAME_IMAGE_BOTTOM, imageData: this.cachedBottomBmp.slice() }),
    ];
  }

  renderFromFen(fen: string): ImageRawDataUpdate[] {
    const pixels = this.workPixels;
    pixels.fill(0);

    for (let y = GRID_Y; y < GRID_Y + GRID_SIZE; y++) {
      for (let x = GRID_X; x < GRID_X + GRID_SIZE; x++) {
        setPixel(pixels, x, y, 1);
      }
    }

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        if ((rank + file) % 2 === 1) {
          fillCell(pixels, file, rank, 0);
        }
      }
    }

    drawBorder(pixels);

    const fenParts = fen.split(' ');
    const position = fenParts[0] ?? '';
    const rows = position.split('/');

    for (let fenRank = 0; fenRank < 8; fenRank++) {
      const row = rows[fenRank] ?? '';
      let file = 0;

      for (const char of row) {
        if (file >= 8) break;

        const digit = parseInt(char, 10);
        if (!isNaN(digit)) {
          file += digit;
        } else {
          const color = char === char.toUpperCase() ? 'w' : 'b';
          const pieceType = char.toLowerCase();
          drawPiece(pixels, file, fenRank, color, pieceType);
          file++;
        }
      }
    }

    encodeBmpPixels(this.cachedTopBmp, pixels.subarray(0, BUF_W * IMAGE_HEIGHT));
    encodeBmpPixels(this.cachedBottomBmp, pixels.subarray(BUF_W * IMAGE_HEIGHT));

    return [
      new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_TOP, containerName: CONTAINER_NAME_IMAGE_TOP, imageData: this.cachedTopBmp.slice() }),
      new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_BOTTOM, containerName: CONTAINER_NAME_IMAGE_BOTTOM, imageData: this.cachedBottomBmp.slice() }),
    ];
  }
}

export interface BoardImages {
  top: ImageRawDataUpdate;
  bottom: ImageRawDataUpdate;
}

export function renderBoardImages(state: GameState, chess: ChessService): BoardImages {
  const renderer = new BoardRenderer();
  const all = renderer.renderFull(state, chess);
  return { top: all[0]!, bottom: all[1]! };
}

export function renderBoardImage(state: GameState, chess: ChessService): ImageRawDataUpdate {
  return renderBoardImages(state, chess).top;
}

interface Highlight {
  file: number;
  rank: number;
  style: 'selected' | 'destination';
}

export function rankHalf(rank: number): 'top' | 'bottom' {
  return rankToHalf(rank);
}

function getHighlights(state: GameState): Highlight[] {
  const highlights: Highlight[] = [];
  const piece = getSelectedPiece(state);

  switch (state.phase) {
    case 'pieceSelect':
      if (piece) {
        highlights.push({ ...squareToCoords(piece.square), style: 'selected' });
      }
      break;

    case 'destSelect': {
      if (piece) {
        highlights.push({ ...squareToCoords(piece.square), style: 'selected' });
      }
      const move = getSelectedMove(state);
      if (move) {
        highlights.push({ ...squareToCoords(move.to), style: 'destination' });
      }
      break;
    }

    case 'promotionSelect': {
      const pm = state.pendingPromotionMove;
      if (pm) {
        highlights.push({ ...squareToCoords(pm.from), style: 'selected' });
        highlights.push({ ...squareToCoords(pm.to), style: 'destination' });
      }
      break;
    }
  }

  return highlights;
}

function cellX(file: number): number {
  return GRID_X + file * CELL;
}

function cellY(rank: number): number {
  return GRID_Y + rank * CELL;
}

function setPixel(pixels: Uint8Array, x: number, y: number, value: number): void {
  if (x >= 0 && x < BUF_W && y >= 0 && y < BUF_H) {
    pixels[y * BUF_W + x] = value;
  }
}

function fillCell(pixels: Uint8Array, file: number, rank: number, value: number): void {
  const x0 = cellX(file);
  const y0 = cellY(rank);
  for (let dy = 0; dy < CELL; dy++) {
    for (let dx = 0; dx < CELL; dx++) {
      setPixel(pixels, x0 + dx, y0 + dy, value);
    }
  }
}

function highlightCell(
  pixels: Uint8Array,
  file: number,
  rank: number,
  style: 'selected' | 'destination',
): void {
  const x0 = cellX(file);
  const y0 = cellY(rank);

  if (style === 'selected') {
    // Diagonal striped border (3px wide)
    const borderWidth = 3;
    
    for (let t = 0; t < borderWidth; t++) {
      for (let dx = 0; dx < CELL; dx++) {
        const stripe = (dx + t) % 4 < 2 ? 1 : 0;
        setPixel(pixels, x0 + dx, y0 + t, stripe);
      }
      for (let dx = 0; dx < CELL; dx++) {
        const stripe = (dx + t) % 4 < 2 ? 1 : 0;
        setPixel(pixels, x0 + dx, y0 + CELL - 1 - t, stripe);
      }
      for (let dy = 0; dy < CELL; dy++) {
        const stripe = (dy + t) % 4 < 2 ? 1 : 0;
        setPixel(pixels, x0 + t, y0 + dy, stripe);
      }
      for (let dy = 0; dy < CELL; dy++) {
        const stripe = (dy + t) % 4 < 2 ? 1 : 0;
        setPixel(pixels, x0 + CELL - 1 - t, y0 + dy, stripe);
      }
    }
  } else {
    // Destination: outlined X centered in the cell
    const pad = 5;
    const size = CELL - pad * 2;

    // First pass: white outline around the X
    for (let i = 0; i < size; i++) {
      const d1 = i;
      const d2 = size - 1 - i;
      for (let ox = -2; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          if (ox === -1 || ox === 0) continue;
          setPixel(pixels, x0 + pad + d1 + ox, y0 + pad + i + oy, 1);
          setPixel(pixels, x0 + pad + d2 + ox, y0 + pad + i + oy, 1);
        }
      }
      for (let t = -1; t <= 0; t++) {
        setPixel(pixels, x0 + pad + d1 + t, y0 + pad + i - 1, 1);
        setPixel(pixels, x0 + pad + d1 + t, y0 + pad + i + 1, 1);
        setPixel(pixels, x0 + pad + d2 + t, y0 + pad + i - 1, 1);
        setPixel(pixels, x0 + pad + d2 + t, y0 + pad + i + 1, 1);
      }
    }

    // Second pass: black X on top
    for (let i = 0; i < size; i++) {
      const d1 = i;
      const d2 = size - 1 - i;
      for (let t = -1; t <= 0; t++) {
        setPixel(pixels, x0 + pad + d1 + t, y0 + pad + i, 0);
        setPixel(pixels, x0 + pad + d2 + t, y0 + pad + i, 0);
      }
    }
  }
}

function drawBorder(pixels: Uint8Array): void {
  for (let x = BORDER_L; x <= BORDER_R; x++) {
    setPixel(pixels, x, BORDER_T, 1);
    setPixel(pixels, x, BORDER_B, 1);
  }
  for (let y = BORDER_T; y <= BORDER_B; y++) {
    setPixel(pixels, BORDER_L, y, 1);
    setPixel(pixels, BORDER_R, y, 1);
  }
}

function drawFileLabels(pixels: Uint8Array): void {
  const files = 'ABCDEFGH';
  for (let f = 0; f < 8; f++) {
    const lx = cellX(f) + Math.floor(CELL / 2) - 2;
    drawChar(pixels, lx, LABEL_Y, files[f]!);
  }
}

function drawRankLabels(pixels: Uint8Array): void {
  const ranks = '87654321';
  for (let r = 0; r < 8; r++) {
    const ly = cellY(r) + Math.floor(CELL / 2) - 3;
    drawChar(pixels, 0, ly, ranks[r]!);
  }
}

const FONT: Record<string, number[]> = {
  'A': [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  'B': [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  'C': [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  'D': [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  'E': [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  'F': [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  'G': [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  'H': [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  'K': [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  '!': [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100],
  'e': [0b00000, 0b01110, 0b10001, 0b11111, 0b10000, 0b10001, 0b01110],
  'v': [0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  'n': [0b00000, 0b00000, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001],
  'h': [0b10000, 0b10000, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001],
  's': [0b00000, 0b01110, 0b10000, 0b01110, 0b00001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
};

function drawChar(pixels: Uint8Array, x: number, y: number, ch: string): void {
  const glyph = FONT[ch];
  if (!glyph) return;
  for (let row = 0; row < 7; row++) {
    const bits = glyph[row]!;
    for (let col = 0; col < 5; col++) {
      if (bits & (1 << (4 - col))) {
        setPixel(pixels, x + col, y + row, 1);
      }
    }
  }
}

/** Check if a pixel is on an edge (adjacent to empty space). Used for white piece outlines. */
function isEdgePixel(silhouette: number[], row: number, col: number): boolean {
  const neighbors: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dr, dc] of neighbors) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr < 0 || nr >= PIECE_SIZE || nc < 0 || nc >= PIECE_SIZE) return true;
    const rowBits = silhouette[nr];
    if (rowBits === undefined) return true;
    if (!(rowBits & (1 << (PIECE_SIZE - 1 - nc)))) return true;
  }
  return false;
}

function findBottomRow(silhouette: number[]): number {
  for (let row = PIECE_SIZE - 1; row >= 0; row--) {
    if (silhouette[row] && silhouette[row] !== 0) return row;
  }
  return PIECE_SIZE - 1;
}

function drawPiece(
  pixels: Uint8Array,
  file: number,
  rank: number,
  color: 'w' | 'b',
  type: string,
): void {
  const isDark = (rank + file) % 2 === 1;
  const silhouette = PIECE_SILHOUETTES[type];
  if (!silhouette) return;

  const bottomRow = findBottomRow(silhouette);
  const x0 = cellX(file) + Math.floor((CELL - PIECE_SIZE) / 2);
  const y0 = cellY(rank) + CELL - 4 - bottomRow;

  if (color === 'b') {
    const fillVal = 0;
    if (isDark) {
      // Dark squares: white outline for contrast
      const outlineVal = 1;
      for (let row = -1; row <= PIECE_SIZE; row++) {
        for (let col = -1; col <= PIECE_SIZE; col++) {
          // Skip if this pixel IS part of the silhouette
          const inSilhouette = row >= 0 && row < PIECE_SIZE && col >= 0 && col < PIECE_SIZE &&
            silhouette[row] !== undefined && (silhouette[row]! & (1 << (PIECE_SIZE - 1 - col)));
          if (inSilhouette) continue;
          // Check if any neighbor is part of the silhouette
          let adjacentToSilhouette = false;
          for (let dr = -1; dr <= 1 && !adjacentToSilhouette; dr++) {
            for (let dc = -1; dc <= 1 && !adjacentToSilhouette; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nr = row + dr;
              const nc = col + dc;
              if (nr >= 0 && nr < PIECE_SIZE && nc >= 0 && nc < PIECE_SIZE &&
                  silhouette[nr] !== undefined && (silhouette[nr]! & (1 << (PIECE_SIZE - 1 - nc)))) {
                adjacentToSilhouette = true;
              }
            }
          }
          if (adjacentToSilhouette) {
            setPixel(pixels, x0 + col, y0 + row, outlineVal);
          }
        }
      }
      for (let row = 0; row < PIECE_SIZE; row++) {
        const bits = silhouette[row];
        if (bits === undefined) continue;
        for (let col = 0; col < PIECE_SIZE; col++) {
          if (bits & (1 << (PIECE_SIZE - 1 - col))) {
            setPixel(pixels, x0 + col, y0 + row, fillVal);
          }
        }
      }
    } else {
      // Light squares: black outline extends the piece
      for (let row = -1; row <= PIECE_SIZE; row++) {
        for (let col = -1; col <= PIECE_SIZE; col++) {
          // Skip if this pixel IS part of the silhouette
          const inSilhouette = row >= 0 && row < PIECE_SIZE && col >= 0 && col < PIECE_SIZE &&
            silhouette[row] !== undefined && (silhouette[row]! & (1 << (PIECE_SIZE - 1 - col)));
          if (inSilhouette) continue;
          // Check if any neighbor is part of the silhouette
          let adjacentToSilhouette = false;
          for (let dr = -1; dr <= 1 && !adjacentToSilhouette; dr++) {
            for (let dc = -1; dc <= 1 && !adjacentToSilhouette; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nr = row + dr;
              const nc = col + dc;
              if (nr >= 0 && nr < PIECE_SIZE && nc >= 0 && nc < PIECE_SIZE &&
                  silhouette[nr] !== undefined && (silhouette[nr]! & (1 << (PIECE_SIZE - 1 - nc)))) {
                adjacentToSilhouette = true;
              }
            }
          }
          if (adjacentToSilhouette) {
            setPixel(pixels, x0 + col, y0 + row, fillVal);
          }
        }
      }
      for (let row = 0; row < PIECE_SIZE; row++) {
        const bits = silhouette[row];
        if (bits === undefined) continue;
        for (let col = 0; col < PIECE_SIZE; col++) {
          if (bits & (1 << (PIECE_SIZE - 1 - col))) {
            setPixel(pixels, x0 + col, y0 + row, fillVal);
          }
        }
      }
    }
  } else {
    // White pieces: contrasting outline + stipple interior for visual weight
    const outlineVal = isDark ? 1 : 0;
    const baseVal = isDark ? 0 : 1;
    const stippleVal = isDark ? 1 : 0;
    for (let row = 0; row < PIECE_SIZE; row++) {
      const bits = silhouette[row];
      if (bits === undefined) continue;
      for (let col = 0; col < PIECE_SIZE; col++) {
        if (bits & (1 << (PIECE_SIZE - 1 - col))) {
          const edge = isEdgePixel(silhouette, row, col);
          const thickEdge = edge || isNearEdge(silhouette, row, col, 1);
          if (thickEdge) {
            setPixel(pixels, x0 + col, y0 + row, outlineVal);
          } else {
            const isStipple = (row + col) % 2 === 0;
            setPixel(pixels, x0 + col, y0 + row, isStipple ? stippleVal : baseVal);
          }
        }
      }
    }
  }
}

function isNearEdge(silhouette: number[], row: number, col: number, dist: number): boolean {
  for (let dr = -dist; dr <= dist; dr++) {
    for (let dc = -dist; dc <= dist; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= PIECE_SIZE || nc < 0 || nc >= PIECE_SIZE) return true;
      const rowBits = silhouette[nr];
      if (rowBits === undefined) return true;
      if (!(rowBits & (1 << (PIECE_SIZE - 1 - nc)))) return true;
    }
  }
  return false;
}

function squareToCoords(square: string): { file: number; rank: number } {
  const { file, displayRank } = squareToDisplayCoords(square);
  return { file, rank: displayRank };
}
