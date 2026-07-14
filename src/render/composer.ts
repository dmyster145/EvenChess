/**
 * Page Composer — translates GameState into Even Hub SDK container configs.
 * 2-column layout: text on left, board on right (split into 2 image containers).
 * Layout is dynamic based on state.boardAlignment and state.boardSize.
 */

import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  ImageContainerProperty,
} from '@evenrealities/even_hub_sdk';
import type { GameState } from '../state/contracts';
import { getCombinedDisplayText } from '../state/selectors';
import { DISPLAY_WIDTH } from '../state/constants';

// Master toggle for the invisible gesture-capture container. When true, an invisible
// full-screen text container (isEventCapture:1) sits behind everything and receives all
// touch/scroll gestures, so the firmware never re-anchors/scrolls the VISIBLE menu text as
// you swipe. Kept as a one-line flag so image-loading can be A/B isolated against it without
// touching the rest of the layout: flip to false → single visible capture container (the
// original known-good layout, image IDs 2/3/4).
const USE_INPUT_CAPTURE_CONTAINER = true;

// Container IDs. Draw order follows ascending containerID (lower = drawn first = behind), so the
// INPUT capture container takes the lowest ID to render behind the visible HUD/board. When the
// capture container is disabled the visible text reclaims ID 1 and images fall back to 2/3/4.
const CONTAINER_ID_INPUT = 1;
const CONTAINER_ID_TEXT = USE_INPUT_CAPTURE_CONTAINER ? 2 : 1;
const CONTAINER_ID_IMAGE_TOP = USE_INPUT_CAPTURE_CONTAINER ? 3 : 2;
const CONTAINER_ID_IMAGE_BOTTOM = USE_INPUT_CAPTURE_CONTAINER ? 4 : 3;
const CONTAINER_ID_BRAND = USE_INPUT_CAPTURE_CONTAINER ? 5 : 4;

const CONTAINER_NAME_TEXT = 'chess-hud';
const CONTAINER_NAME_IMAGE_TOP = 'board-top';
const CONTAINER_NAME_IMAGE_BOTTOM = 'board-bot';
const CONTAINER_NAME_BRAND = 'brand';
const CONTAINER_NAME_INPUT = 'input';

// Shared constants (unchanged across layouts)
const DISPLAY_HEIGHT = 288;
// The brand container is repurposed as the captured-pieces strip directly above the
// board: full board width, occupying the ~44px gap above the board. It still also
// renders the brand mark and the CHECK!/CHECKMATE! banner.
const BRAND_WIDTH = 200;
const BRAND_HEIGHT = 40;

// Small board dimensions (per half)
const SMALL_IMAGE_WIDTH = 200;
const SMALL_IMAGE_HEIGHT = 100;

// G2 firmware hard-caps image containers at 200×100 regardless of byte size or format.
// "Large" board size is a visual-only change (bigger cell rendering) within the same 200×100 containers.
const LARGE_IMAGE_WIDTH = SMALL_IMAGE_WIDTH;
const LARGE_IMAGE_HEIGHT = SMALL_IMAGE_HEIGHT;

// Gap between text container right edge and board left edge
const TEXT_BOARD_GAP = 8;

export interface BoardLayout {
  imageWidth: number;
  imageHeight: number;
  boardX: number;
  boardTopY: number;
  textWidth: number;
}

/**
 * Compute the board/text layout for the current state.
 * When center alignment + viewLog, board shifts right so the full text width is available.
 */
export function getBoardLayout(state: GameState): BoardLayout {
  const imageWidth = state.boardSize === 'large' ? LARGE_IMAGE_WIDTH : SMALL_IMAGE_WIDTH;
  const imageHeight = state.boardSize === 'large' ? LARGE_IMAGE_HEIGHT : SMALL_IMAGE_HEIGHT;

  // Both board sizes are vertically centered within the 288px display height.
  const boardTopY = Math.floor((DISPLAY_HEIGHT - imageHeight * 2) / 2);

  const isCenter = state.boardAlignment === 'center';
  // When viewing the move log in center alignment, temporarily shift to right so full text width is available.
  const useRight = !isCenter || state.phase === 'viewLog';

  // Minimum boardX ensures text area is wide enough for HUD arrows (220px + 8px gap = 228).
  const MIN_CENTER_BOARD_X = 228;

  let boardX: number;
  if (useRight) {
    boardX = DISPLAY_WIDTH - imageWidth;
  } else {
    boardX = Math.max(MIN_CENTER_BOARD_X, Math.floor((DISPLAY_WIDTH - imageWidth) / 2));
  }

  const textWidth = boardX - TEXT_BOARD_GAP;

  return { imageWidth, imageHeight, boardX, boardTopY, textWidth };
}

// ---------------------------------------------------------------------------

// The visible HUD/board containers only capture events when the dedicated INPUT container is off.
const VISIBLE_EVENT_CAPTURE = USE_INPUT_CAPTURE_CONTAINER ? 0 : 1;

/**
 * Invisible full-screen gesture-capture container. Full display size (not a small box) so the
 * firmware never renders a scroll indicator on it; content is a single space so nothing shows.
 * Its lowest containerID draws it behind the visible HUD/board. All visible containers set
 * isEventCapture:0 so their gestures fall through to this one — the firmware then never re-anchors
 * the visible menu text on swipe.
 */
function buildInputCaptureContainer(): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: CONTAINER_ID_INPUT,
    containerName: CONTAINER_NAME_INPUT,
    content: ' ',
    isEventCapture: 1,
  });
}

/**
 * Startup layout with text + optional brand only (full-width text, no board image slots).
 * Used for text-first BLE bring-up; `upgradeToFullLayout` later calls `composePageForState`.
 */
function buildTextOnlyContainers(state: GameState): ContainerSet {
  const TEXT_Y = BRAND_HEIGHT + 20 + 4;
  const textWidth = DISPLAY_WIDTH;

  const textObjects: TextContainerProperty[] = [];
  if (USE_INPUT_CAPTURE_CONTAINER) textObjects.push(buildInputCaptureContainer());
  textObjects.push(
    new TextContainerProperty({
      xPosition: 0,
      yPosition: TEXT_Y,
      width: textWidth,
      height: DISPLAY_HEIGHT - TEXT_Y,
      containerID: CONTAINER_ID_TEXT,
      containerName: CONTAINER_NAME_TEXT,
      content: getCombinedDisplayText(state),
      isEventCapture: VISIBLE_EVENT_CAPTURE,
    }),
  );

  const imageObjects: ImageContainerProperty[] = [];
  const brandX = Math.floor((textWidth - BRAND_WIDTH) / 2);
  if (brandX >= 0) {
    imageObjects.push(
      new ImageContainerProperty({
        xPosition: brandX,
        yPosition: 20,
        width: BRAND_WIDTH,
        height: BRAND_HEIGHT,
        containerID: CONTAINER_ID_BRAND,
        containerName: CONTAINER_NAME_BRAND,
      }),
    );
  }

  return { totalNum: textObjects.length + imageObjects.length, textObjects, imageObjects };
}

export function composeTextOnlyStartupPage(state: GameState): CreateStartUpPageContainer {
  const containers = buildTextOnlyContainers(state);
  return new CreateStartUpPageContainer({
    containerTotalNum: containers.totalNum,
    textObject: containers.textObjects,
    imageObject: containers.imageObjects,
  });
}

export function composeStartupPage(state: GameState): CreateStartUpPageContainer {
  const containers = buildContainers(state);
  return new CreateStartUpPageContainer({
    containerTotalNum: containers.totalNum,
    textObject: containers.textObjects,
    imageObject: containers.imageObjects,
  });
}

export function composePageForState(state: GameState): RebuildPageContainer {
  const containers = buildContainers(state);
  return new RebuildPageContainer({
    containerTotalNum: containers.totalNum,
    textObject: containers.textObjects,
    imageObject: containers.imageObjects,
  });
}

interface ContainerSet {
  totalNum: number;
  textObjects: TextContainerProperty[];
  imageObjects: ImageContainerProperty[];
}

function buildContainers(state: GameState): ContainerSet {
  const layout = getBoardLayout(state);
  const { imageWidth, imageHeight, boardX, boardTopY, textWidth } = layout;

  const textObjects: TextContainerProperty[] = [];
  const imageObjects: ImageContainerProperty[] = [];

  // The brand/captured strip moved above the board (right column), so the left text
  // column's top is now free — start the HUD/menu near the top of the display.
  const TEXT_Y = 8;
  if (USE_INPUT_CAPTURE_CONTAINER) textObjects.push(buildInputCaptureContainer());
  textObjects.push(
    new TextContainerProperty({
      xPosition: 0,
      yPosition: TEXT_Y,
      width: textWidth,
      height: DISPLAY_HEIGHT - TEXT_Y,
      containerID: CONTAINER_ID_TEXT,
      containerName: CONTAINER_NAME_TEXT,
      content: getCombinedDisplayText(state),
      isEventCapture: VISIBLE_EVENT_CAPTURE,
    }),
  );

  imageObjects.push(
    new ImageContainerProperty({
      xPosition: boardX,
      yPosition: boardTopY,
      width: imageWidth,
      height: imageHeight,
      containerID: CONTAINER_ID_IMAGE_TOP,
      containerName: CONTAINER_NAME_IMAGE_TOP,
    }),
  );

  imageObjects.push(
    new ImageContainerProperty({
      xPosition: boardX,
      yPosition: boardTopY + imageHeight,
      width: imageWidth,
      height: imageHeight,
      containerID: CONTAINER_ID_IMAGE_BOTTOM,
      containerName: CONTAINER_NAME_IMAGE_BOTTOM,
    }),
  );

  // Brand container, repurposed as the captured-pieces strip directly above the board:
  // same x/width as the board, filling the gap between the top of the display and the
  // board. Renders the brand mark + captured silhouettes (and the CHECK!/CHECKMATE!
  // banner). Only placed when the gap can fit it.
  if (boardTopY >= BRAND_HEIGHT + 2) {
    imageObjects.push(
      new ImageContainerProperty({
        xPosition: boardX,
        yPosition: boardTopY - BRAND_HEIGHT,
        width: imageWidth,
        height: BRAND_HEIGHT,
        containerID: CONTAINER_ID_BRAND,
        containerName: CONTAINER_NAME_BRAND,
      }),
    );
  }

  const totalNum = textObjects.length + imageObjects.length;
  return { totalNum, textObjects, imageObjects };
}

export {
  CONTAINER_ID_TEXT,
  CONTAINER_NAME_TEXT,
  CONTAINER_ID_IMAGE_TOP,
  CONTAINER_ID_IMAGE_BOTTOM,
  CONTAINER_ID_BRAND,
  CONTAINER_NAME_IMAGE_TOP,
  CONTAINER_NAME_IMAGE_BOTTOM,
  CONTAINER_NAME_BRAND,
  SMALL_IMAGE_WIDTH as IMAGE_WIDTH,
  SMALL_IMAGE_HEIGHT as IMAGE_HEIGHT,
  BRAND_WIDTH,
  BRAND_HEIGHT,
};
