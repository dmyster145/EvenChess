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

export function squareToIndices(square: string): [number, number] {
  return [getFileIndex(square), getRankIndex(square)];
}

// Display rank is inverted for top-to-bottom rendering
export function squareToDisplayCoords(square: string): { file: number; displayRank: number } {
  return {
    file: getFileIndex(square),
    displayRank: 8 - parseInt(square[1] ?? '1', 10),
  };
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
