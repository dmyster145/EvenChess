/**
 * Coordinate drill logic. Square helpers live in chess/square-utils.
 */

import type { DrillNavAxis } from '../state/contracts';
import { FILES, RANKS } from '../chess/square-utils';

export function generateRandomSquare(): string {
  const file = FILES[Math.floor(Math.random() * 8)];
  const rank = RANKS[Math.floor(Math.random() * 8)];
  return `${file}${rank}`;
}

export function moveFile(file: number, direction: 'up' | 'down'): number {
  return direction === 'up' ? (file + 1) % 8 : (file - 1 + 8) % 8;
}

export function moveRank(rank: number, direction: 'up' | 'down'): number {
  return direction === 'up' ? (rank + 1) % 8 : (rank - 1 + 8) % 8;
}

export function moveCursorAxis(
  file: number,
  rank: number,
  axis: DrillNavAxis,
  direction: 'up' | 'down'
): { file: number; rank: number } {
  if (axis === 'file') {
    return { file: moveFile(file, direction), rank };
  } else {
    return { file, rank: moveRank(rank, direction) };
  }
}

export function getDefaultCursorPosition(): { file: number; rank: number } {
  return { file: 4, rank: 3 };
}
