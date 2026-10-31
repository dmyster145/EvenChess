import { describe, it, expect } from 'vitest';
import {
  validateEvenHubPageContainer,
  type ImageContainerProperty,
  type TextContainerProperty,
} from '@evenrealities/even_hub_sdk';
import {
  composeStartupPage,
  composeTextOnlyStartupPage,
  composePageForState,
  getBoardLayout,
  CONTAINER_ID_TEXT,
  CONTAINER_ID_IMAGE_TOP,
  CONTAINER_ID_IMAGE_BOTTOM,
  CONTAINER_ID_BRAND,
  BRAND_HEIGHT,
  TEXT_Y,
} from '../../src/render/composer';
import { buildInitialState } from '../../src/state/contracts';
import { ChessService } from '../../src/chess/chessservice';

describe('render/composer — page containers', () => {
  const state = buildInitialState(new ChessService());

  const pages = {
    'text-only startup': composeTextOnlyStartupPage(state),
    'full startup': composeStartupPage(state),
    rebuild: composePageForState(state),
  };

  for (const [name, page] of Object.entries(pages)) {
    it(`${name} passes SDK validation`, () => {
      expect(validateEvenHubPageContainer(page).valid).toBe(true);
    });

    it(`${name} registers no native OS menu (the menu is opened by double-tap)`, () => {
      expect(page.menuObject).toBeUndefined();
    });
  }
});

describe('render/composer — getBoardLayout', () => {
  // Display is 576x288; the board is two stacked 200x100 images, vertically centred (y=44).
  const cases = [
    { alignment: 'right', phase: 'idle', boardX: 376, textWidth: 368 },
    { alignment: 'right', phase: 'viewLog', boardX: 376, textWidth: 368 },
    // Centred would be x=188, but the HUD needs 220px of text, so the board is clamped to x=228.
    { alignment: 'center', phase: 'idle', boardX: 228, textWidth: 220 },
    // The move log needs the full text width, so the board moves to the right edge.
    { alignment: 'center', phase: 'viewLog', boardX: 376, textWidth: 368 },
  ] as const;

  for (const { alignment, phase, boardX, textWidth } of cases) {
    it(`${alignment} alignment in ${phase}: board at x=${boardX}, text ${textWidth}px wide`, () => {
      const state = { ...buildInitialState(new ChessService()), boardAlignment: alignment, phase };
      expect(getBoardLayout(state)).toEqual({ imageWidth: 200, imageHeight: 100, boardX, boardTopY: 44, textWidth });
    });
  }
});

describe('render/composer — container placement', () => {
  const imageById = (page: { imageObject?: ImageContainerProperty[] }, id: number) =>
    page.imageObject!.find((c) => c.containerID === id)!;
  const hudText = (page: { textObject?: TextContainerProperty[] }) =>
    page.textObject!.find((c) => c.containerID === CONTAINER_ID_TEXT)!;
  const box = (c: ImageContainerProperty | TextContainerProperty) =>
    ({ x: c.xPosition, y: c.yPosition, width: c.width, height: c.height });

  it('stacks the two board images at the layout position, with the brand strip directly above the top image', () => {
    const state = { ...buildInitialState(new ChessService()), boardAlignment: 'center' as const };
    const page = composePageForState(state);
    expect(box(imageById(page, CONTAINER_ID_IMAGE_TOP))).toEqual({ x: 228, y: 44, width: 200, height: 100 });
    expect(box(imageById(page, CONTAINER_ID_IMAGE_BOTTOM))).toEqual({ x: 228, y: 144, width: 200, height: 100 });
    expect(box(imageById(page, CONTAINER_ID_BRAND))).toEqual({ x: 228, y: 44 - BRAND_HEIGHT, width: 200, height: BRAND_HEIGHT });
  });

  it('sizes the HUD text to the space left of the board', () => {
    const page = composePageForState(buildInitialState(new ChessService()));
    expect(box(hudText(page))).toEqual({ x: 0, y: TEXT_Y, width: 368, height: 288 - TEXT_Y });
  });

  it('gives every image a higher container ID than every text container, so images draw in front', () => {
    const page = composePageForState(buildInitialState(new ChessService()));
    const textIds = page.textObject!.map((c) => c.containerID!);
    const imageIds = page.imageObject!.map((c) => c.containerID!);
    expect(Math.min(...imageIds)).toBeGreaterThan(Math.max(...textIds));
  });

  it('text-only startup centres the brand strip at the top, above full-width text', () => {
    const page = composeTextOnlyStartupPage(buildInitialState(new ChessService()));
    expect(page.imageObject!.map(box)).toEqual([{ x: 188, y: 20, width: 200, height: BRAND_HEIGHT }]);
    expect(box(hudText(page))).toEqual({ x: 0, y: 64, width: 576, height: 224 });
  });
});
