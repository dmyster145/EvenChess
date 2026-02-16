import { describe, it, expect } from 'vitest';
import { StockfishBridge } from '../../src/engine/stockfishbridge';
import { CASUAL } from '../../src/engine/profiles';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const UCI_MOVE_REGEX = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

describe('StockfishBridge', () => {
  describe('fallback when worker not used', () => {
    it('returns a valid UCI move from fallback when init() was not called', async () => {
      const bridge = new StockfishBridge();
      // Do not call init() — worker stays null, so getBestMove uses fallback.
      const move = await bridge.getBestMove(STARTING_FEN, CASUAL);
      bridge.destroy();

      expect(move).not.toBeNull();
      expect(move).toMatch(UCI_MOVE_REGEX);
    });
  });
});
