/**
 * Square notation utilities.
 * File indices: 0-7 (a-h), Rank indices: 0-7 (1-8)
 */

export const FILES = 'abcdefgh';
export const RANKS = '12345678';

export function getFileIndex(square: string): number {
  const char = square[0];
  return char ? FILES.indexOf(char.toLowerCase()) : -1;
}

export function getRankIndex(square: string): number {
  const char = square[1];
  return char ? RANKS.indexOf(char) : -1;
}

/** Chess rank number 1..8 from a square like "f3" → 3. */
export function rankOfSquare(square: string): number {
  return parseInt(square[1] ?? '1', 10);
}

export function squareToIndices(square: string): [number, number] {
  return [getFileIndex(square), getRankIndex(square)];
}

/**
 * Chess rank (1..8) → display row (0..7), perspective-aware.
 * White at bottom: rank 8 → row 0 (top). Black at bottom (flipped 180°): rank 1 → row 0.
 */
export function rankToDisplayRank(rank: number, playerColor: 'w' | 'b' = 'w'): number {
  return playerColor === 'b' ? rank - 1 : 8 - rank;
}

// Display coords for a square; flips both file and rank 180° when the human plays Black.
export function squareToDisplayCoords(
  square: string,
  playerColor: 'w' | 'b' = 'w',
): { file: number; displayRank: number } {
  const file = getFileIndex(square);
  const rank = parseInt(square[1] ?? '1', 10);
  return playerColor === 'b'
    ? { file: 7 - file, displayRank: rank - 1 }
    : { file, displayRank: 8 - rank };
}

export function indicesToSquare(file: number, rank: number): string {
  return `${FILES[file]}${RANKS[rank]}`;
}

export const fileRankToSquare = indicesToSquare;

export function getFileLetter(file: number): string {
  return FILES[file] ?? 'a';
}

export function getRankNumber(rank: number): number {
  return rank + 1;
}

export function isValidIndices(file: number, rank: number): boolean {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

export function isValidSquare(square: string): boolean {
  if (square.length !== 2) return false;
  const [file, rank] = squareToIndices(square);
  return isValidIndices(file, rank);
}
