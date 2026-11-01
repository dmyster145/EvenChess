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

  it('a game in progress restores with no result', () => {
    expect(restoreFromBackgroundSnapshot(buildBackgroundSnapshot(midGameBullet()), new ChessService())!.gameOver).toBeNull();
  });

  it('a finished game keeps its result through the round trip', () => {
    const before = { ...midGameBullet(), gameOver: 'Draw by agreement (test)' };
    expect(restoreFromBackgroundSnapshot(buildBackgroundSnapshot(before), new ChessService())!.gameOver).toBe('Draw by agreement (test)');
  });

  // Snapshots written before gameOver was kept: the result is worked out instead of coming back
  // as a dead board (mate) or a live game (flag fall).
  it('an older snapshot of a mated position comes back as checkmate', () => {
    const chess = new ChessService();
    for (const [f, t] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']] as const) chess.makeMove(f, t);
    const snap = { ...buildBackgroundSnapshot({ ...midGameBullet(), fen: chess.getFen(), turn: 'w' as const }), gameOver: undefined };
    expect(restoreFromBackgroundSnapshot(snap, new ChessService())!.gameOver).toBe('checkmate');
  });

  it.each([
    [{ whiteMs: 0, blackMs: 5000, incrementMs: 0 }, 'Black wins on time!'],
    [{ whiteMs: 5000, blackMs: 0, incrementMs: 0 }, 'White wins on time!'],
  ])('an older bullet snapshot with a clock at zero comes back lost on time', (timers, result) => {
    const snap = { ...buildBackgroundSnapshot({ ...midGameBullet(), timers }), gameOver: undefined };
    expect(restoreFromBackgroundSnapshot(snap, new ChessService())!.gameOver).toBe(result);
  });

  it('a newer snapshot of a live game never invents a loss on time from a clock at zero', () => {
    const before = { ...midGameBullet(), timers: { whiteMs: 0, blackMs: 5000, incrementMs: 0 } };
    expect(restoreFromBackgroundSnapshot(buildBackgroundSnapshot(before), new ChessService())!.gameOver).toBeNull();
  });

  it('out-of-range picker values in a snapshot fall back to the defaults', () => {
    const fresh = restoreFromBackgroundSnapshot(buildBackgroundSnapshot(baseGameState()), new ChessService())!;
    const snap = { ...buildBackgroundSnapshot(midGameBullet()), customSkillLevel: 42, selectedTimeControlIndex: 6 };
    const after = restoreFromBackgroundSnapshot(snap, new ChessService())!;
    expect(after.customSkillLevel).toBe(9);
    expect(after.selectedTimeControlIndex).toBe(fresh.selectedTimeControlIndex);
    const negative = restoreFromBackgroundSnapshot({ ...snap, customSkillLevel: -3, selectedTimeControlIndex: -1 }, new ChessService())!;
    expect(negative.customSkillLevel).toBe(0);
    expect(negative.selectedTimeControlIndex).toBe(fresh.selectedTimeControlIndex);
    const last = restoreFromBackgroundSnapshot({ ...snap, selectedTimeControlIndex: 5 }, new ChessService())!;
    expect(last.selectedTimeControlIndex).toBe(5);
  });

  it.each([
    ['nothing', undefined],
    ['another version', { ...buildBackgroundSnapshot(midGameBullet()), version: BACKGROUND_STATE_VERSION + 1 }],
    ['an unloadable position', { ...buildBackgroundSnapshot(midGameBullet()), fen: 'not a fen' }],
  ])('returns null for %s', (_what, snap) => {
    expect(restoreFromBackgroundSnapshot(snap, new ChessService())).toBeNull();
  });
});
