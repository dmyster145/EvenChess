import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { FAMOUS_GAMES } from '../../src/academy/pgn';

describe('FAMOUS_GAMES', () => {
  it.each(FAMOUS_GAMES.map((g) => [g.name, g] as const))('%s replays legally from the start position', (_name, game) => {
    const chess = new Chess();
    for (const san of game.moves) {
      expect(() => chess.move(san), `${game.name}: ${san} after ${chess.history().join(' ')}`).not.toThrow();
    }
    expect(game.moves.length).toBeGreaterThan(0);
  });
});
