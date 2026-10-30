/**
 * Puzzle correctness, checked with chess.js: every position is legal, every solution move is
 * legal, mates really mate, and every non-mate tactic really wins material against any reply.
 */

import { describe, it, expect } from 'vitest';
import { Chess, validateFen } from 'chess.js';
import { TACTICS_PUZZLES, MATE_PUZZLES } from '../../src/academy/puzzles';
import type { TacticsPuzzle } from '../../src/state/contracts';

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Play the solution; throws (fails the test) if any move is illegal. */
function playSolution(puzzle: TacticsPuzzle): Chess {
  const chess = new Chess(puzzle.fen);
  for (const uci of puzzle.solution) {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  }
  return chess;
}

/** The side NOT to move must not be in check (otherwise the position can't arise). */
function opponentInCheck(fen: string): boolean {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  return new Chess(parts.join(' ')).inCheck();
}

/**
 * The material the solving side is guaranteed to win: for each opponent reply, the most valuable
 * piece the solver can then capture; the minimum over all replies.
 */
function guaranteedCapture(afterSolution: Chess): number {
  const replies = afterSolution.moves();
  return Math.min(...replies.map((reply) => {
    const c = new Chess(afterSolution.fen());
    c.move(reply);
    const captures = c.moves({ verbose: true }).filter((m) => m.captured);
    return Math.max(0, ...captures.map((m) => VALUE[m.captured!]!));
  }));
}

function checkPosition(puzzle: TacticsPuzzle): void {
  expect(validateFen(puzzle.fen).ok).toBe(true);
  expect(opponentInCheck(puzzle.fen)).toBe(false);
  const start = new Chess(puzzle.fen);
  expect(start.isGameOver()).toBe(false);
  expect(start.inCheck()).toBe(false); // the solver isn't already answering a check
}

describe('MATE_PUZZLES', () => {
  it.each(MATE_PUZZLES.map((p) => [p.description, p] as const))('%s: legal, one move, and it mates', (_d, puzzle) => {
    checkPosition(puzzle);
    expect(puzzle.solution).toHaveLength(1);
    expect(playSolution(puzzle).isCheckmate()).toBe(true);
  });
});

describe('TACTICS_PUZZLES', () => {
  it.each(TACTICS_PUZZLES.map((p) => [p.description, p] as const))('%s: legal and the solution works', (_d, puzzle) => {
    checkPosition(puzzle);
    const after = playSolution(puzzle);
    if (puzzle.theme === 'backRank') {
      expect(after.isCheckmate()).toBe(true);
    } else {
      // Whatever the opponent replies, at least a minor piece is won next move.
      expect(guaranteedCapture(after)).toBeGreaterThanOrEqual(3);
    }
  });

  it('covers every theme', () => {
    expect(new Set(TACTICS_PUZZLES.map((p) => p.theme))).toEqual(new Set(['fork', 'pin', 'skewer', 'discovered', 'backRank']));
  });
});
