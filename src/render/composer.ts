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

const CONTAINER_ID_TEXT = 1;
const CONTAINER_ID_IMAGE_TOP = 2;
const CONTAINER_ID_IMAGE_BOTTOM = 3;
const CONTAINER_ID_BRAND = 4;

const CONTAINER_NAME_TEXT = 'chess-hud';
const CONTAINER_NAME_IMAGE_TOP = 'board-top';
const CONTAINER_NAME_IMAGE_BOTTOM = 'board-bot';
const CONTAINER_NAME_BRAND = 'brand';

// Shared constants (unchanged across layouts)
const DISPLAY_HEIGHT = 288;
const BRAND_WIDTH = 200;
const BRAND_HEIGHT = 24;

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

/**
 * Startup layout with text + optional brand only (full-width text, no board image slots).
 * Used for text-first BLE bring-up; `upgradeToFullLayout` later calls `composePageForState`.
 */
function buildTextOnlyContainers(state: GameState): ContainerSet {
  const TEXT_Y = BRAND_HEIGHT + 20 + 4;
  const textWidth = DISPLAY_WIDTH;

  const textObjects: TextContainerProperty[] = [
    new TextContainerProperty({
      xPosition: 0,
      yPosition: TEXT_Y,
      width: textWidth,
      height: DISPLAY_HEIGHT - TEXT_Y,
      containerID: CONTAINER_ID_TEXT,
      containerName: CONTAINER_NAME_TEXT,
      content: getCombinedDisplayText(state),
      isEventCapture: 1,
    }),
  ];

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

  const TEXT_Y = BRAND_HEIGHT + 20 + 4; // below brand container (yPosition=20, height=24) + small gap
  textObjects.push(
    new TextContainerProperty({
      xPosition: 0,
      yPosition: TEXT_Y,
      width: textWidth,
      height: DISPLAY_HEIGHT - TEXT_Y,
      containerID: CONTAINER_ID_TEXT,
      containerName: CONTAINER_NAME_TEXT,
      content: getCombinedDisplayText(state),
      isEventCapture: 1,
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

  // Brand: centered within the text container (0 to textWidth). Omit if it doesn't fit.
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
