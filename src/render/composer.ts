/**
 * Page Composer — translates GameState into Even Hub SDK container configs.
 * 2-column layout: text on left, board on right (split into 2 image containers).
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

// G2 display: 576×288, image containers limited to 200×100
const DISPLAY_HEIGHT = 288;
const IMAGE_WIDTH = 200;
const IMAGE_HEIGHT = 100;
const RIGHT_X = 376;
const LEFT_WIDTH = 368;
const BRAND_WIDTH = 200;
const BRAND_HEIGHT = 24;

// ---------------------------------------------------------------------------

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
  const textObjects: TextContainerProperty[] = [];
  const imageObjects: ImageContainerProperty[] = [];

  textObjects.push(
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: LEFT_WIDTH,
      height: DISPLAY_HEIGHT,
      containerID: CONTAINER_ID_TEXT,
      containerName: CONTAINER_NAME_TEXT,
      content: getCombinedDisplayText(state),
      isEventCapture: 1,
    }),
  );

  // Vertically center the 200px board in 288px display
  const boardTopY = Math.floor((DISPLAY_HEIGHT - IMAGE_HEIGHT * 2) / 2);
  imageObjects.push(
    new ImageContainerProperty({
      xPosition: RIGHT_X,
      yPosition: boardTopY,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      containerID: CONTAINER_ID_IMAGE_TOP,
      containerName: CONTAINER_NAME_IMAGE_TOP,
    }),
  );

  imageObjects.push(
    new ImageContainerProperty({
      xPosition: RIGHT_X,
      yPosition: boardTopY + IMAGE_HEIGHT,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      containerID: CONTAINER_ID_IMAGE_BOTTOM,
      containerName: CONTAINER_NAME_IMAGE_BOTTOM,
    }),
  );

  const brandX = Math.floor((DISPLAY_WIDTH - BRAND_WIDTH) / 2);
  imageObjects.push(
    new ImageContainerProperty({
      xPosition: brandX,
      yPosition: 4,
      width: BRAND_WIDTH,
      height: BRAND_HEIGHT,
      containerID: CONTAINER_ID_BRAND,
      containerName: CONTAINER_NAME_BRAND,
    }),
  );

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
  IMAGE_WIDTH,
  IMAGE_HEIGHT,
  BRAND_WIDTH,
  BRAND_HEIGHT,
};
