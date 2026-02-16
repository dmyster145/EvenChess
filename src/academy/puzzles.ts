/**
 * Tactics puzzle database.
 */

import type { TacticsPuzzle } from '../state/contracts';

export const TACTICS_PUZZLES: TacticsPuzzle[] = [
  {
    fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
    solution: ['h5f7'],
    theme: 'fork',
    description: 'Scholar\'s mate threat - fork king and rook',
  },
  {
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    solution: ['f3g5'],
    theme: 'fork',
    description: 'Knight attacks f7 and threatens fork',
  },
  {
    fen: 'r2qkb1r/ppp2ppp/2n1bn2/3pp3/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 0 6',
    solution: ['e4d5', 'e6d5', 'f3e5'],
    theme: 'fork',
    description: 'Knight fork wins material',
  },
  {
    fen: 'r1b1kb1r/pppp1ppp/2n2n2/4N3/2B1P2q/8/PPPP1PPP/RNBQK2R w KQkq - 0 5',
    solution: ['e5f7'],
    theme: 'fork',
    description: 'Knight forks king and rook',
  },
  {
    fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 5',
    solution: ['c4f7'],
    theme: 'fork',
    description: 'Bishop sacrifice leads to fork',
  },
  {
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    solution: ['f1b5'],
    theme: 'pin',
    description: 'Pin the knight to the king',
  },
  {
    fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    solution: ['c4f7'],
    theme: 'pin',
    description: 'Attack the pinned f7 pawn',
  },
  {
    // White's knight is pinned to queen. h3 attacks the bishop to break the pin.
    fen: 'r2qkbnr/ppp2ppp/2np4/4p3/2B1P1b1/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5',
    solution: ['h2h3'],
    theme: 'pin',
    description: 'Break the pin by attacking the bishop',
  },
  {
    fen: 'r1bqk2r/pppp1ppp/2n2n2/4p1B1/1b2P3/2N2N2/PPPP1PPP/R2QKB1R b KQkq - 5 5',
    solution: ['b4c3'],
    theme: 'pin',
    description: 'Take the pinned knight',
  },
  {
    fen: 'r1b1k2r/ppppqppp/2n2n2/4p1B1/1b2P3/2NP1N2/PPP2PPP/R2QKB1R w KQkq - 0 6',
    solution: ['g5f6'],
    theme: 'pin',
    description: 'Capture with the pinning piece',
  },
  {
    fen: '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1',
    solution: ['e2e8'],
    theme: 'skewer',
    description: 'Rook skewer wins the king',
  },
  {
    fen: 'r3k3/8/8/8/8/8/8/R3K3 w Qq - 0 1',
    solution: ['a1a8'],
    theme: 'skewer',
    description: 'Rook skewer wins the rook',
  },
  {
    fen: '6k1/5ppp/8/8/2B5/8/5PPP/6K1 w - - 0 1',
    solution: ['c4e6'],
    theme: 'skewer',
    description: 'Bishop skewer threatens pawn',
  },
  {
    fen: 'r1bqkbnr/pppp1ppp/2n5/4N3/4P3/8/PPPP1PPP/RNBQKB1R b KQkq - 0 3',
    solution: ['c6e5'],
    theme: 'discovered',
    description: 'Discovered attack on queen',
  },
  {
    fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1N3/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 0 5',
    solution: ['e5d7'],
    theme: 'discovered',
    description: 'Knight moves with discovered attack',
  },
  {
    fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
    solution: ['e1e8'],
    theme: 'backRank',
    description: 'Back rank mate in one',
  },
  {
    fen: 'r4rk1/5ppp/8/8/8/8/5PPP/R4RK1 w - - 0 1',
    solution: ['a1a8'],
    theme: 'backRank',
    description: 'Rook takes with back rank threat',
  },
  {
    fen: '3r2k1/5ppp/8/8/8/8/5PPP/3RR1K1 w - - 0 1',
    solution: ['e1e8'],
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
    description: "Lolli's mate",
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
    description: "Max Lange's mate",
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
  const mateIn1 = MATE_PUZZLES.filter(p => p.solution.length === 1);
  const idx = Math.floor(Math.random() * mateIn1.length);
  return mateIn1[idx] ?? MATE_PUZZLES[0]!;
}

export function checkTacticsAnswer(puzzle: TacticsPuzzle, move: string, moveIndex: number): boolean {
  const expectedMove = puzzle.solution[moveIndex];
  if (!expectedMove) return false;
  return move.toLowerCase() === expectedMove.toLowerCase();
}

export function uciToReadable(uci: string): string {
  if (uci.length < 4) return uci;
  const from = uci.slice(0, 2).toUpperCase();
  const to = uci.slice(2, 4).toUpperCase();
  const promo = uci.length > 4 ? `=${uci[4]?.toUpperCase()}` : '';
  return `${from}-${to}${promo}`;
}
