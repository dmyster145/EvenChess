/**
 * Academy mode drill logic.
 */

import type { DrillNavAxis } from '../state/contracts';
import {
  FILES,
  RANKS,
  getFileIndex,
  getRankIndex,
  fileRankToSquare,
  getFileLetter,
  getRankNumber as getRankNum,
} from '../chess/square-utils';

export { getFileIndex, getRankIndex, fileRankToSquare, getFileLetter };

export function generateRandomSquare(): string {
  const file = FILES[Math.floor(Math.random() * 8)];
  const rank = RANKS[Math.floor(Math.random() * 8)];
  return `${file}${rank}`;
}

export function checkCoordinateAnswer(target: string, guess: string): boolean {
  return target.toLowerCase() === guess.toLowerCase();
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

export function getRankNumber(rank: number): string {
  if (rank < 0 || rank > 7) return '1';
  return String(getRankNum(rank));
}
