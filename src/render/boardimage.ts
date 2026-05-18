/**
 * Board renderer — renders chess board as two stacked 200x100 images.
 * Base board cached (rebuilt on FEN change); highlight-based dirty tracking.
 */

import type { GameState } from '../state/contracts';
import type { ChessService } from '../chess/chessservice';
import { getSelectedPiece, getSelectedMove, getSelectedRow } from '../state/selectors';
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
import { squareToDisplayCoords, rankToDisplayRank } from '../chess/square-utils';
import { encodePixelsToPng } from './png-encode';

const BUF_W = IMAGE_WIDTH;
const BUF_H = IMAGE_HEIGHT * 2;
const HALF_PIXELS = BUF_W * IMAGE_HEIGHT;
const SPLIT_Y = IMAGE_HEIGHT;

// Grid layout — all dimension-dependent constants in one place so two layouts can coexist.
interface GridLayout {
  cell: number;
  gridX: number;
  gridY: number;
  borderL: number;
  borderR: number;
  borderT: number;
  borderB: number;
  labelY: number;
}

function makeLayout(cell: number, labelPad: number): GridLayout {
  const gridX = labelPad > 0 ? labelPad + 1 : 0;
  const gridY = SPLIT_Y - 4 * cell;
  const borderL = labelPad;
  const borderR = Math.min(BUF_W - 1, gridX + cell * 8);
  const borderT = Math.max(0, gridY - 1);
  const borderB = Math.min(BUF_H - 1, gridY + cell * 8);
  const labelY = borderB + 6;
  return { cell, gridX, gridY, borderL, borderR, borderT, borderB, labelY };
}

// Small: CELL=21, LABEL_PAD=10  →  fits in 200×100
const SMALL_LAYOUT: GridLayout = makeLayout(21, 10);
// Large: CELL=25, no label padding  →  board fills full 200×200, markers removed
const LARGE_LAYOUT: GridLayout = makeLayout(25, 0);

function hlKey(file: number, rank: number, style: string): string {
  return `${file},${rank},${style}`;
}

function rankToHalf(rank: number, g: GridLayout): 'top' | 'bottom' {
  return (g.gridY + rank * g.cell + g.cell) <= SPLIT_Y ? 'top' : 'bottom';
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

function getHighlightDirtyHalves(
  prevKeys: Set<string>,
  currentKeys: Set<string>,
  g: GridLayout,
): { topDirty: boolean; bottomDirty: boolean } {
  let topDirty = false;
  let bottomDirty = false;
  const allKeys = new Set([...prevKeys, ...currentKeys]);
  for (const key of allKeys) {
    if (prevKeys.has(key) !== currentKeys.has(key)) {
      const rank = parseInt(key.split(',')[1]!, 10);
      if (rankToHalf(rank, g) === 'top') topDirty = true;
      else bottomDirty = true;
    }
  }
  return { topDirty, bottomDirty };
}

function buffersDiffer(a: Uint8Array, b: Uint8Array, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

function refreshDirtyHalvesFromBase(
  workPixels: Uint8Array,
  basePixels: Uint8Array,
  highlights: Highlight[],
  topDirty: boolean,
  bottomDirty: boolean,
  g: GridLayout,
): void {
  if (topDirty) {
    workPixels.subarray(0, HALF_PIXELS).set(basePixels.subarray(0, HALF_PIXELS));
    for (const hl of highlights) {
      if (rankToHalf(hl.rank, g) === 'top') highlightCell(workPixels, hl.file, hl.rank, hl.style, g);
    }
  }
  if (bottomDirty) {
    workPixels.subarray(HALF_PIXELS).set(basePixels.subarray(HALF_PIXELS));
    for (const hl of highlights) {
      if (rankToHalf(hl.rank, g) === 'bottom') highlightCell(workPixels, hl.file, hl.rank, hl.style, g);
    }
  }
}

export class BoardRenderer {
  // Renderer is stateful by design for speed:
  // - caches rebuilt board base (pieces/labels)
  // - tracks previous highlight keys for dirty-half detection
  // - reuses working pixel buffers/BMP buffers to avoid per-frame allocations
  // Callers must avoid concurrent render* calls on the same instance.
  readonly largeGrid: boolean;
  private readonly g: GridLayout;
  private basePixels: Uint8Array = new Uint8Array(BUF_W * BUF_H);
  private prevBasePixels: Uint8Array = new Uint8Array(BUF_W * BUF_H);
  private workPixels: Uint8Array = new Uint8Array(BUF_W * BUF_H);
  private lastFen = '';
  private lastShowBoardMarkers = true;
  private lastPlayerColor: 'w' | 'b' = 'w';
  private prevHighlightKeys = new Set<string>();
  private currentHighlightKeys = new Set<string>();
  private cachedTopBmp: Uint8Array = initBmpBuffer();
  private cachedBottomBmp: Uint8Array = initBmpBuffer();
  private drillBasePixels: Uint8Array | null = null;

  constructor({ largeGrid = false }: { largeGrid?: boolean } = {}) {
    this.largeGrid = largeGrid;
    this.g = largeGrid ? LARGE_LAYOUT : SMALL_LAYOUT;
  }

  /** Returns only the image halves that changed (highlight-based dirty tracking).
   * When forceBothHalves is true, always returns both halves without re-initing buffers (faster than renderFull for cross-half). */
  render(state: GameState, chess: ChessService, forceBothHalves = false): ImageRawDataUpdate[] {
    const fen = state.fen;
    const showBoardMarkers = this.largeGrid ? false : state.showBoardMarkers;
    const fenChanged = fen !== this.lastFen;
    const markersChanged = showBoardMarkers !== this.lastShowBoardMarkers;
    const playerColorChanged = state.playerColor !== this.lastPlayerColor;
    let baseTopDirty = false;
    let baseBottomDirty = false;

    if (fenChanged || markersChanged || playerColorChanged) {
      this.prevBasePixels.set(this.basePixels);
      this.rebuildBase(chess, showBoardMarkers, state.playerColor);
      this.lastFen = fen;
      this.lastShowBoardMarkers = showBoardMarkers;
      this.lastPlayerColor = state.playerColor;
      if (markersChanged || playerColorChanged) {
        baseTopDirty = true;
        baseBottomDirty = true;
      } else if (fenChanged) {
        baseTopDirty = buffersDiffer(this.prevBasePixels, this.basePixels, 0, HALF_PIXELS);
        baseBottomDirty = buffersDiffer(this.prevBasePixels, this.basePixels, HALF_PIXELS, BUF_W * BUF_H);
      }
    }

    const highlights = getHighlights(state);
    this.currentHighlightKeys.clear();
    for (const h of highlights) this.currentHighlightKeys.add(hlKey(h.file, h.rank, h.style));
    const highlightDirty = getHighlightDirtyHalves(this.prevHighlightKeys, this.currentHighlightKeys, this.g);

    // Fast path: highlight-only changes use dirty tracking (skip when caller needs both halves)
    if (!fenChanged && !markersChanged && !playerColorChanged && !forceBothHalves) {
      const topDirty = highlightDirty.topDirty;
      const bottomDirty = highlightDirty.bottomDirty;

      if (!topDirty && !bottomDirty) return [];

      // Refresh each dirty half from base + current highlights so we never encode stale highlights
      // (e.g. after using cached images, workPixels was never updated).
      refreshDirtyHalvesFromBase(this.workPixels, this.basePixels, highlights, topDirty, bottomDirty, this.g);
      const tmp = this.prevHighlightKeys;
      this.prevHighlightKeys = this.currentHighlightKeys;
      this.currentHighlightKeys = tmp;

      const dirty: ImageRawDataUpdate[] = [];
      if (topDirty) {
        encodeBmpPixels(this.cachedTopBmp, this.workPixels.subarray(0, HALF_PIXELS));
        dirty.push(new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_TOP, containerName: CONTAINER_NAME_IMAGE_TOP, imageData: this.cachedTopBmp.slice() }));
      }
      if (bottomDirty) {
        encodeBmpPixels(this.cachedBottomBmp, this.workPixels.subarray(HALF_PIXELS));
        dirty.push(new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_BOTTOM, containerName: CONTAINER_NAME_IMAGE_BOTTOM, imageData: this.cachedBottomBmp.slice() }));
      }
      return dirty;
    }

    // FEN/markers/perspective changed or caller forced both halves: encode dirty halves.
    const topDirty = forceBothHalves || markersChanged || playerColorChanged || baseTopDirty || highlightDirty.topDirty;
    const bottomDirty = forceBothHalves || markersChanged || playerColorChanged || baseBottomDirty || highlightDirty.bottomDirty;
    if (!topDirty && !bottomDirty) return [];

    const tmp = this.prevHighlightKeys;
    this.prevHighlightKeys = this.currentHighlightKeys;
    this.currentHighlightKeys = tmp;
    refreshDirtyHalvesFromBase(this.workPixels, this.basePixels, highlights, topDirty, bottomDirty, this.g);

    const dirty: ImageRawDataUpdate[] = [];
    if (topDirty) {
      encodeBmpPixels(this.cachedTopBmp, this.workPixels.subarray(0, HALF_PIXELS));
      dirty.push(new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_TOP, containerName: CONTAINER_NAME_IMAGE_TOP, imageData: this.cachedTopBmp.slice() }));
    }
    if (bottomDirty) {
      encodeBmpPixels(this.cachedBottomBmp, this.workPixels.subarray(HALF_PIXELS));
      dirty.push(new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_BOTTOM, containerName: CONTAINER_NAME_IMAGE_BOTTOM, imageData: this.cachedBottomBmp.slice() }));
    }
    return dirty;
  }

  /**
   * Debug-only: the fully composed board pixel buffer (base + highlights) for the
   * current state, exactly as encoded for the glasses. Width = IMAGE_WIDTH, height =
   * IMAGE_HEIGHT*2 (top half rows 0..H-1, bottom half rows H..2H-1). Values are 0/1.
   */
  snapshotPixels(state: GameState, chess: ChessService): { pixels: Uint8Array; width: number; height: number } {
    this.renderFull(state, chess);
    return { pixels: this.workPixels.slice(), width: BUF_W, height: BUF_H };
  }

  renderFull(state: GameState, chess: ChessService): ImageRawDataUpdate[] {
    // Used for startup / mode transitions. Reset dirty-tracking state so both halves are regenerated deterministically.
    // forceBothHalves=true ensures both halves are always returned regardless of whether base pixels or highlights
    // differ from the previous render (e.g. same FEN called twice in startup re-render path).
    this.cachedTopBmp = initBmpBuffer();
    this.cachedBottomBmp = initBmpBuffer();
    this.prevHighlightKeys.clear();
    this.currentHighlightKeys.clear();
    this.lastFen = '';
    return this.render(state, chess, true);
  }


  /**
   * Same as render() but encodes dirty halves as PNG for smaller BLE payload.
   * Returns [] in non-browser or if canvas fails (caller can fall back to render()).
   */
  async renderPngAsync(state: GameState, chess: ChessService, forceBothHalves = false): Promise<ImageRawDataUpdate[]> {
    const fen = state.fen;
    const showBoardMarkers = this.largeGrid ? false : state.showBoardMarkers;
    const fenChanged = fen !== this.lastFen;
    const markersChanged = showBoardMarkers !== this.lastShowBoardMarkers;
    const playerColorChanged = state.playerColor !== this.lastPlayerColor;
    let baseTopDirty = false;
    let baseBottomDirty = false;

    if (fenChanged || markersChanged || playerColorChanged) {
      this.prevBasePixels.set(this.basePixels);
      this.rebuildBase(chess, showBoardMarkers, state.playerColor);
      this.lastFen = fen;
      this.lastShowBoardMarkers = showBoardMarkers;
      this.lastPlayerColor = state.playerColor;
      if (markersChanged || playerColorChanged) {
        baseTopDirty = true;
        baseBottomDirty = true;
      } else if (fenChanged) {
        baseTopDirty = buffersDiffer(this.prevBasePixels, this.basePixels, 0, HALF_PIXELS);
        baseBottomDirty = buffersDiffer(this.prevBasePixels, this.basePixels, HALF_PIXELS, BUF_W * BUF_H);
      }
    }

    const highlights = getHighlights(state);
    this.currentHighlightKeys.clear();
    for (const h of highlights) this.currentHighlightKeys.add(hlKey(h.file, h.rank, h.style));
    const highlightDirty = getHighlightDirtyHalves(this.prevHighlightKeys, this.currentHighlightKeys, this.g);

    if (!fenChanged && !markersChanged && !playerColorChanged && !forceBothHalves) {
      const topDirty = highlightDirty.topDirty;
      const bottomDirty = highlightDirty.bottomDirty;
      if (!topDirty && !bottomDirty) return [];

      // Refresh each dirty half from base + current highlights so we never encode stale highlights.
      refreshDirtyHalvesFromBase(this.workPixels, this.basePixels, highlights, topDirty, bottomDirty, this.g);
      const tmp = this.prevHighlightKeys;
      this.prevHighlightKeys = this.currentHighlightKeys;
      this.currentHighlightKeys = tmp;

      const topPixels = this.workPixels.subarray(0, HALF_PIXELS);
      const bottomPixels = this.workPixels.subarray(HALF_PIXELS);
      // Encode top/bottom in parallel on separate reusable canvas slots to reduce total encode time.
      const [topPng, bottomPng] = await Promise.all([
        topDirty ? encodePixelsToPng(topPixels, IMAGE_WIDTH, IMAGE_HEIGHT, 0) : Promise.resolve(new Uint8Array(0)),
        bottomDirty ? encodePixelsToPng(bottomPixels, IMAGE_WIDTH, IMAGE_HEIGHT, 1) : Promise.resolve(new Uint8Array(0)),
      ]);
      if ((topDirty && topPng.length === 0) || (bottomDirty && bottomPng.length === 0)) {
        return this.render(state, chess, true);
      }
      const dirty: ImageRawDataUpdate[] = [];
      // PNG encoder returns fresh Uint8Arrays; no defensive copy needed before enqueue/send.
      if (topDirty && topPng.length > 0) dirty.push(new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_TOP, containerName: CONTAINER_NAME_IMAGE_TOP, imageData: topPng }));
      if (bottomDirty && bottomPng.length > 0) dirty.push(new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_BOTTOM, containerName: CONTAINER_NAME_IMAGE_BOTTOM, imageData: bottomPng }));
      return dirty;
    }

    const topDirty = forceBothHalves || markersChanged || playerColorChanged || baseTopDirty || highlightDirty.topDirty;
    const bottomDirty = forceBothHalves || markersChanged || playerColorChanged || baseBottomDirty || highlightDirty.bottomDirty;
    if (!topDirty && !bottomDirty) return [];

    const tmpKeys = this.prevHighlightKeys;
    this.prevHighlightKeys = this.currentHighlightKeys;
    this.currentHighlightKeys = tmpKeys;
    refreshDirtyHalvesFromBase(this.workPixels, this.basePixels, highlights, topDirty, bottomDirty, this.g);

    // FEN/marker changes may dirty both halves; parallel PNG encode keeps CPU time small vs transport time.
    const [topPng, bottomPng] = await Promise.all([
      topDirty
        ? encodePixelsToPng(this.workPixels.subarray(0, HALF_PIXELS), IMAGE_WIDTH, IMAGE_HEIGHT, 0)
        : Promise.resolve(new Uint8Array(0)),
      bottomDirty
        ? encodePixelsToPng(this.workPixels.subarray(HALF_PIXELS), IMAGE_WIDTH, IMAGE_HEIGHT, 1)
        : Promise.resolve(new Uint8Array(0)),
    ]);
    if ((topDirty && topPng.length === 0) || (bottomDirty && bottomPng.length === 0)) return this.render(state, chess, true);
    const dirty: ImageRawDataUpdate[] = [];
    if (topDirty && topPng.length > 0) {
      dirty.push(new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_TOP, containerName: CONTAINER_NAME_IMAGE_TOP, imageData: topPng }));
    }
    if (bottomDirty && bottomPng.length > 0) {
      dirty.push(new ImageRawDataUpdate({ containerID: CONTAINER_ID_IMAGE_BOTTOM, containerName: CONTAINER_NAME_IMAGE_BOTTOM, imageData: bottomPng }));
    }
    return dirty;
  }

  private rebuildBase(chess: ChessService, showBoardMarkers: boolean = true, playerColor: 'w' | 'b' = 'w'): void {
    const pixels = this.basePixels;
    const g = this.g;
    const flip = playerColor === 'b';
    pixels.fill(0);

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        if ((rank + file) % 2 === 1) {
          fillCell(pixels, file, rank, 0, g);
        } else {
          fillCellLightDots(pixels, file, rank, g);
        }
      }
    }

    drawBorder(pixels, g);
    if (showBoardMarkers) {
      drawFileLabels(pixels, g, flip);
      drawRankLabels(pixels, g, flip);
    }

    const board = chess.getBoard();
    for (let rank = 0; rank < 8; rank++) {
      const row = board[rank];
      if (!row) continue;
      for (let file = 0; file < 8; file++) {
        const piece = row[file];
        if (piece) {
          // board[0] is chess rank 8 (display row 0 for White). Flip 180° for Black.
          const dRow = flip ? 7 - rank : rank;
          const dFile = flip ? 7 - file : file;
          drawPiece(pixels, dFile, dRow, piece.color, piece.type, g);
        }
      }
    }
  }

  /** Fill a pixel buffer with the empty coordinate-drill grid (no highlight). */
  private fillDrillBase(pixels: Uint8Array): void {
    const g = this.g;
    pixels.fill(0);
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        if ((rank + file) % 2 === 1) {
          fillCell(pixels, file, rank, 0, g);
        } else {
          fillCellLightDots(pixels, file, rank, g);
        }
      }
    }
    drawBorder(pixels, g);
  }

  /** Render empty board for drill mode (no pieces, no labels). Uses cached base; always returns both halves for full board updates. */
  renderDrillBoard(cursorFile: number, cursorRank: number): ImageRawDataUpdate[] {
    if (!this.drillBasePixels) {
      this.drillBasePixels = new Uint8Array(BUF_W * BUF_H);
      this.fillDrillBase(this.drillBasePixels);
    }

    this.workPixels.set(this.drillBasePixels);
    const displayRank = 7 - cursorRank;
    highlightCell(this.workPixels, cursorFile, displayRank, 'selected', this.g);

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
    const g = this.g;
    pixels.fill(0);

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        if ((rank + file) % 2 === 1) {
          fillCell(pixels, file, rank, 0, g);
        } else {
          fillCellLightDots(pixels, file, rank, g);
        }
      }
    }

    drawBorder(pixels, g);

    // Convert rank indices to display coords (rank 1 at bottom = display row 7)
    const knightDisplayRank = 7 - knightRank;
    const targetDisplayRank = 7 - targetRank;
    const highlightDisplayRank = 7 - highlightRank;

    highlightCell(pixels, targetFile, targetDisplayRank, 'destination', g);
    drawPiece(pixels, knightFile, knightDisplayRank, 'w', 'n', g);

    if (highlightFile !== knightFile || highlightRank !== knightRank) {
      highlightCell(pixels, highlightFile, highlightDisplayRank, 'selected', g);
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
    const g = this.g;
    pixels.fill(0);

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        if ((rank + file) % 2 === 1) {
          fillCell(pixels, file, rank, 0, g);
        } else {
          fillCellLightDots(pixels, file, rank, g);
        }
      }
    }

    drawBorder(pixels, g);

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
          drawPiece(pixels, file, fenRank, color, pieceType, g);
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
  style: 'selected' | 'destination' | 'rowBand';
}

export function rankHalf(rank: number): 'top' | 'bottom' {
  return rankToHalf(rank, SMALL_LAYOUT);
}

function getHighlights(state: GameState): Highlight[] {
  const highlights: Highlight[] = [];
  const piece = getSelectedPiece(state);
  const pc = state.playerColor;

  switch (state.phase) {
    case 'rowSelect': {
      const row = getSelectedRow(state);
      if (row != null) {
        const displayRank = rankToDisplayRank(row, pc);
        for (let file = 0; file < 8; file++) {
          highlights.push({ file, rank: displayRank, style: 'rowBand' });
        }
      }
      break;
    }

    case 'pieceSelect': {
      const row = getSelectedRow(state);
      if (row != null) {
        const displayRank = rankToDisplayRank(row, pc);
        for (let file = 0; file < 8; file++) {
          highlights.push({ file, rank: displayRank, style: 'rowBand' });
        }
      }
      // Hashed outline drawn AFTER the band so it reads on top.
      if (piece) {
        highlights.push({ ...squareToCoords(piece.square, pc), style: 'selected' });
      }
      break;
    }

    case 'destSelect': {
      if (piece) {
        highlights.push({ ...squareToCoords(piece.square, pc), style: 'selected' });
      }
      const move = getSelectedMove(state);
      if (move) {
        highlights.push({ ...squareToCoords(move.to, pc), style: 'destination' });
      }
      break;
    }

    case 'promotionSelect': {
      const pm = state.pendingPromotionMove;
      if (pm) {
        highlights.push({ ...squareToCoords(pm.from, pc), style: 'selected' });
        highlights.push({ ...squareToCoords(pm.to, pc), style: 'destination' });
      }
      break;
    }
  }

  return highlights;
}

function cellX(file: number, g: GridLayout): number {
  return g.gridX + file * g.cell;
}

function cellY(rank: number, g: GridLayout): number {
  return g.gridY + rank * g.cell;
}

function setPixel(pixels: Uint8Array, x: number, y: number, value: number): void {
  if (x >= 0 && x < BUF_W && y >= 0 && y < BUF_H) {
    pixels[y * BUF_W + x] = value;
  }
}

function fillCell(pixels: Uint8Array, file: number, rank: number, value: number, g: GridLayout): void {
  const x0 = cellX(file, g);
  const y0 = cellY(rank, g);
  for (let dy = 0; dy < g.cell; dy++) {
    for (let dx = 0; dx < g.cell; dx++) {
      setPixel(pixels, x0 + dx, y0 + dy, value);
    }
  }
}

/** Fill a light square with a dot pattern (checkerboard 0/1). */
function fillCellLightDots(pixels: Uint8Array, file: number, rank: number, g: GridLayout): void {
  const x0 = cellX(file, g);
  const y0 = cellY(rank, g);
  for (let dy = 0; dy < g.cell; dy++) {
    for (let dx = 0; dx < g.cell; dx++) {
      const value = (dx + dy) % 2 === 0 ? 0 : 1;
      setPixel(pixels, x0 + dx, y0 + dy, value);
    }
  }
}

function highlightCell(
  pixels: Uint8Array,
  file: number,
  rank: number,
  style: 'selected' | 'destination' | 'rowBand',
  g: GridLayout,
): void {
  const x0 = cellX(file, g);
  const y0 = cellY(rank, g);

  if (style === 'rowBand') {
    // Thick solid outline framing the whole rank: 3px top & bottom rails on every cell
    // (cells abut → one continuous strip), plus 3px left/right end-caps only on the
    // board-edge files so the row reads as a single bordered rectangle. No interior
    // fill, so the piece silhouettes on the row stay clean.
    const T = 3;
    for (let dx = 0; dx < g.cell; dx++) {
      for (let t = 0; t < T; t++) {
        setPixel(pixels, x0 + dx, y0 + t, 1);
        setPixel(pixels, x0 + dx, y0 + g.cell - 1 - t, 1);
      }
    }
    if (file === 0 || file === 7) {
      const ex = file === 0 ? 0 : g.cell - 1;
      for (let dy = 0; dy < g.cell; dy++) {
        for (let t = 0; t < T; t++) {
          setPixel(pixels, x0 + (file === 0 ? ex + t : ex - t), y0 + dy, 1);
        }
      }
    }
  } else if (style === 'selected') {
    // Diagonal striped border (3px wide)
    const borderWidth = 3;
    for (let t = 0; t < borderWidth; t++) {
      for (let dx = 0; dx < g.cell; dx++) {
        const stripe = (dx + t) % 4 < 2 ? 1 : 0;
        setPixel(pixels, x0 + dx, y0 + t, stripe);
      }
      for (let dx = 0; dx < g.cell; dx++) {
        const stripe = (dx + t) % 4 < 2 ? 1 : 0;
        setPixel(pixels, x0 + dx, y0 + g.cell - 1 - t, stripe);
      }
      for (let dy = 0; dy < g.cell; dy++) {
        const stripe = (dy + t) % 4 < 2 ? 1 : 0;
        setPixel(pixels, x0 + t, y0 + dy, stripe);
      }
      for (let dy = 0; dy < g.cell; dy++) {
        const stripe = (dy + t) % 4 < 2 ? 1 : 0;
        setPixel(pixels, x0 + g.cell - 1 - t, y0 + dy, stripe);
      }
    }
  } else {
    // Destination: outlined X centered in the cell. On white (light) squares: dark border + white X.
    const isLightSquare = (rank + file) % 2 === 0;
    const outlineVal = isLightSquare ? 0 : 1;
    const xVal = isLightSquare ? 1 : 0;
    const pad = 5;
    const size = g.cell - pad * 2;
    // On light squares the background is stippled; use a thicker outline so the dark border reads as uniform.
    const outlineSpread = isLightSquare ? 2 : 1;
    const oxMin = -2 - (outlineSpread - 1);
    const oxMax = 1 + (outlineSpread - 1);
    const oyMin = -1 - (outlineSpread - 1);
    const oyMax = 1 + (outlineSpread - 1);
    const tMin = -1 - (outlineSpread - 1);
    const tMax = 0 + (outlineSpread - 1);

    // First pass: outline around the X
    for (let i = 0; i < size; i++) {
      const d1 = i;
      const d2 = size - 1 - i;
      for (let ox = oxMin; ox <= oxMax; ox++) {
        for (let oy = oyMin; oy <= oyMax; oy++) {
          if (ox >= -1 && ox <= 0) continue;
          setPixel(pixels, x0 + pad + d1 + ox, y0 + pad + i + oy, outlineVal);
          setPixel(pixels, x0 + pad + d2 + ox, y0 + pad + i + oy, outlineVal);
        }
      }
      for (let t = tMin; t <= tMax; t++) {
        for (let oy2 = 1; oy2 <= outlineSpread; oy2++) {
          setPixel(pixels, x0 + pad + d1 + t, y0 + pad + i - oy2, outlineVal);
          setPixel(pixels, x0 + pad + d1 + t, y0 + pad + i + oy2, outlineVal);
          setPixel(pixels, x0 + pad + d2 + t, y0 + pad + i - oy2, outlineVal);
          setPixel(pixels, x0 + pad + d2 + t, y0 + pad + i + oy2, outlineVal);
        }
      }
    }

    // Second pass: X fill on top
    for (let i = 0; i < size; i++) {
      const d1 = i;
      const d2 = size - 1 - i;
      for (let t = -1; t <= 0; t++) {
        setPixel(pixels, x0 + pad + d1 + t, y0 + pad + i, xVal);
        setPixel(pixels, x0 + pad + d2 + t, y0 + pad + i, xVal);
      }
    }
  }
}

function drawBorder(pixels: Uint8Array, g: GridLayout): void {
  for (let x = g.borderL; x <= g.borderR; x++) {
    setPixel(pixels, x, g.borderT, 1);
    setPixel(pixels, x, g.borderB, 1);
  }
  for (let y = g.borderT; y <= g.borderB; y++) {
    setPixel(pixels, g.borderL, y, 1);
    setPixel(pixels, g.borderR, y, 1);
  }
}

function drawFileLabels(pixels: Uint8Array, g: GridLayout, flip = false): void {
  const files = flip ? 'HGFEDCBA' : 'ABCDEFGH';
  for (let f = 0; f < 8; f++) {
    const lx = cellX(f, g) + Math.floor(g.cell / 2) - 2;
    drawChar(pixels, lx, g.labelY, files[f]!);
  }
}

function drawRankLabels(pixels: Uint8Array, g: GridLayout, flip = false): void {
  const ranks = flip ? '12345678' : '87654321';
  for (let r = 0; r < 8; r++) {
    const ly = cellY(r, g) + Math.floor(g.cell / 2) - 3;
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
  g: GridLayout,
): void {
  const isDark = (rank + file) % 2 === 1;
  const silhouette = PIECE_SILHOUETTES[type];
  if (!silhouette) return;

  const bottomRow = findBottomRow(silhouette);
  const x0 = cellX(file, g) + Math.floor((g.cell - PIECE_SIZE) / 2);
  // Ensure at least 1px gap from top of cell so pieces don't touch the top
  const topInset = Math.max(1, g.cell - 4 - bottomRow);
  const y0 = cellY(rank, g) + topInset;

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
          // Check if any neighbor is part of the silhouette (4-neighbour: thin ring, no chunky corners)
          let adjacentToSilhouette = false;
          for (let dr = -1; dr <= 1 && !adjacentToSilhouette; dr++) {
            for (let dc = -1; dc <= 1 && !adjacentToSilhouette; dc++) {
              if (Math.abs(dr) + Math.abs(dc) !== 1) continue;
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
      // Light squares: white outline for contrast (same as dark squares), then black fill
      const outlineVal = 1;
      for (let row = -1; row <= PIECE_SIZE; row++) {
        for (let col = -1; col <= PIECE_SIZE; col++) {
          const inSilhouette = row >= 0 && row < PIECE_SIZE && col >= 0 && col < PIECE_SIZE &&
            silhouette[row] !== undefined && (silhouette[row]! & (1 << (PIECE_SIZE - 1 - col)));
          if (inSilhouette) continue;
          let adjacentToSilhouette = false;
          for (let dr = -1; dr <= 1 && !adjacentToSilhouette; dr++) {
            for (let dc = -1; dc <= 1 && !adjacentToSilhouette; dc++) {
              if (Math.abs(dr) + Math.abs(dc) !== 1) continue;
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
    }
  } else {
    // White pieces: contrasting outline + solid white interior.
    const outlineVal = isDark ? 1 : 0;
    const fillVal = 1;
    for (let row = 0; row < PIECE_SIZE; row++) {
      const bits = silhouette[row];
      if (bits === undefined) continue;
      for (let col = 0; col < PIECE_SIZE; col++) {
        if (bits & (1 << (PIECE_SIZE - 1 - col))) {
          const edge = isEdgePixel(silhouette, row, col);
          setPixel(pixels, x0 + col, y0 + row, edge ? outlineVal : fillVal);
        }
      }
    }
    // On light squares add an outer outline ring so the dark border is thick without shrinking the piece.
    if (!isDark) {
      for (let row = -1; row <= PIECE_SIZE; row++) {
        for (let col = -1; col <= PIECE_SIZE; col++) {
          const inSilhouette = row >= 0 && row < PIECE_SIZE && col >= 0 && col < PIECE_SIZE &&
            silhouette[row] !== undefined && (silhouette[row]! & (1 << (PIECE_SIZE - 1 - col)));
          if (inSilhouette) continue;
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
    }
  }
}

function squareToCoords(square: string, playerColor: 'w' | 'b' = 'w'): { file: number; rank: number } {
  const { file, displayRank } = squareToDisplayCoords(square, playerColor);
  return { file, rank: displayRank };
}
