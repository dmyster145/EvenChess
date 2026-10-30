import { describe, it, expect } from 'vitest';
import {
  BACKGROUND_STATE_VERSION,
  buildBackgroundSnapshot,
  restoreFromBackgroundSnapshot,
} from '../../src/app/background-snapshot';
import { ChessService } from '../../src/chess/chessservice';
import { baseGameState } from '../helpers/game-state';

/** A bullet game three plies in, with the engine (Black) to move. */
function midGameBullet() {
  const chess = new ChessService();
  chess.makeMove('e2', 'e4');
  chess.makeMove('e7', 'e5');
  chess.makeMove('g1', 'f3');
  return {
    ...baseGameState(),
    fen: chess.getFen(),
    turn: 'b' as const,
    history: ['e4', 'e5', 'Nf3'],
    mode: 'bullet' as const,
    timers: { whiteMs: 41000, blackMs: 52000, incrementMs: 2000 },
    timerActive: true,
    lastTickTime: 123,
    selectedTimeControlIndex: 3,
    boardPosition: 'top' as const,
  };
}

describe('background snapshot', () => {
  it('a round trip keeps the move history, mode, clocks, and settings', () => {
    const before = midGameBullet();
    const chess = new ChessService();
    const after = restoreFromBackgroundSnapshot(buildBackgroundSnapshot(before), chess);
    expect(after).not.toBeNull();
    expect(after!.fen).toBe(before.fen);
    expect(after!.history).toEqual(['e4', 'e5', 'Nf3']);
    expect(after!.lastMove).toBe('Nf3');
    expect(after!.mode).toBe('bullet');
    expect(after!.timers).toEqual(before.timers);
    expect(after!.selectedTimeControlIndex).toBe(3);
    expect(after!.boardPosition).toBe('top');
    expect(chess.getFen()).toBe(before.fen); // position loaded into the chess service
  });

  it('restores with the bullet clock stopped, so migration time is never charged', () => {
    const after = restoreFromBackgroundSnapshot(buildBackgroundSnapshot(midGameBullet()), new ChessService());
    expect(after!.timerActive).toBe(false);
    expect(after!.lastTickTime).toBeNull();
  });

  it('an older snapshot without history restores the position with an empty log', () => {
    const snap = { ...buildBackgroundSnapshot(midGameBullet()), history: undefined, mode: undefined, timers: undefined };
    const after = restoreFromBackgroundSnapshot(snap, new ChessService());
    expect(after!.history).toEqual([]);
    expect(after!.mode).toBe('play');
    expect(after!.timers).toBeUndefined();
  });

  it('drops malformed history and timers instead of restoring garbage', () => {
    const snap = { ...buildBackgroundSnapshot(midGameBullet()), history: ['e4', 7], timers: { whiteMs: 'x' } };
    const after = restoreFromBackgroundSnapshot(snap, new ChessService());
    expect(after!.history).toEqual([]);
    expect(after!.timers).toBeUndefined();
  });

  it.each([
    ['nothing', undefined],
    ['another version', { ...buildBackgroundSnapshot(midGameBullet()), version: BACKGROUND_STATE_VERSION + 1 }],
    ['an unloadable position', { ...buildBackgroundSnapshot(midGameBullet()), fen: 'not a fen' }],
  ])('returns null for %s', (_what, snap) => {
    expect(restoreFromBackgroundSnapshot(snap, new ChessService())).toBeNull();
  });
});
