import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ImageRawDataUpdate } from '@evenrealities/even_hub_sdk';
import { BoardRenderer } from '../../src/render/boardimage';
import * as pngEncode from '../../src/render/png-encode';
import {
  CONTAINER_ID_IMAGE_TOP,
  CONTAINER_ID_IMAGE_BOTTOM,
  IMAGE_WIDTH,
  IMAGE_HEIGHT,
} from '../../src/render/composer';
import { buildInitialState, type GameState } from '../../src/state/contracts';
import { ChessService } from '../../src/chess/chessservice';

// Wrap the real PNG encoder so a test can make it fail once; every other call encodes for real.
vi.mock('../../src/render/png-encode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/render/png-encode')>();
  return { ...actual, encodePixelsToPng: vi.fn(actual.encodePixelsToPng) };
});

// Cell geometry of the two grids, mirroring makeLayout() in src/render/boardimage.ts.
// Small: 21px cells after a 10px rank-label gutter, centred on the 100px split.
// Large: 25px cells filling the whole 200x200 buffer.
const GRIDS = {
  small: { largeGrid: false, cell: 21, x: 11, y: 16 },
  large: { largeGrid: true, cell: 25, x: 0, y: 0 },
} as const;
type Grid = (typeof GRIDS)[keyof typeof GRIDS];

const KINGS_ONLY = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
const KINGS_AND_A1_ROOK = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';

function stateFor(fen?: string, overrides: Partial<GameState> = {}): { state: GameState; chess: ChessService } {
  const chess = new ChessService(fen);
  return { state: { ...buildInitialState(chess), showBoardMarkers: false, ...overrides }, chess };
}

/** State with the piece on `square` selected in `phase` (and, for destSelect, the move to `to`). */
function selecting(
  base: { state: GameState; chess: ChessService },
  square: string,
  phase: 'pieceSelect' | 'destSelect',
  to?: string,
): GameState {
  const piece = base.state.pieces.find((p) => p.square === square)!;
  const selectedMoveIndex = to ? piece.moves.findIndex((m) => m.to === to) : 0;
  return { ...base.state, phase, selectedPieceId: piece.id, selectedMoveIndex };
}

function snapshot(state: GameState, chess: ChessService, grid: Grid = GRIDS.small): Uint8Array {
  return new BoardRenderer({ largeGrid: grid.largeGrid }).snapshotPixels(state, chess).pixels;
}

/**
 * Board cells (as "file,row" in display coordinates, row 0 at the top) containing any pixel that
 * differs between two snapshots. A pixel outside the 8x8 grid is reported as "outside".
 */
function changedCells(a: Uint8Array, b: Uint8Array, grid: Grid = GRIDS.small): string[] {
  const cells = new Set<string>();
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const file = Math.floor((i % IMAGE_WIDTH - grid.x) / grid.cell);
    const row = Math.floor((Math.floor(i / IMAGE_WIDTH) - grid.y) / grid.cell);
    cells.add(file >= 0 && file < 8 && row >= 0 && row < 8 ? `${file},${row}` : 'outside');
  }
  return [...cells].sort();
}

const wholeRow = (row: number) => [0, 1, 2, 3, 4, 5, 6, 7].map((f) => `${f},${row}`);

/** Decode a 1-bit BMP into one 0/1 byte per pixel, top row first. */
function decodeBmp(data: Uint8Array): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const offset = view.getUint32(10, true);
  const width = view.getInt32(18, true);
  const height = view.getInt32(22, true); // positive: rows are stored bottom-up
  const stride = Math.ceil(width / 32) * 4;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const fileRow = offset + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      out[y * width + x] = (data[fileRow + (x >> 3)]! >> (7 - (x & 7))) & 1;
    }
  }
  return out;
}

const ids = (updates: ImageRawDataUpdate[]) => updates.map((u) => u.containerID);
const bytes = (u: ImageRawDataUpdate) => u.imageData as Uint8Array;
const top = (pixels: Uint8Array) => pixels.slice(0, IMAGE_WIDTH * IMAGE_HEIGHT);
const bottom = (pixels: Uint8Array) => pixels.slice(IMAGE_WIDTH * IMAGE_HEIGHT);

describe('BoardRenderer orientation', () => {
  for (const [name, grid] of Object.entries(GRIDS)) {
    it(`${name} grid: White at the bottom draws a1 in the bottom-left cell`, () => {
      const without = stateFor(KINGS_ONLY);
      const withRook = stateFor(KINGS_AND_A1_ROOK);
      const diff = changedCells(snapshot(without.state, without.chess, grid), snapshot(withRook.state, withRook.chess, grid), grid);
      expect(diff).toEqual(['0,7']);
    });

    it(`${name} grid: Black at the bottom draws a1 in the top-right cell`, () => {
      const without = stateFor(KINGS_ONLY, { playerColor: 'b' });
      const withRook = stateFor(KINGS_AND_A1_ROOK, { playerColor: 'b' });
      const diff = changedCells(snapshot(without.state, without.chess, grid), snapshot(withRook.state, withRook.chess, grid), grid);
      expect(diff).toEqual(['7,0']);
    });
  }

  it('Position=Top as White draws the board from Black\'s side (a1 in the top-right cell)', () => {
    const without = stateFor(KINGS_ONLY, { boardPosition: 'top' });
    const withRook = stateFor(KINGS_AND_A1_ROOK, { boardPosition: 'top' });
    expect(changedCells(snapshot(without.state, without.chess), snapshot(withRook.state, withRook.chess))).toEqual(['7,0']);
  });

  it('a flipped board is the White view rotated 180 degrees, cell for cell', () => {
    const { state, chess } = stateFor();
    const white = snapshot(state, chess);
    const black = snapshot({ ...state, playerColor: 'b' }, chess);
    const { cell, x, y } = GRIDS.small;
    for (let row = 0; row < 8; row++) {
      for (let file = 0; file < 8; file++) {
        for (let dy = 0; dy < cell; dy++) {
          const flippedRow = (y + row * cell + dy) * IMAGE_WIDTH + x + file * cell;
          const whiteRow = (y + (7 - row) * cell + dy) * IMAGE_WIDTH + x + (7 - file) * cell;
          expect(black.slice(flippedRow, flippedRow + cell)).toEqual(white.slice(whiteRow, whiteRow + cell));
        }
      }
    }
  });

  it('file and rank labels are reversed when Black is at the bottom', () => {
    const { state, chess } = stateFor(undefined, { showBoardMarkers: true });
    const white = snapshot(state, chess);
    const black = snapshot({ ...state, playerColor: 'b' }, chess);
    // 5x7 glyphs: file labels sit 6px below the board border (y=190) and 8px into their column;
    // rank labels sit at x=0, 7px into their row (see drawFileLabels/drawRankLabels).
    const fileLabel = (pixels: Uint8Array, file: number) => {
      const lx = GRIDS.small.x + file * GRIDS.small.cell + 8;
      const rows: number[][] = [];
      for (let y = 190; y < 197; y++) rows.push([...pixels.slice(y * IMAGE_WIDTH + lx, y * IMAGE_WIDTH + lx + 5)]);
      return rows;
    };
    const rankLabel = (pixels: Uint8Array, row: number) => {
      const ly = GRIDS.small.y + row * GRIDS.small.cell + 7;
      const rows: number[][] = [];
      for (let y = ly; y < ly + 7; y++) rows.push([...pixels.slice(y * IMAGE_WIDTH, y * IMAGE_WIDTH + 5)]);
      return rows;
    };
    for (let i = 0; i < 8; i++) {
      expect(fileLabel(black, i)).toEqual(fileLabel(white, 7 - i));
      expect(rankLabel(black, i)).toEqual(rankLabel(white, 7 - i));
    }
    expect(fileLabel(black, 0)).not.toEqual(fileLabel(white, 0)); // "H" vs "A"
    expect(rankLabel(black, 0)).not.toEqual(rankLabel(white, 0)); // "1" vs "8"
  });
});

describe('BoardRenderer highlights', () => {
  it('selecting a piece outlines its whole rank, drawn in the view\'s orientation', () => {
    const base = stateFor();
    const idle = snapshot(base.state, base.chess);
    expect(changedCells(idle, snapshot(selecting(base, 'b1', 'pieceSelect'), base.chess))).toEqual(wholeRow(7));
  });

  it('with Position=Top, the rank band and target follow the flipped board, not the player colour', () => {
    const base = stateFor(undefined, { boardPosition: 'top' });
    const idle = snapshot(base.state, base.chess);
    // Rank 1 is display row 0 when Black's side is at the bottom.
    expect(changedCells(idle, snapshot(selecting(base, 'b1', 'pieceSelect'), base.chess))).toEqual(wholeRow(0));
    // e2 → e4: e2 is display (3,1), e4 is display (3,3).
    expect(changedCells(idle, snapshot(selecting(base, 'e2', 'destSelect', 'e4'), base.chess))).toEqual(['3,1', '3,3']);
  });

  it('a destination highlight marks the from- and to-squares for White at the bottom', () => {
    const base = stateFor();
    const idle = snapshot(base.state, base.chess);
    expect(changedCells(idle, snapshot(selecting(base, 'g1', 'destSelect', 'f3'), base.chess))).toEqual(['5,5', '6,7']);
  });
});

describe('BoardRenderer dirty-half tracking', () => {
  // White pawns on e5 (display row 3, the last row above the 100px split) and d4 (row 4, the first below).
  const SPLIT_FEN = '4k3/8/8/4P3/3P4/8/8/4K3 w - - 0 1';

  for (const [name, grid] of Object.entries(GRIDS)) {
    it(`${name} grid: a band on display row 3 updates only the top image`, () => {
      const base = stateFor(SPLIT_FEN);
      const renderer = new BoardRenderer({ largeGrid: grid.largeGrid });
      renderer.renderFull(base.state, base.chess);
      expect(ids(renderer.render(selecting(base, 'e5', 'pieceSelect'), base.chess))).toEqual([CONTAINER_ID_IMAGE_TOP]);
    });

    it(`${name} grid: a band on display row 4 updates only the bottom image`, () => {
      const base = stateFor(SPLIT_FEN);
      const renderer = new BoardRenderer({ largeGrid: grid.largeGrid });
      renderer.renderFull(base.state, base.chess);
      expect(ids(renderer.render(selecting(base, 'd4', 'pieceSelect'), base.chess))).toEqual([CONTAINER_ID_IMAGE_BOTTOM]);
    });
  }

  it('re-rendering an unchanged state sends nothing', () => {
    const { state, chess } = stateFor();
    const renderer = new BoardRenderer();
    renderer.renderFull(state, chess);
    expect(renderer.render(state, chess)).toEqual([]);
  });

  it('the half sent after a highlight change matches a fresh full render of the new state', () => {
    const base = stateFor();
    const renderer = new BoardRenderer();
    renderer.renderFull(base.state, base.chess);
    const selected = selecting(base, 'b1', 'pieceSelect');
    const [update] = renderer.render(selected, base.chess);
    expect(decodeBmp(bytes(update!))).toEqual(bottom(snapshot(selected, base.chess)));
  });

  it('clearing a highlight re-sends its half without the highlight', () => {
    const base = stateFor();
    const renderer = new BoardRenderer();
    renderer.renderFull(selecting(base, 'b1', 'pieceSelect'), base.chess);
    const updates = renderer.render(base.state, base.chess);
    expect(ids(updates)).toEqual([CONTAINER_ID_IMAGE_BOTTOM]);
    expect(decodeBmp(bytes(updates[0]!))).toEqual(bottom(snapshot(base.state, base.chess)));
  });

  it('toggling Position redraws both halves from the other side', () => {
    const { state, chess } = stateFor();
    const renderer = new BoardRenderer();
    renderer.renderFull(state, chess);
    const flipped = { ...state, boardPosition: 'top' as const };
    const updates = renderer.render(flipped, chess);
    expect(ids(updates)).toEqual([CONTAINER_ID_IMAGE_TOP, CONTAINER_ID_IMAGE_BOTTOM]);
    const expected = snapshot(flipped, chess);
    expect(decodeBmp(bytes(updates[0]!))).toEqual(top(expected));
    expect(decodeBmp(bytes(updates[1]!))).toEqual(bottom(expected));
  });

  it('toggling board markers redraws both halves', () => {
    const { state, chess } = stateFor();
    const renderer = new BoardRenderer();
    renderer.renderFull(state, chess);
    expect(ids(renderer.render({ ...state, showBoardMarkers: true }, chess))).toEqual([CONTAINER_ID_IMAGE_TOP, CONTAINER_ID_IMAGE_BOTTOM]);
  });

  it('a move that only changes the bottom half sends only the bottom image', () => {
    const chess = new ChessService();
    const state = { ...buildInitialState(chess), showBoardMarkers: false };
    const renderer = new BoardRenderer();
    renderer.renderFull(state, chess);
    chess.makeMove('b1', 'c3'); // rows 5 and 7, both below the split
    expect(ids(renderer.render({ ...state, fen: chess.getFen() }, chess))).toEqual([CONTAINER_ID_IMAGE_BOTTOM]);
  });

  it('a bottom-half move that also clears a top-half highlight re-sends both halves', () => {
    const base = stateFor(SPLIT_FEN);
    const renderer = new BoardRenderer();
    renderer.renderFull(selecting(base, 'e5', 'pieceSelect'), base.chess); // band on row 3 (top)
    base.chess.makeMove('e1', 'f1'); // row 7 only
    const after = { ...base.state, fen: base.chess.getFen() };
    const updates = renderer.render(after, base.chess);
    expect(ids(updates)).toEqual([CONTAINER_ID_IMAGE_TOP, CONTAINER_ID_IMAGE_BOTTOM]);
    expect(decodeBmp(bytes(updates[0]!))).toEqual(top(snapshot(after, base.chess)));
  });
});

describe('BoardRenderer BMP encoding', () => {
  it('writes a 200x100 bottom-up 1-bit BMP header', () => {
    const { state, chess } = stateFor();
    const [topImage] = new BoardRenderer().renderFull(state, chess);
    const view = new DataView(bytes(topImage!).buffer);
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1))).toBe('BM');
    expect(view.getInt32(18, true)).toBe(IMAGE_WIDTH);
    expect(view.getInt32(22, true)).toBe(IMAGE_HEIGHT);
    expect(view.getUint16(28, true)).toBe(1);
  });

  it('the two images decode to the top and bottom halves of the composed board', () => {
    const { state, chess } = stateFor(undefined, { showBoardMarkers: true });
    const renderer = new BoardRenderer();
    const [topImage, bottomImage] = renderer.renderFull(state, chess);
    const pixels = renderer.snapshotPixels(state, chess).pixels;
    expect(decodeBmp(bytes(topImage!))).toEqual(top(pixels));
    expect(decodeBmp(bytes(bottomImage!))).toEqual(bottom(pixels));
  });
});

describe('BoardRenderer.renderPngAsync', () => {
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

  beforeEach(() => {
    vi.mocked(pngEncode.encodePixelsToPng).mockClear();
  });

  it('sends both halves as PNG on a full render', async () => {
    const { state, chess } = stateFor();
    const updates = await new BoardRenderer().renderPngAsync(state, chess, true);
    expect(ids(updates)).toEqual([CONTAINER_ID_IMAGE_TOP, CONTAINER_ID_IMAGE_BOTTOM]);
    expect(updates.map((u) => [...bytes(u).slice(0, 4)])).toEqual([PNG_SIGNATURE, PNG_SIGNATURE]);
  });

  it('falls back to BMPs of both halves when PNG encoding fails', async () => {
    const { state, chess } = stateFor();
    vi.mocked(pngEncode.encodePixelsToPng).mockResolvedValueOnce(new Uint8Array(0));
    const updates = await new BoardRenderer().renderPngAsync(state, chess, true);
    expect(ids(updates)).toEqual([CONTAINER_ID_IMAGE_TOP, CONTAINER_ID_IMAGE_BOTTOM]);
    const expected = snapshot(state, chess);
    expect(decodeBmp(bytes(updates[0]!))).toEqual(top(expected));
    expect(decodeBmp(bytes(updates[1]!))).toEqual(bottom(expected));
  });

  it('a highlight-only change encodes just the dirty half', async () => {
    const base = stateFor();
    const renderer = new BoardRenderer();
    await renderer.renderPngAsync(base.state, base.chess, true);
    vi.mocked(pngEncode.encodePixelsToPng).mockClear();
    const updates = await renderer.renderPngAsync(selecting(base, 'b1', 'pieceSelect'), base.chess);
    expect(ids(updates)).toEqual([CONTAINER_ID_IMAGE_BOTTOM]);
    expect(pngEncode.encodePixelsToPng).toHaveBeenCalledTimes(1);
  });

  it('a bottom-half move that also clears a top-half highlight re-sends both halves', async () => {
    const base = stateFor('4k3/8/8/4P3/3P4/8/8/4K3 w - - 0 1');
    const renderer = new BoardRenderer();
    await renderer.renderPngAsync(selecting(base, 'e5', 'pieceSelect'), base.chess, true); // band on row 3 (top)
    base.chess.makeMove('e1', 'f1'); // row 7 only
    const updates = await renderer.renderPngAsync({ ...base.state, fen: base.chess.getFen() }, base.chess);
    expect(ids(updates)).toEqual([CONTAINER_ID_IMAGE_TOP, CONTAINER_ID_IMAGE_BOTTOM]);
  });
});
