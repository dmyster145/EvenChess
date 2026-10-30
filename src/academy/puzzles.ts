/**
 * Academy puzzle sets (reveal-only: tapping shows the solution).
 *
 * Every position and solution is checked by tests/academy/puzzles.test.ts with chess.js: legal
 * positions, legal solution moves, mates that really mate, and tactics that really win material
 * against every reply.
 */

import { Chess } from 'chess.js';
import type { TacticsPuzzle } from '../state/contracts';

export const TACTICS_PUZZLES: TacticsPuzzle[] = [
  // ── Forks ─────────────────────────────────────────────────────────────
  {
    fen: 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1',
    solution: ['b5c7'],
    theme: 'fork',
    description: 'Knight checks the king and attacks the rook',
  },
  {
    fen: '6k1/5ppp/2q5/3N4/8/8/5PPP/6K1 w - - 0 1',
    solution: ['d5e7'],
    theme: 'fork',
    description: 'Knight checks the king and attacks the queen',
  },
  {
    fen: '4k3/8/3b1n2/8/3PP3/8/8/6K1 w - - 0 1',
    solution: ['e4e5'],
    theme: 'fork',
    description: 'Pawn forks bishop and knight',
  },
  {
    fen: 'r5k1/8/8/8/8/8/8/3Q2K1 w - - 0 1',
    solution: ['d1d5'],
    theme: 'fork',
    description: 'Queen checks the king and attacks the rook',
  },
  // ── Pins ──────────────────────────────────────────────────────────────
  {
    fen: '4k3/8/8/4q3/8/8/8/R4K2 w - - 0 1',
    solution: ['a1e1'],
    theme: 'pin',
    description: 'Rook pins the queen to the king',
  },
  {
    fen: 'k7/1r6/8/8/8/8/2B5/6K1 w - - 0 1',
    solution: ['c2e4'],
    theme: 'pin',
    description: 'Bishop pins the rook to the king',
  },
  // ── Skewers ───────────────────────────────────────────────────────────
  {
    fen: '8/8/8/3k3r/8/8/8/R5K1 w - - 0 1',
    solution: ['a1a5'],
    theme: 'skewer',
    description: 'Rook check skewers the king and rook',
  },
  {
    fen: '6q1/8/8/3k4/8/8/8/3B3K w - - 0 1',
    solution: ['d1b3'],
    theme: 'skewer',
    description: 'Bishop check skewers the king and queen',
  },
  // ── Discovered attacks ────────────────────────────────────────────────
  {
    fen: '4k3/8/8/7q/4N3/8/8/4R1K1 w - - 0 1',
    solution: ['e4f6'],
    theme: 'discovered',
    description: 'Double check, then the knight takes the queen',
  },
  {
    fen: '3q2k1/7p/8/8/8/3B4/8/3Q2K1 w - - 0 1',
    solution: ['d3h7'],
    theme: 'discovered',
    description: 'Bishop check uncovers the queen on d8',
  },
  // ── Back-rank mates ───────────────────────────────────────────────────
  {
    fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
    solution: ['e1e8'],
    theme: 'backRank',
    description: 'Back rank mate in one',
  },
  {
    fen: '4r1k1/5ppp/8/8/8/8/4QPPP/4R1K1 w - - 0 1',
    solution: ['e2e8'],
    theme: 'backRank',
    description: 'Queen takes the rook with mate',
  },
  {
    fen: '3r2k1/5ppp/8/8/8/8/5PPP/3RR1K1 w - - 0 1',
    solution: ['d1d8'],
    theme: 'backRank',
    description: 'Double rook back rank mate',
  },
];

export const MATE_PUZZLES: TacticsPuzzle[] = [
  {
    fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
    solution: ['e1e8'],
    theme: 'mate',
    description: 'Rook back rank mate',
  },
  {
    fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
    solution: ['a1a8'],
    theme: 'mate',
    description: 'Rook delivers back rank mate',
  },
  {
    fen: '6k1/5ppp/8/8/8/8/8/Q5K1 w - - 0 1',
    solution: ['a1a8'],
    theme: 'mate',
    description: 'Queen back rank mate',
  },
  {
    fen: '6k1/5ppp/8/8/8/8/8/4Q1K1 w - - 0 1',
    solution: ['e1e8'],
    theme: 'mate',
    description: 'Queen mates on e8',
  },
  {
    fen: '6k1/R7/8/8/8/8/8/1R4K1 w - - 0 1',
    solution: ['b1b8'],
    theme: 'mate',
    description: 'Rook ladder mate',
  },
  {
    fen: '7k/R7/8/8/8/8/8/1R4K1 w - - 0 1',
    solution: ['b1b8'],
    theme: 'mate',
    description: 'Double rook mate',
  },
  {
    fen: '7k/8/5N2/8/5K2/8/8/6R1 w - - 0 1',
    solution: ['g1g8'],
    theme: 'mate',
    description: 'Arabian mate',
  },
  {
    fen: '5k2/5P2/5K2/8/8/8/8/7Q w - - 0 1',
    solution: ['h1h8'],
    theme: 'mate',
    description: 'Queen and pawn mate',
  },
  {
    fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1',
    solution: ['h5f7'],
    theme: 'mate',
    description: "Scholar's mate",
  },
  {
    fen: '6k1/5ppp/8/8/8/8/8/3Q2K1 w - - 0 1',
    solution: ['d1d8'],
    theme: 'mate',
    description: 'Corridor mate',
  },
  {
    fen: '5k2/8/4BK2/8/8/8/8/7Q w - - 0 1',
    solution: ['h1h8'],
    theme: 'mate',
    description: 'Queen and bishop mate',
  },
  {
    fen: '1k6/1B6/1K6/8/8/8/8/R7 w - - 0 1',
    solution: ['a1a8'],
    theme: 'mate',
    description: 'Opera mate',
  },
  {
    fen: '7k/5Q1p/8/8/8/8/8/6K1 w - - 0 1',
    solution: ['f7f8'],
    theme: 'mate',
    description: 'Triangle mate',
  },
];

export function getRandomTacticsPuzzle(): TacticsPuzzle {
  const idx = Math.floor(Math.random() * TACTICS_PUZZLES.length);
  return TACTICS_PUZZLES[idx] ?? TACTICS_PUZZLES[0]!;
}

export function getRandomMatePuzzle(): TacticsPuzzle {
  const idx = Math.floor(Math.random() * MATE_PUZZLES.length);
  return MATE_PUZZLES[idx] ?? MATE_PUZZLES[0]!;
}

const PIECE_NAMES: Record<string, string> = { k: 'King', q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight', p: 'Pawn' };

/**
 * The solution as readable steps, e.g. ["Knight B5 → C7 check", "Rook takes …"]. Every move of the
 * line is shown, not just the first. Stops early if a move is illegal (tests keep that from
 * happening).
 */
export function describeSolution(puzzle: TacticsPuzzle): string[] {
  const chess = new Chess(puzzle.fen);
  const steps: string[] = [];
  for (const uci of puzzle.solution) {
    let move;
    try {
      move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    const verb = move.captured ? ' takes ' : ' → ';
    const suffix = chess.isCheckmate() ? ' mate' : chess.inCheck() ? ' check' : '';
    steps.push(`${PIECE_NAMES[move.piece]} ${move.from.toUpperCase()}${verb}${move.to.toUpperCase()}${suffix}`);
  }
  return steps;
}
