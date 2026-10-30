/**
 * PGN Study: famous games, stepped through move by move. Every game's moves are replayed with
 * chess.js in tests/academy/pgn.test.ts. The players/year/event/opening fields are reference
 * data for each game (not currently shown on the glasses).
 */

export interface PgnGame {
  name: string;
  white: string;
  black: string;
  year?: number;
  event?: string;
  opening?: string;
  moves: string[]; // SAN notation, from the standard starting position
}

export const FAMOUS_GAMES: PgnGame[] = [
  {
    name: 'Opera Game',
    white: 'Paul Morphy',
    black: 'Duke of Brunswick & Count Isouard',
    year: 1858,
    event: 'Paris Opera House',
    opening: 'Philidor Defense',
    moves: [
      'e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3',
      'Qxf3', 'dxe5', 'Bc4', 'Nf6', 'Qb3', 'Qe7', 'Nc3', 'c6',
      'Bg5', 'b5', 'Nxb5', 'cxb5', 'Bxb5+', 'Nbd7', 'O-O-O', 'Rd8',
      'Rxd7', 'Rxd7', 'Rd1', 'Qe6', 'Bxd7+', 'Nxd7', 'Qb8+', 'Nxb8',
      'Rd8#'
    ],
  },
  {
    name: 'Immortal Game',
    white: 'Adolf Anderssen',
    black: 'Lionel Kieseritzky',
    year: 1851,
    event: 'London',
    opening: 'King\'s Gambit',
    moves: [
      'e4', 'e5', 'f4', 'exf4', 'Bc4', 'Qh4+', 'Kf1', 'b5',
      'Bxb5', 'Nf6', 'Nf3', 'Qh6', 'd3', 'Nh5', 'Nh4', 'Qg5',
      'Nf5', 'c6', 'g4', 'Nf6', 'Rg1', 'cxb5', 'h4', 'Qg6',
      'h5', 'Qg5', 'Qf3', 'Ng8', 'Bxf4', 'Qf6', 'Nc3', 'Bc5',
      'Nd5', 'Qxb2', 'Bd6', 'Bxg1', 'e5', 'Qxa1+', 'Ke2', 'Na6',
      'Nxg7+', 'Kd8', 'Qf6+', 'Nxf6', 'Be7#'
    ],
  },
  {
    name: 'Evergreen Game',
    white: 'Adolf Anderssen',
    black: 'Jean Dufresne',
    year: 1852,
    event: 'Berlin',
    opening: 'Italian Game',
    moves: [
      'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4', 'Bxb4',
      'c3', 'Ba5', 'd4', 'exd4', 'O-O', 'd3', 'Qb3', 'Qf6',
      'e5', 'Qg6', 'Re1', 'Nge7', 'Ba3', 'b5', 'Qxb5', 'Rb8',
      'Qa4', 'Bb6', 'Nbd2', 'Bb7', 'Ne4', 'Qf5', 'Bxd3', 'Qh5',
      'Nf6+', 'gxf6', 'exf6', 'Rg8', 'Rad1', 'Qxf3', 'Rxe7+', 'Nxe7',
      'Qxd7+', 'Kxd7', 'Bf5+', 'Ke8', 'Bd7+', 'Kf8', 'Bxe7#'
    ],
  },
  {
    name: 'Game of the Century',
    white: 'Donald Byrne',
    black: 'Bobby Fischer',
    year: 1956,
    event: 'New York',
    opening: 'Grünfeld Defense',
    moves: [
      'Nf3', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'd4', 'O-O',
      'Bf4', 'd5', 'Qb3', 'dxc4', 'Qxc4', 'c6', 'e4', 'Nbd7',
      'Rd1', 'Nb6', 'Qc5', 'Bg4', 'Bg5', 'Na4', 'Qa3', 'Nxc3',
      'bxc3', 'Nxe4', 'Bxe7', 'Qb6', 'Bc4', 'Nxc3', 'Bc5', 'Rfe8+',
      'Kf1', 'Be6', 'Bxb6', 'Bxc4+', 'Kg1', 'Ne2+', 'Kf1', 'Nxd4+',
      'Kg1', 'Ne2+', 'Kf1', 'Nc3+', 'Kg1', 'axb6', 'Qb4', 'Ra4',
      'Qxb6', 'Nxd1', 'h3', 'Rxa2', 'Kh2', 'Nxf2', 'Re1', 'Rxe1',
      'Qd8+', 'Bf8', 'Nxe1', 'Bd5', 'Nf3', 'Ne4', 'Qb8', 'b5',
      'h4', 'h5', 'Ne5', 'Kg7', 'Kg1', 'Bc5+', 'Kf1', 'Ng3+',
      'Ke1', 'Bb4+', 'Kd1', 'Bb3+', 'Kc1', 'Ne2+', 'Kb1', 'Nc3+',
      'Kc1', 'Rc2#'
    ],
  },
];

export function getRandomFamousGame(): PgnGame {
  const idx = Math.floor(Math.random() * FAMOUS_GAMES.length);
  return FAMOUS_GAMES[idx] ?? FAMOUS_GAMES[0]!;
}
