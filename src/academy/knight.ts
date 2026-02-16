/**
 * Knight Path Challenge — BFS pathfinding and puzzle generation.
 */

import {
  squareToIndices,
  indicesToSquare,
  isValidIndices,
} from '../chess/square-utils';

const KNIGHT_MOVES: [number, number][] = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];

export function getKnightMoves(square: string): string[] {
  const [file, rank] = squareToIndices(square);
  const moves: string[] = [];

  for (const [df, dr] of KNIGHT_MOVES) {
    const newFile = file + df;
    const newRank = rank + dr;
    if (isValidIndices(newFile, newRank)) {
      moves.push(indicesToSquare(newFile, newRank));
    }
  }

  return moves;
}

export function findKnightDistance(start: string, end: string): number {
  if (start === end) return 0;

  const visited = new Set<string>();
  const queue: { square: string; distance: number }[] = [{ square: start, distance: 0 }];
  visited.add(start);

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const next of getKnightMoves(current.square)) {
      if (next === end) {
        return current.distance + 1;
      }

      if (!visited.has(next)) {
        visited.add(next);
        queue.push({ square: next, distance: current.distance + 1 });
      }
    }
  }

  return -1;
}

export function generateKnightPuzzle(minMoves = 2, maxMoves = 4): {
  start: string;
  target: string;
  optimalMoves: number;
} {
  let attempts = 0;
  const maxAttempts = 100;

  while (attempts < maxAttempts) {
    attempts++;

    // Generate random start and target squares
    const startFile = Math.floor(Math.random() * 8);
    const startRank = Math.floor(Math.random() * 8);
    const targetFile = Math.floor(Math.random() * 8);
    const targetRank = Math.floor(Math.random() * 8);

    const start = indicesToSquare(startFile, startRank);
    const target = indicesToSquare(targetFile, targetRank);

    if (start === target) continue;

    const distance = findKnightDistance(start, target);

    if (distance >= minMoves && distance <= maxMoves) {
      return { start, target, optimalMoves: distance };
    }
  }

  return { start: 'a1', target: 'c5', optimalMoves: 3 };
}

export function isValidKnightMove(from: string, to: string): boolean {
  const validMoves = getKnightMoves(from);
  return validMoves.includes(to.toLowerCase());
}

export function getSquareIndices(square: string): { file: number; rank: number } {
  const [file, rank] = squareToIndices(square);
  return { file, rank };
}
