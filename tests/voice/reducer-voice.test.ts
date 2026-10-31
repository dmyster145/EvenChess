import { describe, it, expect } from 'vitest';
import { reduce } from '../../src/state/reducer';
import type { GameState, PieceEntry, CarouselMove } from '../../src/state/contracts';
import { baseGameState } from '../helpers/game-state';

function createState(overrides?: Partial<GameState>): GameState {
  const pieces: PieceEntry[] = [
    {
      id: 'w-n-b1', label: 'Knight B1', color: 'w', type: 'n', square: 'b1',
      moves: [{ uci: 'b1c3', san: 'Nc3', from: 'b1', to: 'c3' }],
    },
  ];
  return {
    ...baseGameState(),
    fen: 'startpos', turn: 'w', pieces, phase: 'idle',
    selectedPieceId: null, selectedMoveIndex: 0, pendingPromotionMove: null,
    selectedPromotionIndex: 0, mode: 'play', history: [], lastMove: null,
    playerLastMoveToSquare: null, engineThinking: false,
    inCheck: false, gameOver: null, pendingMove: null, menuSelectedIndex: 0,
    hasUnsavedChanges: false, previousPhase: null, difficulty: 'casual',
    customSkillLevel: 5, logScrollOffset: 0, timerActive: false,
    lastTickTime: null, selectedTimeControlIndex: 2, showBoardMarkers: true, boardPosition: 'bottom',
    playAs: 'white', playerColor: 'w', ...overrides,
  };
}

const move: CarouselMove = { uci: 'b1c3', san: 'Nc3', from: 'b1', to: 'c3' };

describe('reducer — voice actions', () => {
  it('VOICE_LISTEN_START arms listening only when it is the idle player turn', () => {
    expect(reduce(createState(), { type: 'VOICE_LISTEN_START' }).voice?.listening).toBe(true);
    expect(
      reduce(createState({ engineThinking: true }), { type: 'VOICE_LISTEN_START' }).voice,
    ).toBeUndefined();
    expect(
      reduce(createState({ phase: 'rowSelect' }), { type: 'VOICE_LISTEN_START' }).voice,
    ).toBeUndefined();
    expect(
      reduce(createState({ turn: 'b' }), { type: 'VOICE_LISTEN_START' }).voice,
    ).toBeUndefined();
  });

  it('VOICE_MOVE_CANDIDATE parks the move for confirmation without playing it', () => {
    const next = reduce(createState(), { type: 'VOICE_MOVE_CANDIDATE', move });
    expect(next.pendingMove).toBeNull(); // NOT played yet
    expect(next.history).toEqual([]);
    expect(next.voice?.pendingConfirm).toEqual(move);
    expect(next.voice?.listening).toBe(false);
  });

  it('VOICE_CONFIRM commits the parked move like a manual confirm', () => {
    const parked = reduce(createState(), { type: 'VOICE_MOVE_CANDIDATE', move });
    const next = reduce(parked, { type: 'VOICE_CONFIRM' });
    expect(next.pendingMove).toEqual(move);
    expect(next.history).toEqual(['Nc3']);
    expect(next.lastMove).toBe('Nc3');
    expect(next.playerLastMoveToSquare).toBe('c3');
    expect(next.hasUnsavedChanges).toBe(true);
    expect(next.voice?.pendingConfirm).toBeNull();
    expect(next.voice?.status).toContain('Nc3');
  });

  it('VOICE_CONFIRM is a no-op when nothing is parked', () => {
    const state = createState();
    expect(reduce(state, { type: 'VOICE_CONFIRM' })).toBe(state);
  });

  it.each([
    ['the engine has started thinking', { engineThinking: true }],
    ['the turn has passed to the engine', { turn: 'b' as const }],
    ['the player has opened the menu', { phase: 'menu' as const }],
  ])('VOICE_CONFIRM does not play the parked move once %s', (_why, change) => {
    const parked = reduce(createState(), { type: 'VOICE_MOVE_CANDIDATE', move });
    const changed = { ...parked, ...change };
    expect(reduce(changed, { type: 'VOICE_CONFIRM' })).toBe(changed);
  });

  it('VOICE_ABORT discards the parked move without playing it', () => {
    const parked = reduce(createState(), { type: 'VOICE_MOVE_CANDIDATE', move });
    const next = reduce(parked, { type: 'VOICE_ABORT' });
    expect(next.pendingMove).toBeNull();
    expect(next.voice?.pendingConfirm).toBeNull();
    expect(next.voice?.status).toBeNull();
  });

  it('VOICE_MOVE_CANDIDATE is rejected when not the idle player turn', () => {
    expect(reduce(createState({ engineThinking: true }), { type: 'VOICE_MOVE_CANDIDATE', move }).voice).toBeUndefined();
    expect(reduce(createState({ turn: 'b' }), { type: 'VOICE_MOVE_CANDIDATE', move }).voice).toBeUndefined();
    expect(reduce(createState({ pendingMove: move }), { type: 'VOICE_MOVE_CANDIDATE', move }).voice).toBeUndefined();
  });

  it('VOICE_STATUS sets a message and ends listening; empty message clears', () => {
    const listening = reduce(createState(), { type: 'VOICE_LISTEN_START' });
    const errored = reduce(listening, { type: 'VOICE_STATUS', message: 'Illegal', durationMs: 3000 });
    expect(errored.voice?.listening).toBe(false);
    expect(errored.voice?.status).toBe('Illegal');
    expect(errored.voice?.statusExpiresAt).toBeGreaterThan(Date.now());

    const partial = reduce(listening, { type: 'VOICE_STATUS', message: 'Hearing: knight', keepListening: true });
    expect(partial.voice?.listening).toBe(true);

    const cleared = reduce(errored, { type: 'VOICE_STATUS', message: '' });
    expect(cleared.voice?.status).toBeNull();
  });

  it('VOICE_LISTEN_END stops listening but keeps any status', () => {
    const listening = reduce(createState(), { type: 'VOICE_LISTEN_START' });
    const ended = reduce(listening, { type: 'VOICE_LISTEN_END' });
    expect(ended.voice).toEqual({ ...listening.voice, listening: false });
    expect(ended.voice?.status).toBe('Listening… speak your move');
  });

  it('does not act on voice once the game is over', () => {
    const over = createState({ gameOver: 'checkmate' });
    expect(reduce(over, { type: 'VOICE_LISTEN_START' }).voice).toBeUndefined();
    expect(reduce(over, { type: 'VOICE_MOVE_CANDIDATE', move }).voice).toBeUndefined();
  });

  // The gameOver gate drops VOICE_ABORT, and app.ts routes a double-tap to abort while a move is
  // parked, so a parked move that outlived the game would swallow every "new game" double-tap.
  it('a Bullet flag fall drops a parked voice move, so double-tap starts a new game', () => {
    const now = Date.now();
    const parked = reduce(createState({
      mode: 'bullet', timerActive: true, lastTickTime: now - 2000,
      timers: { whiteMs: 1000, blackMs: 60000, incrementMs: 0 },
    }), { type: 'VOICE_MOVE_CANDIDATE', move });
    expect(parked.voice?.pendingConfirm).toEqual(move);

    const flagged = reduce(parked, { type: 'TIMER_TICK' });
    expect(flagged.gameOver).toBeTruthy();
    expect(flagged.voice).toEqual({ listening: false, status: null, statusExpiresAt: null, pendingConfirm: null });

    const fresh = reduce(flagged, { type: 'DOUBLE_TAP' });
    expect(fresh.gameOver).toBeNull();
  });

  it('a game ending mid-listen clears the listening flag', () => {
    const listening = reduce(createState(), { type: 'VOICE_LISTEN_START' });
    const over = reduce(listening, { type: 'GAME_OVER', reason: 'Draw' });
    expect(over.voice?.listening).toBe(false);
  });

  it('a new game drops a parked voice move from the old one', () => {
    const parked = reduce(createState(), { type: 'VOICE_MOVE_CANDIDATE', move });
    expect(reduce(parked, { type: 'NEW_GAME' }).voice?.pendingConfirm).toBeNull();
  });
});
