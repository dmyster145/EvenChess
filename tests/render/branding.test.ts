import { describe, it, expect } from 'vitest';
import {
  layoutCapturedStrip,
  preloadBrandingImages,
  renderBlankBrandingImage,
  type StripOp,
} from '../../src/render/branding';
import { BRAND_WIDTH } from '../../src/render/composer';

type Counts = Record<string, number>;

/** Every captured piece is either drawn (with its count) or included in a "+N". */
function accountedFor(ops: StripOp[], outline: boolean): number {
  let total = 0;
  let lastPieceDrawn = false;
  const side = ops.filter((op) => op.kind === 'text' || op.outline === outline);
  for (const op of side) {
    if (op.kind === 'piece') {
      total += 1;
      lastPieceDrawn = true;
    } else if (op.text.startsWith('+')) {
      total += Number(op.text.slice(1));
      lastPieceDrawn = false;
    } else if (lastPieceDrawn) {
      total += Number(op.text) - 1; // a count digit after a piece: n pieces, one already counted
      lastPieceDrawn = false;
    }
  }
  return total;
}

const sum = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);
// Piece silhouettes are drawn in columns 1–15 of their 19px box.
const inBounds = (ops: StripOp[]) =>
  ops.every((op) => op.kind === 'piece'
    ? op.x + 1 >= 0 && op.x + 16 <= BRAND_WIDTH
    : op.x >= 0 && op.x + op.text.length * 6 <= BRAND_WIDTH);

describe('captured-pieces strip layout', () => {
  it('a light capture uses the roomy layout: White at the left edge, Black at the right', () => {
    const ops = layoutCapturedStrip({ p: 1 }, { n: 1 });
    expect(ops).toEqual([
      { kind: 'piece', type: 'p', x: 2, outline: false },
      { kind: 'piece', type: 'n', x: BRAND_WIDTH - 2 - 19, outline: true },
    ]);
  });

  it('one of each piece captured on both sides draws all ten pieces (compact layout)', () => {
    const each = { q: 1, r: 1, b: 1, n: 1, p: 1 };
    const ops = layoutCapturedStrip(each, each);
    expect(ops.filter((o) => o.kind === 'piece')).toHaveLength(10);
    expect(ops.some((o) => o.kind === 'text')).toBe(false);
    expect(inBounds(ops)).toBe(true);
  });

  it('when even the compact layout overflows, the rest is counted as "+N", never dropped', () => {
    const white = { q: 1, r: 2, b: 2, n: 2, p: 8 };
    const black = { q: 1, r: 2, b: 2, n: 2, p: 7 };
    const ops = layoutCapturedStrip(white, black);
    expect(accountedFor(ops.filter((o) => o.kind === 'piece' ? !o.outline : o.x < BRAND_WIDTH / 2), false)).toBe(sum(white));
    expect(accountedFor(ops.filter((o) => o.kind === 'piece' ? o.outline : o.x >= BRAND_WIDTH / 2), true)).toBe(sum(black));
    expect(ops.some((o) => o.kind === 'text' && o.text.startsWith('+'))).toBe(true);
    expect(inBounds(ops)).toBe(true);
  });

  it('a lopsided capture gives the busy side the space the other does not need', () => {
    const white = { q: 1, r: 2, b: 2, n: 2, p: 8 };
    const ops = layoutCapturedStrip(white, { p: 1 });
    expect(ops.filter((o) => o.kind === 'piece' && !o.outline)).toHaveLength(5); // all of White's types fit
    expect(ops.some((o) => o.kind === 'text' && o.text.startsWith('+'))).toBe(false);
    expect(inBounds(ops)).toBe(true);
  });
});

describe('branding preload', () => {
  it('keeps the blank strip as a BMP (a blank PNG encodes as 1-bit, which renders solid green)', async () => {
    await preloadBrandingImages();
    const data = renderBlankBrandingImage().imageData as number[];
    expect(String.fromCharCode(data[0]!, data[1]!)).toBe('BM');
  });
});
