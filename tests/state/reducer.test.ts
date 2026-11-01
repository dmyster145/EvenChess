import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reduce } from '../../src/state/reducer';
import type { GameState, PieceEntry, Action, MenuOption } from '../../src/state/contracts';
import {
  MODE_OPTIONS, MENU_OPTIONS, MENU_OPTION_COUNT, TIME_CONTROLS, MENU_INDEX, DRILL_OPTIONS } from '../../src/state/constants';
import { baseGameState } from '../helpers/game-state';
import { ChessService } from '../../src/chess/chessservice';
import { STARTING_FEN } from '../../src/chess/chessservice';
import { indicesToSquare, squareToIndices } from '../../src/chess/square-utils';
import { getKnightMoves, generateKnightPuzzle } from '../../src/academy/knight';
import { getRandomTacticsPuzzle, getRandomMatePuzzle, TACTICS_PUZZLES, MATE_PUZZLES } from '../../src/academy/puzzles';
import { getRandomFamousGame, FAMOUS_GAMES } from '../../src/academy/pgn';

// The Academy's random picks pass through to the real functions unless a test queues a fixed
// result with mockReturnValueOnce, so the "next puzzle" branches can assert exact values.
vi.mock('../../src/academy/knight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/academy/knight')>();
  return { ...actual, generateKnightPuzzle: vi.fn(actual.generateKnightPuzzle) };
});
vi.mock('../../src/academy/puzzles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/academy/puzzles')>();
  return {
    ...actual,
    getRandomTacticsPuzzle: vi.fn(actual.getRandomTacticsPuzzle),
    getRandomMatePuzzle: vi.fn(actual.getRandomMatePuzzle),
  };
});
vi.mock('../../src/academy/pgn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/academy/pgn')>();
  return { ...actual, getRandomFamousGame: vi.fn(actual.getRandomFamousGame) };
});

function createTestState(overrides?: Partial<GameState>): GameState {
  const pieces: PieceEntry[] = [
    {
      id: 'w-n-g1',
      label: 'Ng1',
      color: 'w',
      type: 'n',
      square: 'g1',
      moves: [
        { uci: 'g1f3', san: 'Nf3', from: 'g1', to: 'f3' },
        { uci: 'g1h3', san: 'Nh3', from: 'g1', to: 'h3' },
      ],
    },
    {
      id: 'w-p-e2',
      label: 'Pe2',
      color: 'w',
      type: 'p',
      square: 'e2',
      moves: [
        { uci: 'e2e4', san: 'e4', from: 'e2', to: 'e4' },
        { uci: 'e2e3', san: 'e3', from: 'e2', to: 'e3' },
      ],
    },
  ];

  return {
    ...baseGameState(),
    fen: 'startpos',
    turn: 'w',
    pieces,
    phase: 'idle',
    selectedPieceId: null,
    selectedMoveIndex: 0,
    pendingPromotionMove: null,
    selectedPromotionIndex: 0,
    mode: 'play',
    history: [],
    lastMove: null,
    playerLastMoveToSquare: null,
    engineThinking: false,
    inCheck: false,
    gameOver: null,
    pendingMove: null,
    menuSelectedIndex: 0,
    hasUnsavedChanges: false,
    previousPhase: null,
    difficulty: 'casual',
    customSkillLevel: 5,
    logScrollOffset: 0,
    phaseEnteredAt: Date.now(),
    timerActive: false,
    lastTickTime: null,
    selectedTimeControlIndex: 2,
    showBoardMarkers: true,
    boardPosition: 'bottom',
    playAs: 'white',
    playerColor: 'w',
    ...overrides,
  };
}

/** Tap a main-menu item, the way the user picks it: highlight it, then TAP. */
function pickMenu(state: GameState, option: MenuOption): GameState {
  return reduce({ ...state, menuSelectedIndex: MENU_OPTIONS.indexOf(option) }, { type: 'TAP' });
}

describe('reducer', () => {
  describe('SCROLL', () => {
    it('enters rowSelect from idle on scroll', () => {
      const state = createTestState();
      const next = reduce(state, { type: 'SCROLL', direction: 'down' });
      expect(next.phase).toBe('rowSelect');
      expect(next.selectedPieceId).toBe('w-n-g1'); // pieces[0], rank 1 → first candidate row
    });

    it('enters rowSelect with playerLastMoveToSquare piece when set', () => {
      const piecesWithE4: PieceEntry[] = [
        { id: 'w-n-g1', label: 'Ng1', color: 'w', type: 'n', square: 'g1', moves: [{ uci: 'g1f3', san: 'Nf3', from: 'g1', to: 'f3' }] },
        { id: 'w-p-e4', label: 'Pe4', color: 'w', type: 'p', square: 'e4', moves: [{ uci: 'e4e5', san: 'e5', from: 'e4', to: 'e5' }] },
      ];
      const state = createTestState({ playerLastMoveToSquare: 'e4', pieces: piecesWithE4 });
      const next = reduce(state, { type: 'SCROLL', direction: 'down' });
      expect(next.phase).toBe('rowSelect');
      expect(next.selectedPieceId).toBe('w-p-e4'); // piece on e4 (last moved to) selected → its row
    });

    // 3 candidate rows so direction polarity is unambiguous.
    const threeRows: PieceEntry[] = [
      { id: 'w-n-g1', label: 'Ng1', color: 'w', type: 'n', square: 'g1', moves: [{ uci: 'g1f3', san: 'Nf3', from: 'g1', to: 'f3' }] },
      { id: 'w-p-e2', label: 'Pe2', color: 'w', type: 'p', square: 'e2', moves: [{ uci: 'e2e3', san: 'e3', from: 'e2', to: 'e3' }] },
      { id: 'w-p-d4', label: 'Pd4', color: 'w', type: 'p', square: 'd4', moves: [{ uci: 'd4d5', san: 'd5', from: 'd4', to: 'd5' }] },
    ];

    it('cycles candidate rows: direction down = next-higher rank (band up the screen)', () => {
      // candidate rows [1, 2, 4]; same convention as pieceSelect (down ⇒ +1)
      const r1 = createTestState({ phase: 'rowSelect', selectedPieceId: 'w-n-g1', pieces: threeRows });
      const r2 = reduce(r1, { type: 'SCROLL', direction: 'down' });
      expect(r2.selectedPieceId).toBe('w-p-e2'); // rank 1 → rank 2
      const r4 = reduce(r2, { type: 'SCROLL', direction: 'down' });
      expect(r4.selectedPieceId).toBe('w-p-d4'); // rank 2 → rank 4
      const back = reduce(r4, { type: 'SCROLL', direction: 'up' });
      expect(back.selectedPieceId).toBe('w-p-e2'); // rank 4 → rank 2
    });

    it('wraps around candidate rows in rowSelect', () => {
      const r1 = createTestState({ phase: 'rowSelect', selectedPieceId: 'w-n-g1', pieces: threeRows });
      const wrapDown = reduce(r1, { type: 'SCROLL', direction: 'up' });
      expect(wrapDown.selectedPieceId).toBe('w-p-d4'); // rank 1, down-list ⇒ wraps to highest rank 4
      const top = createTestState({ phase: 'rowSelect', selectedPieceId: 'w-p-d4', pieces: threeRows });
      const wrapUp = reduce(top, { type: 'SCROLL', direction: 'down' });
      expect(wrapUp.selectedPieceId).toBe('w-n-g1'); // rank 4 → wraps to rank 1
    });

    it('is a no-op in rowSelect when only one candidate row', () => {
      const oneRow: PieceEntry[] = [
        { id: 'w-n-b1', label: 'Nb1', color: 'w', type: 'n', square: 'b1', moves: [{ uci: 'b1c3', san: 'Nc3', from: 'b1', to: 'c3' }] },
        { id: 'w-n-g1', label: 'Ng1', color: 'w', type: 'n', square: 'g1', moves: [{ uci: 'g1f3', san: 'Nf3', from: 'g1', to: 'f3' }] },
      ];
      const state = createTestState({ phase: 'rowSelect', selectedPieceId: 'w-n-b1', pieces: oneRow });
      const next = reduce(state, { type: 'SCROLL', direction: 'up' });
      expect(next.selectedPieceId).toBe('w-n-b1'); // single row → stays put
    });

    it('cycles pieces within the active row only in pieceSelect', () => {
      const sameRow: PieceEntry[] = [
        { id: 'w-n-b1', label: 'Nb1', color: 'w', type: 'n', square: 'b1', moves: [{ uci: 'b1c3', san: 'Nc3', from: 'b1', to: 'c3' }] },
        { id: 'w-n-g1', label: 'Ng1', color: 'w', type: 'n', square: 'g1', moves: [{ uci: 'g1f3', san: 'Nf3', from: 'g1', to: 'f3' }] },
        { id: 'w-p-e2', label: 'Pe2', color: 'w', type: 'p', square: 'e2', moves: [{ uci: 'e2e4', san: 'e4', from: 'e2', to: 'e4' }] },
      ];
      const state = createTestState({ phase: 'pieceSelect', selectedPieceId: 'w-n-b1', pieces: sameRow });
      const next = reduce(state, { type: 'SCROLL', direction: 'down' });
      expect(next.selectedPieceId).toBe('w-n-g1'); // next piece on rank 1 (not the rank-2 pawn)
      const wrapped = reduce(next, { type: 'SCROLL', direction: 'down' });
      expect(wrapped.selectedPieceId).toBe('w-n-b1'); // wraps within row, never spills to rank 2
    });

    it('cycles destinations in destSelect (wrap-around)', () => {
      const state = createTestState({
        phase: 'destSelect',
        selectedPieceId: 'w-n-g1',
        selectedMoveIndex: 0,
      });
      const next = reduce(state, { type: 'SCROLL', direction: 'down' });
      expect(next.selectedMoveIndex).toBe(1);

      // Should wrap around at the end (2 moves for knight: f3, h3)
      const wrapped = reduce(next, { type: 'SCROLL', direction: 'down' });
      expect(wrapped.selectedMoveIndex).toBe(0); // Wraps back to first move
    });

    it('cycles promotion options in promotionSelect', () => {
      const state = createTestState({
        phase: 'promotionSelect',
        pendingPromotionMove: { from: 'e7', to: 'e8' },
        selectedPromotionIndex: 0,
      });
      const next = reduce(state, { type: 'SCROLL', direction: 'down' });
      expect(next.selectedPromotionIndex).toBe(1);
      const wrapped = reduce(
        createTestState({ phase: 'promotionSelect', pendingPromotionMove: { from: 'e7', to: 'e8' }, selectedPromotionIndex: 3 }),
        { type: 'SCROLL', direction: 'down' }
      );
      expect(wrapped.selectedPromotionIndex).toBe(0);
    });
  });

  describe('TAP', () => {
    it('enters rowSelect from idle on tap', () => {
      const state = createTestState();
      const next = reduce(state, { type: 'TAP' });
      expect(next.phase).toBe('rowSelect');
    });

    it('descends rowSelect → pieceSelect on tap, keeping the selected piece', () => {
      const state = createTestState({ phase: 'rowSelect', selectedPieceId: 'w-p-e2' });
      const next = reduce(state, { type: 'TAP' });
      expect(next.phase).toBe('pieceSelect');
      expect(next.selectedPieceId).toBe('w-p-e2');
    });

    it('transitions from pieceSelect to destSelect using internal selection', () => {
      const state = createTestState({ phase: 'pieceSelect', selectedPieceId: 'w-n-g1' });
      // TAP confirms the internally-tracked piece (w-n-g1)
      const next = reduce(state, { type: 'TAP' });
      expect(next.phase).toBe('destSelect');
      expect(next.selectedPieceId).toBe('w-n-g1');
      expect(next.selectedMoveIndex).toBe(0);
    });

    it('transitions from pieceSelect with second piece selected', () => {
      const state = createTestState({ phase: 'pieceSelect', selectedPieceId: 'w-p-e2' });
      const next = reduce(state, { type: 'TAP' });
      expect(next.phase).toBe('destSelect');
      expect(next.selectedPieceId).toBe('w-p-e2');
    });

    it('commits a move from destSelect using internal selection', () => {
      const state = createTestState({
        phase: 'destSelect',
        selectedPieceId: 'w-n-g1',
        selectedMoveIndex: 1, // second destination = Nh3
      });
      const next = reduce(state, { type: 'TAP' });
      expect(next.phase).toBe('idle');
      expect(next.lastMove).toBe('Nh3');
      expect(next.pendingMove).not.toBeNull();
      expect(next.pendingMove!.uci).toBe('g1h3');
      expect(next.history).toContain('Nh3');
    });

    it('enters promotionSelect when tapping a promotion move in destSelect', () => {
      const pieces: PieceEntry[] = [
        {
          id: 'w-p-e7',
          label: 'Pe7',
          color: 'w',
          type: 'p',
          square: 'e7',
          moves: [
            { uci: 'e7e8q', san: 'e8=Q', from: 'e7', to: 'e8', promotion: 'q' },
          ],
        },
      ];
      const state = createTestState({
        phase: 'destSelect',
        selectedPieceId: 'w-p-e7',
        selectedMoveIndex: 0,
        pieces,
      });
      const next = reduce(state, { type: 'TAP' });
      expect(next.phase).toBe('promotionSelect');
      expect(next.pendingPromotionMove).toEqual({ from: 'e7', to: 'e8' });
      expect(next.selectedPromotionIndex).toBe(0);
    });

    it('commits promotion move from promotionSelect', () => {
      const state = createTestState({
        phase: 'promotionSelect',
        pendingPromotionMove: { from: 'e7', to: 'e8' },
        selectedPromotionIndex: 1, // Rook
      });
      const next = reduce(state, { type: 'TAP' });
      expect(next.phase).toBe('idle');
      expect(next.pendingPromotionMove).toBeNull();
      expect(next.pendingMove).not.toBeNull();
      expect(next.pendingMove!.from).toBe('e7');
      expect(next.pendingMove!.to).toBe('e8');
      expect(next.pendingMove!.promotion).toBe('r');
    });
  });

  describe('DOUBLE_TAP', () => {
    it('goes back to rowSelect from pieceSelect (after gesture disambiguation window)', () => {
      // phaseEnteredAt needs to be old enough to pass the gesture disambiguation
      const state = createTestState({
        phase: 'pieceSelect',
        selectedPieceId: 'w-n-g1',
        phaseEnteredAt: Date.now() - 500, // 500ms ago, past the 200ms window
      });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('rowSelect');
      expect(next.selectedPieceId).toBe('w-n-g1'); // kept so the row is preserved
    });

    it('backs out to idle from rowSelect on double-tap, then to menu on a second', () => {
      const state = createTestState({ phase: 'rowSelect', selectedPieceId: 'w-n-g1' });
      const backToIdle = reduce(state, { type: 'DOUBLE_TAP' });
      expect(backToIdle.phase).toBe('idle');
      expect(backToIdle.selectedPieceId).toBeNull();
      expect(backToIdle.selectedMoveIndex).toBe(0);
      // A second double-tap from idle opens the settings menu.
      const toMenu = reduce(backToIdle, { type: 'DOUBLE_TAP' });
      expect(toMenu.phase).toBe('menu');
    });

    it('opens menu from pieceSelect within gesture disambiguation window', () => {
      // If double-tap arrives within 200ms of entering pieceSelect, it opens menu
      const state = createTestState({
        phase: 'pieceSelect',
        selectedPieceId: 'w-n-g1',
        phaseEnteredAt: Date.now(), // Just entered
      });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('menu');
    });

    it('goes back to pieceSelect from destSelect', () => {
      const state = createTestState({
        phase: 'destSelect',
        selectedPieceId: 'w-n-g1',
        selectedMoveIndex: 1,
      });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('pieceSelect');
      expect(next.selectedMoveIndex).toBe(0);
    });

    it('goes back to destSelect from promotionSelect', () => {
      const state = createTestState({
        phase: 'promotionSelect',
        pendingPromotionMove: { from: 'e7', to: 'e8' },
        selectedPromotionIndex: 2,
      });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('destSelect');
      expect(next.pendingPromotionMove).toBeNull();
    });
  });

  describe('ENGINE_MOVE', () => {
    it('applies the engine position, records the move, and returns to idle', () => {
      const chess = new ChessService();
      chess.makeMove('e2', 'e4');
      const state = createTestState({
        phase: 'rowSelect', engineThinking: true, history: ['e4'], fen: chess.getFen(), turn: 'b',
      });
      chess.makeMove('e7', 'e5');
      const action: Action = {
        type: 'ENGINE_MOVE', uci: 'e7e5', san: 'e5',
        fen: chess.getFen(), turn: 'w', pieces: chess.getPiecesWithMoves(), inCheck: false,
      };
      const next = reduce(state, action);
      expect(next.phase).toBe('idle');
      expect(next.engineThinking).toBe(false);
      expect(next.fen).toBe(action.fen);
      expect(next.turn).toBe('w');
      expect(next.pieces).toBe(action.pieces);
      expect(next.lastMove).toBe('e5');
      expect(next.history).toEqual(['e4', 'e5']);
      expect(next.pendingMove).toBeNull();
    });

    it('stops the bullet clock at once when the engine move ends the game', () => {
      const state = createTestState({
        mode: 'bullet', engineThinking: true, turn: 'b', timerActive: true, lastTickTime: Date.now(),
        timers: { whiteMs: 60000, blackMs: 60000, incrementMs: 0 },
      });
      const engineMove = (endsGame?: boolean): Action => ({
        type: 'ENGINE_MOVE', uci: 'e7e5', san: 'e5', fen: 'fen', turn: 'w', pieces: [], inCheck: false, endsGame,
      });
      expect(reduce(state, engineMove(true)).timerActive).toBe(false);
      expect(reduce(state, engineMove(false)).timerActive).toBe(true);
    });
  });

  describe('GAME_OVER', () => {
    it('the action ends the game: back to idle, engine idle, half-made selection cleared', () => {
      const state = createTestState({
        phase: 'promotionSelect', engineThinking: true, selectedPieceId: 'w-n-g1', selectedMoveIndex: 1,
        pendingPromotionMove: { from: 'e7', to: 'e8' }, selectedPromotionIndex: 2,
      });
      const next = reduce(state, { type: 'GAME_OVER', reason: 'Checkmate' });
      expect(next.gameOver).toBe('Checkmate');
      expect(next.phase).toBe('idle');
      expect(next.engineThinking).toBe(false);
      expect(next.selectedPieceId).toBeNull();
      expect(next.selectedMoveIndex).toBe(0);
      expect(next.pendingPromotionMove).toBeNull();
      expect(next.selectedPromotionIndex).toBe(0);
    });

    // Each of these would change this state if the game were still running.
    const ignoredAfterGameOver: Action[] = [
      { type: 'SCROLL', direction: 'down' },
      { type: 'TAP' },
      { type: 'TIMER_TICK' },
      { type: 'APPLY_INCREMENT', color: 'w' },
      { type: 'ENGINE_THINKING' },
      { type: 'VOICE_LISTEN_START' },
      { type: 'VOICE_STATUS', message: 'Hearing: knight' },
    ];
    it.each(ignoredAfterGameOver)('once the game is over, $type is ignored', (action) => {
      const state = createTestState({
        gameOver: 'Checkmate', mode: 'bullet', timerActive: true, lastTickTime: 1,
        timers: { whiteMs: 60000, blackMs: 60000, incrementMs: 2000 },
      });
      expect(reduce(state, action)).toBe(state);
    });

    it('NEW_GAME still starts a new game once the game is over', () => {
      const newGame = reduce(createTestState({ gameOver: 'Checkmate' }), { type: 'NEW_GAME' });
      expect(newGame.gameOver).toBeNull();
    });
  });

  describe('NEW_GAME', () => {
    it('in Bullet mode, resets both clocks to the selected time control, stopped, and clears menu flags', () => {
      const next = reduce(createTestState({
        mode: 'bullet', selectedTimeControlIndex: 1, history: ['e4', 'e5'], timerActive: true, lastTickTime: 5,
        timers: { whiteMs: 10, blackMs: 20, incrementMs: 0 },
        pendingReset: true, pendingPlayAs: 'black', bulletPausedForMenu: true,
      }), { type: 'NEW_GAME' });
      expect(next.timers).toEqual({
        whiteMs: TIME_CONTROLS[1]!.initialMs,
        blackMs: TIME_CONTROLS[1]!.initialMs,
        incrementMs: TIME_CONTROLS[1]!.incrementMs,
      });
      expect(next.timerActive).toBe(false);
      expect(next.lastTickTime).toBeNull();
      expect(next.history).toEqual([]);
      expect(next.pendingReset).toBe(false);
      expect(next.pendingPlayAs).toBeNull();
      expect(next.bulletPausedForMenu).toBe(false);
    });
  });

  describe('PLAYER_MOVE_SAN (the chess service\'s SAN for the move just played)', () => {
    const played = { uci: 'g1f3', san: 'Nf3', from: 'g1', to: 'f3' };

    it('corrects the last history entry, lastMove and the pending move', () => {
      const state = createTestState({ history: ['e4', 'e5', 'Nf3'], lastMove: 'Nf3', pendingMove: played });
      const next = reduce(state, { type: 'PLAYER_MOVE_SAN', san: 'Nf3+' });
      expect(next.history).toEqual(['e4', 'e5', 'Nf3+']);
      expect(next.lastMove).toBe('Nf3+');
      expect(next.pendingMove).toEqual({ ...played, san: 'Nf3+' });
    });

    it('is a no-op when the SAN is already applied everywhere', () => {
      const state = createTestState({ history: ['Nf3'], lastMove: 'Nf3', pendingMove: played });
      expect(reduce(state, { type: 'PLAYER_MOVE_SAN', san: 'Nf3' })).toBe(state);
    });

    it('is a no-op with no pending move or an empty SAN', () => {
      const idle = createTestState({ history: ['Nf3'], lastMove: 'Nf3', pendingMove: null });
      expect(reduce(idle, { type: 'PLAYER_MOVE_SAN', san: 'Nf3+' })).toBe(idle);
      const pending = createTestState({ history: ['Nf3'], lastMove: 'Nf3', pendingMove: played });
      expect(reduce(pending, { type: 'PLAYER_MOVE_SAN', san: '' })).toBe(pending);
    });
  });

  describe('REFRESH', () => {
    it('updates fen, turn, and pieces', () => {
      const state = createTestState();
      const next = reduce(state, {
        type: 'REFRESH',
        fen: 'new-fen',
        turn: 'b',
        pieces: [],
        inCheck: false,
      });
      expect(next.fen).toBe('new-fen');
      expect(next.turn).toBe('b');
      expect(next.pieces).toHaveLength(0);
    });

    it('marks hasUnsavedChanges when history exists', () => {
      const state = createTestState({ history: ['e4', 'e5'] });
      const next = reduce(state, {
        type: 'REFRESH',
        fen: 'new-fen',
        turn: 'w',
        pieces: [],
        inCheck: false,
      });
      expect(next.hasUnsavedChanges).toBe(true);
    });
  });

  // ── Menu Tests ──────────────────────────────────────────────────────────────

  describe('backing out of a mode screen (double-tap)', () => {
    it.each([
      ['bulletSetup', 'bullet'],
      ['academySelect', 'academy'],
    ] as const)('%s returns to Mode with %s highlighted', (phase, mode) => {
      const next = reduce(createTestState({ phase, menuSelectedIndex: 0 }), { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('modeSelect');
      expect(MODE_OPTIONS[next.menuSelectedIndex]).toBe(mode);
    });
  });

  describe('opening and closing the menu (double-tap)', () => {
    it('opens the menu from idle, remembering where it came from', () => {
      const next = reduce(createTestState({ phase: 'idle', menuSelectedIndex: 3 }), { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('menu');
      expect(next.previousPhase).toBe('idle');
      expect(next.menuSelectedIndex).toBe(0);
    });

    it('a quick double-tap in pieceSelect opens the menu and closing it returns to pieceSelect', () => {
      const state = createTestState({ phase: 'pieceSelect', selectedPieceId: 'w-n-g1', phaseEnteredAt: Date.now() });
      const menu = reduce(state, { type: 'DOUBLE_TAP' });
      expect(menu.previousPhase).toBe('pieceSelect');
      const back = reduce(menu, { type: 'DOUBLE_TAP' });
      expect(back.phase).toBe('pieceSelect');
      expect(back.previousPhase).toBeNull();
    });

    it('does not open the menu while the engine is thinking', () => {
      const state = createTestState({ phase: 'idle', engineThinking: true });
      expect(reduce(state, { type: 'DOUBLE_TAP' })).toBe(state);
    });

    it('closing returns to idle when there is no previous phase', () => {
      const next = reduce(createTestState({ phase: 'menu', previousPhase: null }), { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('idle');
    });
  });

  describe('menu items (tap)', () => {
    it('navigates to modeSelect on mode option', () => {
      const state = createTestState({ phase: 'menu' });
      const next = pickMenu(state, 'mode');
      expect(next.phase).toBe('modeSelect');
    });

    it('navigates to viewLog on viewLog option', () => {
      const state = createTestState({ phase: 'menu', history: ['e4', 'e5'] });
      const next = pickMenu(state, 'viewLog');
      expect(next.phase).toBe('viewLog');
    });

    it('navigates to difficultySelect on difficulty option', () => {
      const state = createTestState({ phase: 'menu', difficulty: 'serious' });
      const next = pickMenu(state, 'difficulty');
      expect(next.phase).toBe('difficultySelect');
      expect(next.menuSelectedIndex).toBe(2); // 'serious' = index 2 (easy=0, casual=1, serious=2)
    });

    it('navigates to resetConfirm on reset option', () => {
      const state = createTestState({ phase: 'menu' });
      const next = pickMenu(state, 'reset');
      expect(next.phase).toBe('resetConfirm');
      expect(next.menuSelectedIndex).toBe(1); // Cancel selected by default
    });

    it('"Exit" item arms the ER system exit dialog and stays in the menu', () => {
      // Tapping the menu's "Exit" item fires the ER exit-confirmation dialog (side-effects.ts sees
      // pendingSystemExitDialog and calls requestSystemExit). Stay in the menu so cancelling leaves
      // the user where they were. (Closing the menu back to the game is double-tap, not this.)
      const state = createTestState({ phase: 'menu', previousPhase: 'idle' });
      const next = pickMenu(state, 'exit');
      expect(next.pendingSystemExitDialog).toBe(true);
      expect(next.phase).toBe('menu');
    });
  });

  describe('menu scroll navigation', () => {
    // Scroll direction is inverted in settings phases (see INVERTED_SCROLL_PHASES in
    // state/utils.ts) so that a physical scroll-down gesture moves the cursor to
    // the previous item. Tests use the post-inversion convention: `up` = +1.
    it('cycles menu options forward (scroll up)', () => {
      const state = createTestState({ phase: 'menu', menuSelectedIndex: 0 });
      const next = reduce(state, { type: 'SCROLL', direction: 'up' });
      expect(next.menuSelectedIndex).toBe(1);
    });

    it('wraps menu options from last to first', () => {
      const state = createTestState({ phase: 'menu', menuSelectedIndex: MENU_OPTION_COUNT - 1 });
      const next = reduce(state, { type: 'SCROLL', direction: 'up' });
      expect(next.menuSelectedIndex).toBe(0);
    });

    it('cycles menu options backward (scroll down)', () => {
      const state = createTestState({ phase: 'menu', menuSelectedIndex: 2 });
      const next = reduce(state, { type: 'SCROLL', direction: 'down' });
      expect(next.menuSelectedIndex).toBe(1);
    });

    it('wraps menu options from first to last', () => {
      const state = createTestState({ phase: 'menu', menuSelectedIndex: 0 });
      const next = reduce(state, { type: 'SCROLL', direction: 'down' });
      expect(next.menuSelectedIndex).toBe(MENU_OPTION_COUNT - 1);
    });
  });

  describe('menu tap selection', () => {
    it('tap in menu selects current option', () => {
      const state = createTestState({ phase: 'menu', menuSelectedIndex: MENU_INDEX.viewLog });
      const next = reduce(state, { type: 'TAP' });
      expect(next.phase).toBe('viewLog');
    });
  });

  // ── Settings Tests ──────────────────────────────────────────────────────────

  describe('custom difficulty picker', () => {
    it('tapping Custom in difficultySelect opens the picker phase', () => {
      // Custom is index 3 in DIFFICULTY_OPTIONS (Easy, Casual, Serious, Custom).
      const state = createTestState({ phase: 'difficultySelect', menuSelectedIndex: 3, customSkillLevel: 4 });
      const next = reduce(state, { type: 'TAP' });
      expect(next.phase).toBe('customDifficultySelect');
      // Picker keeps the prior level until the user adjusts it.
      expect(next.customSkillLevel).toBe(4);
    });

    it('scrolling adjusts the picker without wrap; clamps at bounds', () => {
      const state = createTestState({ phase: 'customDifficultySelect', customSkillLevel: 2, menuSelectedIndex: 8 });
      // Settings phase: scroll direction is inverted; 'up' = next = higher level.
      const next = reduce(state, { type: 'SCROLL', direction: 'up' });
      expect(next.menuSelectedIndex).toBe(9);
      const clamped = reduce(next, { type: 'SCROLL', direction: 'up' });
      expect(clamped.menuSelectedIndex).toBe(9); // clamps at MAX
      const back = reduce(clamped, { type: 'SCROLL', direction: 'down' });
      expect(back.menuSelectedIndex).toBe(8);
      expect(back.customSkillLevel).toBe(2); // nothing is applied until the tap
      const low = createTestState({ phase: 'customDifficultySelect', menuSelectedIndex: 0 });
      expect(reduce(low, { type: 'SCROLL', direction: 'down' }).menuSelectedIndex).toBe(0); // clamps at MIN
    });

    it('opening the picker starts it at the committed level', () => {
      const state = createTestState({ phase: 'difficultySelect', menuSelectedIndex: 3, customSkillLevel: 6 });
      const next = reduce(state, { type: 'TAP' });
      expect(next.phase).toBe('customDifficultySelect');
      expect(next.menuSelectedIndex).toBe(6);
    });

    it('tapping in the picker commits Custom and returns to menu', () => {
      const state = createTestState({ phase: 'customDifficultySelect', customSkillLevel: 2, menuSelectedIndex: 7, difficulty: 'casual' });
      const next = reduce(state, { type: 'TAP' });
      expect(next.phase).toBe('menu');
      expect(next.difficulty).toBe('custom');
      expect(next.customSkillLevel).toBe(7);
    });

    it('double-tap in the picker returns to difficultySelect with Custom highlighted', () => {
      const state = createTestState({ phase: 'customDifficultySelect', customSkillLevel: 3, menuSelectedIndex: 8, difficulty: 'custom' });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('difficultySelect');
      expect(next.menuSelectedIndex).toBe(3); // Custom's index in DIFFICULTY_OPTIONS
      expect(next.customSkillLevel).toBe(3); // backing out cancels the picked 8
      expect(next.difficulty).toBe('custom');
    });
  });

  describe('Display Options toggles', () => {
    it('tapping the markers row flips showBoardMarkers and stays put', () => {
      const on = createTestState({ phase: 'displayOptionsSelect', menuSelectedIndex: 2, showBoardMarkers: true });
      const off = reduce(on, { type: 'TAP' });
      expect(off.showBoardMarkers).toBe(false);
      expect(off.phase).toBe('displayOptionsSelect');
      expect(off.menuSelectedIndex).toBe(2);
      // Toggling back on.
      const backOn = reduce(off, { type: 'TAP' });
      expect(backOn.showBoardMarkers).toBe(true);
    });

    it('tapping the alignment row flips boardAlignment both ways and stays put', () => {
      const center = createTestState({ phase: 'displayOptionsSelect', menuSelectedIndex: 0, boardAlignment: 'center' });
      const right = reduce(center, { type: 'TAP' });
      expect(right.boardAlignment).toBe('right');
      expect(right.phase).toBe('displayOptionsSelect');
      expect(right.menuSelectedIndex).toBe(0);
      expect(reduce(right, { type: 'TAP' }).boardAlignment).toBe('center');
    });

    it('tapping the size row flips boardSize both ways and stays put', () => {
      const large = createTestState({ phase: 'displayOptionsSelect', menuSelectedIndex: 1, boardSize: 'large' });
      const small = reduce(large, { type: 'TAP' });
      expect(small.boardSize).toBe('small');
      expect(small.phase).toBe('displayOptionsSelect');
      expect(small.menuSelectedIndex).toBe(1);
      expect(reduce(small, { type: 'TAP' }).boardSize).toBe('large');
    });

    it('tapping the position row flips boardPosition and stays put', () => {
      const bottom = createTestState({ phase: 'displayOptionsSelect', menuSelectedIndex: 3, boardPosition: 'bottom' });
      const top = reduce(bottom, { type: 'TAP' });
      expect(top.boardPosition).toBe('top');
      expect(top.phase).toBe('displayOptionsSelect');
      expect(top.menuSelectedIndex).toBe(3);
      expect(reduce(top, { type: 'TAP' }).boardPosition).toBe('bottom');
    });

    it('scrolling skips the hidden markers row onto Position when the board is large', () => {
      const state = createTestState({ phase: 'displayOptionsSelect', menuSelectedIndex: 1, boardSize: 'large' });
      // Settings phases invert the raw SCROLL direction, so 'up' advances to the next row.
      const next = reduce(state, { type: 'SCROLL', direction: 'up' });
      expect(next.menuSelectedIndex).toBe(3);
      expect(reduce(next, { type: 'SCROLL', direction: 'down' }).menuSelectedIndex).toBe(1);
    });
  });

  describe('difficulty scroll', () => {
    it('cycles difficulty options', () => {
      // Settings phase: scroll direction inverted; `up` advances forward.
      // Options are Easy, Casual, Serious, Custom (4 entries, wraps back to 0).
      const state = createTestState({ phase: 'difficultySelect', menuSelectedIndex: 0 });
      const next = reduce(state, { type: 'SCROLL', direction: 'up' });
      expect(next.menuSelectedIndex).toBe(1);
      const next2 = reduce(next, { type: 'SCROLL', direction: 'up' });
      expect(next2.menuSelectedIndex).toBe(2);
      const next3 = reduce(next2, { type: 'SCROLL', direction: 'up' });
      expect(next3.menuSelectedIndex).toBe(3);
      const wrapped = reduce(next3, { type: 'SCROLL', direction: 'up' });
      expect(wrapped.menuSelectedIndex).toBe(0);
    });
  });

  describe('difficulty tap', () => {
    it('tap selects difficulty and returns to menu', () => {
      const state = createTestState({ phase: 'difficultySelect', menuSelectedIndex: 2 }); // index 2 = Serious
      const next = reduce(state, { type: 'TAP' });
      expect(next.difficulty).toBe('serious');
      expect(next.phase).toBe('menu');
    });
  });

  // ── Mode Tests ──────────────────────────────────────────────────────────────

  describe('mode select (tap)', () => {
    it('Play vs AI applies immediately and drops the bullet clock', () => {
      const state = createTestState({
        phase: 'modeSelect', menuSelectedIndex: 0, mode: 'bullet', timerActive: true,
        timers: { whiteMs: 1000, blackMs: 1000, incrementMs: 0 },
      });
      const next = reduce(state, { type: 'TAP' });
      expect(next.mode).toBe('play');
      expect(next.phase).toBe('idle');
      expect(next.timerActive).toBe(false);
      expect(next.timers).toBeUndefined();
    });

    it('Academy opens the drill list without committing academy mode', () => {
      const next = reduce(createTestState({ phase: 'modeSelect', menuSelectedIndex: 2, mode: 'play' }), { type: 'TAP' });
      expect(next.mode).toBe('play');
      expect(next.phase).toBe('academySelect');
    });
  });

  describe('mode scroll and tap', () => {
    it('cycles mode options', () => {
      // Settings phase: scroll direction inverted; `up` advances forward.
      const state = createTestState({ phase: 'modeSelect', menuSelectedIndex: 0 });
      const next = reduce(state, { type: 'SCROLL', direction: 'up' });
      expect(next.menuSelectedIndex).toBe(1);
    });

    it('tap on Bullet Blitz opens its setup; the mode is unchanged until a game starts', () => {
      const state = createTestState({ phase: 'modeSelect', menuSelectedIndex: 1, mode: 'play' });
      const next = reduce(state, { type: 'TAP' });
      expect(next.phase).toBe('bulletSetup');
      expect(next.mode).toBe('play');
    });
  });

  // ── Bullet Timer Tests ──────────────────────────────────────────────────────

  describe('starting a bullet game (tap a time control)', () => {
    it.each([0, 3])('time control %i sets both clocks and the increment, not yet running', (index) => {
      const next = reduce(createTestState({ phase: 'bulletSetup', selectedTimeControlIndex: 2, menuSelectedIndex: index }), { type: 'TAP' });
      expect(next.phase).toBe('idle');
      expect(next.selectedTimeControlIndex).toBe(index);
      expect(next.timers).toEqual({
        whiteMs: TIME_CONTROLS[index]!.initialMs,
        blackMs: TIME_CONTROLS[index]!.initialMs,
        incrementMs: TIME_CONTROLS[index]!.incrementMs,
      });
      expect(next.timerActive).toBe(false);
    });
  });

  describe('bullet setup scroll and tap', () => {
    it('cycles time control options', () => {
      // Settings phase: scroll direction inverted; `up` advances forward.
      const state = createTestState({ phase: 'bulletSetup', selectedTimeControlIndex: 4, menuSelectedIndex: 0 });
      const next = reduce(state, { type: 'SCROLL', direction: 'up' });
      expect(next.menuSelectedIndex).toBe(1);
      expect(next.selectedTimeControlIndex).toBe(4); // the cursor moves; the setting does not
    });

    it('opening the setup starts the cursor on the current time control', () => {
      const state = createTestState({ phase: 'modeSelect', menuSelectedIndex: 1, selectedTimeControlIndex: 4 });
      expect(reduce(state, { type: 'TAP' }).menuSelectedIndex).toBe(4);
    });

    it('backing out after scrolling leaves the next game on the old time control', () => {
      let s = createTestState({ mode: 'bullet', phase: 'modeSelect', menuSelectedIndex: 1, selectedTimeControlIndex: 0 });
      s = reduce(s, { type: 'TAP' }); // into bulletSetup
      s = reduce(s, { type: 'SCROLL', direction: 'up' });
      s = reduce(s, { type: 'DOUBLE_TAP' }); // back out
      expect(s.phase).toBe('modeSelect');
      expect(s.selectedTimeControlIndex).toBe(0);
      const fresh = reduce({ ...s, gameOver: 'White wins on time!', phase: 'idle' }, { type: 'DOUBLE_TAP' });
      expect(fresh.timers?.whiteMs).toBe(TIME_CONTROLS[0]!.initialMs);
      expect(fresh.timers?.incrementMs).toBe(TIME_CONTROLS[0]!.incrementMs);
    });
  });

  describe('TIMER_TICK', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // TIMER_TICK bills the time since the last tick to whoever is on move at the tick, so each
    // turn change must settle the mover's time first.
    it('an engine move charges the engine for the time since the last tick, not the human', () => {
      const now = Date.now();
      const state = createTestState({
        mode: 'bullet', turn: 'b', playerColor: 'w', timerActive: true, lastTickTime: now - 450,
        timers: { whiteMs: 10000, blackMs: 10000, incrementMs: 0 },
      });
      const moved = reduce(state, {
        type: 'ENGINE_MOVE', uci: 'e7e5', san: 'e5', fen: state.fen, turn: 'w', pieces: state.pieces, inCheck: false,
      });
      expect(moved.timers).toEqual({ whiteMs: 10000, blackMs: 9550, incrementMs: 0 });
      expect(moved.lastTickTime).toBe(now);
      vi.advanceTimersByTime(50);
      expect(reduce(moved, { type: 'TIMER_TICK' }).timers).toEqual({ whiteMs: 9950, blackMs: 9550, incrementMs: 0 });
    });

    it('the human\'s move (REFRESH to the engine\'s turn) charges the human', () => {
      const now = Date.now();
      const state = createTestState({
        mode: 'bullet', turn: 'w', playerColor: 'w', timerActive: true, lastTickTime: now - 300,
        timers: { whiteMs: 10000, blackMs: 10000, incrementMs: 0 },
      });
      const moved = reduce(state, { type: 'REFRESH', fen: state.fen, turn: 'b', pieces: state.pieces, inCheck: false });
      expect(moved.timers).toEqual({ whiteMs: 9700, blackMs: 10000, incrementMs: 0 });
      expect(moved.lastTickTime).toBe(now);
    });

    it('a mover whose clock ran out before the move landed loses on time, and an increment cannot save them', () => {
      const now = Date.now();
      const state = createTestState({
        mode: 'bullet', turn: 'w', playerColor: 'w', timerActive: true, lastTickTime: now - 450,
        timers: { whiteMs: 300, blackMs: 10000, incrementMs: 5000 },
      });
      const moved = reduce(state, { type: 'REFRESH', fen: state.fen, turn: 'b', pieces: state.pieces, inCheck: false });
      expect(moved.gameOver).toBe('Black wins on time!');
      expect(moved.timerActive).toBe(false);
      expect(reduce(moved, { type: 'APPLY_INCREMENT', color: 'w' }).timers!.whiteMs).toBe(0);

      const engineTurn = createTestState({
        mode: 'bullet', turn: 'b', playerColor: 'w', timerActive: true, lastTickTime: now - 450,
        timers: { whiteMs: 10000, blackMs: 300, incrementMs: 0 },
      });
      const engineMoved = reduce(engineTurn, {
        type: 'ENGINE_MOVE', uci: 'e7e5', san: 'e5', fen: state.fen, turn: 'w', pieces: state.pieces, inCheck: false,
      });
      expect(engineMoved.gameOver).toBe('White wins on time!');
      expect(engineMoved.timerActive).toBe(false);
    });

    it('a mover with time left after settling plays on', () => {
      const now = Date.now();
      const state = createTestState({
        mode: 'bullet', turn: 'w', playerColor: 'w', timerActive: true, lastTickTime: now - 299,
        timers: { whiteMs: 300, blackMs: 10000, incrementMs: 0 },
      });
      const moved = reduce(state, { type: 'REFRESH', fen: state.fen, turn: 'b', pieces: state.pieces, inCheck: false });
      expect(moved.gameOver).toBeNull();
      expect(moved.timers!.whiteMs).toBe(1);
      expect(moved.timerActive).toBe(true);
    });

    it('a REFRESH that keeps the same turn, or a stopped clock, settles nothing', () => {
      const now = Date.now();
      const running = createTestState({
        turn: 'w', timerActive: true, lastTickTime: now - 300, timers: { whiteMs: 10000, blackMs: 10000, incrementMs: 0 },
      });
      const same = reduce(running, { type: 'REFRESH', fen: running.fen, turn: 'w', pieces: running.pieces, inCheck: false });
      expect(same.timers).toEqual(running.timers);
      const stopped = reduce({ ...running, timerActive: false }, { type: 'REFRESH', fen: running.fen, turn: 'b', pieces: running.pieces, inCheck: false });
      expect(stopped.timers).toEqual(running.timers);
    });

    it('decrements active player time', () => {
      const now = Date.now();
      const state = createTestState({
        turn: 'w',
        timerActive: true,
        lastTickTime: now - 1000,
        timers: { whiteMs: 60000, blackMs: 60000, incrementMs: 0 },
      });
      
      const next = reduce(state, { type: 'TIMER_TICK' });
      
      expect(next.timers!.whiteMs).toBe(59000);
      expect(next.timers!.blackMs).toBe(60000); // Unchanged
    });

    it('detects timeout and ends game', () => {
      const now = Date.now();
      const state = createTestState({
        turn: 'w',
        timerActive: true,
        lastTickTime: now - 100000, // More time than available
        timers: { whiteMs: 1000, blackMs: 60000, incrementMs: 0 },
      });
      
      const next = reduce(state, { type: 'TIMER_TICK' });
      
      expect(next.timers!.whiteMs).toBe(0);
      expect(next.timerActive).toBe(false);
      expect(next.gameOver).toBe('Black wins on time!');
    });

    it('returns unchanged when timer not active', () => {
      const state = createTestState({ timerActive: false });
      const next = reduce(state, { type: 'TIMER_TICK' });
      expect(next).toBe(state);
    });
  });

  describe('APPLY_INCREMENT', () => {
    it('adds increment to white time', () => {
      const state = createTestState({
        timers: { whiteMs: 50000, blackMs: 60000, incrementMs: 2000 },
      });
      
      const next = reduce(state, { type: 'APPLY_INCREMENT', color: 'w' });
      
      expect(next.timers!.whiteMs).toBe(52000);
      expect(next.timers!.blackMs).toBe(60000);
    });

    it('adds increment to black time', () => {
      const state = createTestState({
        timers: { whiteMs: 60000, blackMs: 45000, incrementMs: 3000 },
      });
      
      const next = reduce(state, { type: 'APPLY_INCREMENT', color: 'b' });
      
      expect(next.timers!.blackMs).toBe(48000);
    });
  });

  // ── Academy Drill Tests ─────────────────────────────────────────────────────

  describe('starting a drill (tap in academySelect)', () => {
    it('starts coordinate drill', () => {
      const state = createTestState({ phase: 'academySelect' });
      const next = reduce({ ...state, menuSelectedIndex: DRILL_OPTIONS.indexOf('coordinate') }, { type: 'TAP' });
      
      expect(next.phase).toBe('coordinateDrill');
      expect(next.academyState).toBeDefined();
      expect(next.academyState!.drillType).toBe('coordinate');
      expect(next.academyState!.targetSquare).toMatch(/^[a-h][1-8]$/);
      expect(next.academyState!.score).toEqual({ correct: 0, total: 0 });
    });

    it('starts knight path drill', () => {
      const state = createTestState({ phase: 'academySelect' });
      const next = reduce({ ...state, menuSelectedIndex: DRILL_OPTIONS.indexOf('knightPath') }, { type: 'TAP' });
      
      expect(next.phase).toBe('knightPathDrill');
      expect(next.academyState!.knightPath).toBeDefined();
      expect(next.academyState!.knightPath!.startSquare).toBeDefined();
      expect(next.academyState!.knightPath!.targetSquare).toBeDefined();
    });

    it('starts tactics drill', () => {
      const state = createTestState({ phase: 'academySelect' });
      const next = reduce({ ...state, menuSelectedIndex: DRILL_OPTIONS.indexOf('tactics') }, { type: 'TAP' });
      
      expect(next.phase).toBe('tacticsDrill');
      expect(TACTICS_PUZZLES).toContainEqual(next.academyState!.tacticsPuzzle); // from the tactics pool
    });

    it('starts mate drill', () => {
      const state = createTestState({ phase: 'academySelect' });
      const next = reduce({ ...state, menuSelectedIndex: DRILL_OPTIONS.indexOf('mate') }, { type: 'TAP' });
      
      expect(next.phase).toBe('mateDrill');
      expect(MATE_PUZZLES).toContainEqual(next.academyState!.tacticsPuzzle); // from the mate pool
    });

    it('starts pgn study', () => {
      const state = createTestState({ phase: 'academySelect' });
      const next = reduce({ ...state, menuSelectedIndex: DRILL_OPTIONS.indexOf('pgn') }, { type: 'TAP' });
      
      expect(next.phase).toBe('pgnStudy');
      expect(FAMOUS_GAMES.map((g) => g.name)).toContain(next.academyState!.pgnStudy!.gameName);
    });
  });

  describe('academy select scroll and tap', () => {
    it('cycles academy drill options', () => {
      // Settings phase: scroll direction inverted; `up` advances forward.
      const state = createTestState({ phase: 'academySelect', menuSelectedIndex: 0 });
      const next = reduce(state, { type: 'SCROLL', direction: 'up' });
      expect(next.menuSelectedIndex).toBe(1);
    });

    it('tap starts selected drill', () => {
      const state = createTestState({ phase: 'academySelect', menuSelectedIndex: 0 });
      const next = reduce(state, { type: 'TAP' });
      expect(next.phase).toBe('coordinateDrill');
    });
    it('backing out of a drill and closing the menu lands on the drill list, not the play board', () => {
      // Menu opened from Play idle, so previousPhase is 'idle' until a drill starts.
      let s = reduce(createTestState({ phase: 'idle' }), { type: 'DOUBLE_TAP' });
      expect(s.phase).toBe('menu');
      s = pickMenu(s, 'mode');
      s = reduce({ ...s, menuSelectedIndex: MODE_OPTIONS.indexOf('academy') }, { type: 'TAP' });
      s = reduce({ ...s, menuSelectedIndex: DRILL_OPTIONS.indexOf('coordinate') }, { type: 'TAP' });
      expect(s.mode).toBe('academy');
      for (const expected of ['academySelect', 'modeSelect', 'menu', 'academySelect'] as const) {
        s = reduce(s, { type: 'DOUBLE_TAP' });
        expect(s.phase).toBe(expected);
      }
      expect(s.mode).toBe('academy');
    });
  });

  describe('coordinate drill interaction', () => {
    it('scroll moves cursor on current axis', () => {
      const state = createTestState({
        phase: 'coordinateDrill',
        academyState: {
          drillType: 'coordinate',
          targetSquare: 'e4',
          score: { correct: 0, total: 0 },
          cursorFile: 4,
          cursorRank: 3,
          navAxis: 'file',
          feedback: 'none',
        },
      });
      
      const next = reduce(state, { type: 'SCROLL', direction: 'up' });
      
      expect(next.academyState!.cursorFile).toBe(5); // e -> f
      expect(next.academyState!.cursorRank).toBe(3); // Unchanged
    });

    it('tap switches from file to rank axis', () => {
      const state = createTestState({
        phase: 'coordinateDrill',
        academyState: {
          drillType: 'coordinate',
          targetSquare: 'e4',
          score: { correct: 0, total: 0 },
          cursorFile: 4,
          cursorRank: 3,
          navAxis: 'file',
          feedback: 'none',
        },
      });
      
      const next = reduce(state, { type: 'TAP' });
      
      expect(next.academyState!.navAxis).toBe('rank');
    });

    it('tap on rank axis submits guess', () => {
      const state = createTestState({
        phase: 'coordinateDrill',
        academyState: {
          drillType: 'coordinate',
          targetSquare: 'e4',
          score: { correct: 0, total: 0 },
          cursorFile: 4,
          cursorRank: 3,
          navAxis: 'rank',
          feedback: 'none',
        },
      });
      
      const next = reduce(state, { type: 'TAP' });
      
      expect(next.academyState!.feedback).toBe('correct');
      expect(next.academyState!.score.correct).toBe(1);
      expect(next.academyState!.score.total).toBe(1);
    });

    it('a wrong guess counts toward the total but not the correct count', () => {
      const state = createTestState({
        phase: 'coordinateDrill',
        academyState: {
          drillType: 'coordinate',
          targetSquare: 'e4',
          score: { correct: 2, total: 5 },
          cursorFile: 0, // a4, not e4
          cursorRank: 3,
          navAxis: 'rank',
          feedback: 'none',
        },
      });
      const next = reduce(state, { type: 'TAP' });
      expect(next.academyState!.feedback).toBe('incorrect');
      expect(next.academyState!.score).toEqual({ correct: 2, total: 6 });
    });
  });

  describe('drill exit', () => {
    it('double-tap on row selection returns to column selection', () => {
      const state = createTestState({
        phase: 'coordinateDrill',
        academyState: {
          drillType: 'coordinate',
          targetSquare: 'e4',
          score: { correct: 0, total: 0 },
          cursorFile: 4,
          cursorRank: 3,
          navAxis: 'rank',
          feedback: 'none',
        },
      });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('coordinateDrill');
      expect(next.academyState?.navAxis).toBe('file');
    });

    it('double-tap on column selection exits drill to academy select', () => {
      const state = createTestState({
        phase: 'coordinateDrill',
        academyState: {
          drillType: 'coordinate',
          targetSquare: 'e4',
          score: { correct: 5, total: 10 },
          cursorFile: 4,
          cursorRank: 3,
          navAxis: 'file',
          feedback: 'none',
        },
      });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('academySelect');
      expect(next.academyState).toBeUndefined();
    });
  });

  // ── Confirm Tests ───────────────────────────────────────────────────────────

  describe('reset confirm', () => {
    it('scroll toggles between options', () => {
      const state = createTestState({ phase: 'resetConfirm', menuSelectedIndex: 1 });
      const next = reduce(state, { type: 'SCROLL', direction: 'up' });
      expect(next.menuSelectedIndex).toBe(0);
    });

    it('tap on confirm resets (flags pendingReset for the side-effect)', () => {
      const state = createTestState({ phase: 'resetConfirm', menuSelectedIndex: 0 });
      const next = reduce(state, { type: 'TAP' });
      expect(next.phase).toBe('idle');
      expect(next.pendingReset).toBe(true);
    });

    it('tap on cancel returns to menu without flagging a reset', () => {
      const state = createTestState({ phase: 'resetConfirm', menuSelectedIndex: 1 });
      const next = reduce(state, { type: 'TAP' });
      expect(next.phase).toBe('menu');
      expect(next.pendingReset).toBeFalsy();
    });
  });

  // ── View Log Tests ──────────────────────────────────────────────────────────

  describe('view log', () => {
    it('scroll moves through log', () => {
      const history = Array.from({ length: 20 }, (_, i) => `move${i}`);
      const state = createTestState({ phase: 'viewLog', history, logScrollOffset: 0 });
      const next = reduce(state, { type: 'SCROLL', direction: 'down' });
      expect(next.logScrollOffset).toBe(1);
    });

    it('scroll is clamped at boundaries', () => {
      const state = createTestState({ phase: 'viewLog', history: ['e4', 'e5'], logScrollOffset: 0 });
      const next = reduce(state, { type: 'SCROLL', direction: 'up' });
      expect(next.logScrollOffset).toBe(0); // Can't go negative
    });

    it('tap returns to menu', () => {
      const state = createTestState({ phase: 'viewLog' });
      const next = reduce(state, { type: 'TAP' });
      expect(next.phase).toBe('menu');
    });

    it('double-tap returns to menu', () => {
      const state = createTestState({ phase: 'viewLog' });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('menu');
    });
  });

  // ── History Capping Tests ───────────────────────────────────────────────────

  describe('move history', () => {
    it('keeps the full history past 200 plies (no cap, so move numbers stay right)', () => {
      const longHistory = Array.from({ length: 250 }, (_, i) => `move${i}`);
      const state = createTestState({
        phase: 'destSelect',
        selectedPieceId: 'w-n-g1',
        selectedMoveIndex: 0,
        history: longHistory,
      });
      const next = reduce(state, { type: 'TAP' });
      expect(next.history.length).toBe(251);
      expect(next.history[0]).toBe('move0');
      expect(next.history[250]).toBe('Nf3');
    });
  });

  // ── Engine Action Tests ─────────────────────────────────────────────────────

  describe('ENGINE_THINKING', () => {
    it('sets engineThinking to true', () => {
      const state = createTestState({ engineThinking: false });
      const next = reduce(state, { type: 'ENGINE_THINKING' });
      expect(next.engineThinking).toBe(true);
    });
  });

  describe('ENGINE_ERROR', () => {
    it('sets engineThinking to false', () => {
      const state = createTestState({ engineThinking: true });
      const next = reduce(state, { type: 'ENGINE_ERROR' });
      expect(next.engineThinking).toBe(false);
    });
  });

  describe('MARK_SAVED', () => {
    it('clears unsavedChanges flag', () => {
      const state = createTestState({ hasUnsavedChanges: true });
      const next = reduce(state, { type: 'MARK_SAVED' });
      expect(next.hasUnsavedChanges).toBe(false);
    });
  });

  // ── Double Tap Navigation Tests ─────────────────────────────────────────────

  describe('double tap navigation', () => {
    it('opens menu from idle', () => {
      const state = createTestState({ phase: 'idle' });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('menu');
    });

    it('menu double-tap closes the menu (back to game) without arming the exit dialog', () => {
      // App exit is the menu's tappable "Exit" item, not double-tap. Double-tap in the menu backs
      // out to the game (double-tap = back-one-level), and must NOT set pendingSystemExitDialog — a
      // stray double-tap must not surface the board-killing exit dialog.
      const state = createTestState({ phase: 'menu', previousPhase: 'pieceSelect' });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('pieceSelect');
      expect(next.pendingSystemExitDialog).toBeFalsy();
    });

    it('CLEAR_SYSTEM_EXIT_REQUEST clears the flag', () => {
      const state = createTestState({ phase: 'menu', pendingSystemExitDialog: true });
      const next = reduce(state, { type: 'CLEAR_SYSTEM_EXIT_REQUEST' });
      expect(next.pendingSystemExitDialog).toBe(false);
      expect(next.phase).toBe('menu');
    });

    it('RESTORE_STATE replays the saved state and resets transient flags', () => {
      // Simulate the headless WebView migration: a fresh initial state, then host injects a
      // snapshot that has an in-progress game with the engine "thinking."
      const fresh = createTestState({ phase: 'idle' });
      const saved = createTestState({
        phase: 'destSelect',
        selectedPieceId: 'w-n-g1',
        history: ['e4', 'e5'],
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
        engineThinking: true,
        pendingMove: { from: 'g1', to: 'f3', uci: 'g1f3', san: 'Nf3' } as never,
        pendingPromotionMove: { from: 'e7', to: 'e8' },
        pendingSystemExitDialog: true,
      });
      const next = reduce(fresh, { type: 'RESTORE_STATE', state: saved });
      // Game state survived.
      expect(next.phase).toBe('destSelect');
      expect(next.history).toEqual(['e4', 'e5']);
      expect(next.fen).toBe(saved.fen);
      expect(next.selectedPieceId).toBe('w-n-g1');
      // Transient flags reset — engine isn't actually thinking in the new WebView yet, and
      // any pendingMove/pendingPromotionMove from before the migration is stale.
      expect(next.engineThinking).toBe(false);
      expect(next.pendingMove).toBeNull();
      expect(next.pendingPromotionMove).toBeNull();
      expect(next.pendingSystemExitDialog).toBe(false);
    });

    it('RESTORE_STATE works even from a game-over state (bypasses the gameOver guard)', () => {
      // The reducer's gameOver guard blocks most actions; RESTORE_STATE must bypass it so a saved
      // mid-game snapshot can overwrite a stale "game over" state.
      const stale = createTestState({ phase: 'idle', gameOver: 'White wins on time!' });
      const saved = createTestState({ phase: 'idle', gameOver: null, history: ['e4'] });
      const next = reduce(stale, { type: 'RESTORE_STATE', state: saved });
      expect(next.gameOver).toBeNull();
      expect(next.history).toEqual(['e4']);
    });

    it('RESTORE_STATE clears mid-menu flags so a snapshot cannot trigger a reset or a clock resume', () => {
      const saved = createTestState({
        phase: 'resetConfirm', pendingReset: true, pendingPlayAs: 'black', bulletPausedForMenu: true,
      });
      const next = reduce(createTestState(), { type: 'RESTORE_STATE', state: saved });
      expect(next.phase).toBe('resetConfirm');
      expect(next.pendingReset).toBe(false);
      expect(next.pendingPlayAs).toBeNull();
      expect(next.bulletPausedForMenu).toBe(false);
    });

    it('RESTORE_STATE times a running clock from now and leaves a stopped one without a tick time', () => {
      const now = 1_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(now);
      try {
        const timers = { whiteMs: 60000, blackMs: 60000, incrementMs: 0 };
        const running = createTestState({ mode: 'bullet', timers, timerActive: true, lastTickTime: 5 });
        expect(reduce(createTestState(), { type: 'RESTORE_STATE', state: running }).lastTickTime).toBe(now);
        const stopped = createTestState({ mode: 'bullet', timers, timerActive: false, lastTickTime: 5 });
        expect(reduce(createTestState(), { type: 'RESTORE_STATE', state: stopped }).lastTickTime).toBeNull();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('returns from difficultySelect to menu', () => {
      const state = createTestState({ phase: 'difficultySelect' });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('menu');
    });

    it('returns from displayOptionsSelect to menu', () => {
      const state = createTestState({ phase: 'displayOptionsSelect' });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('menu');
    });

    it('returns from bulletSetup to modeSelect', () => {
      const state = createTestState({ phase: 'bulletSetup' });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('modeSelect');
    });

    it('returns from academySelect to modeSelect', () => {
      const state = createTestState({ phase: 'academySelect' });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('modeSelect');
    });
  });

  describe('Play As', () => {
    it('the Play As item opens playAsSelect at the current preference', () => {
      const state = createTestState({ phase: 'menu', playAs: 'black' });
      const next = pickMenu(state, 'playAs');
      expect(next.phase).toBe('playAsSelect');
      expect(next.menuSelectedIndex).toBe(1); // ['white','black','random'] → black = 1
    });

    it('scroll steps through White, Black, Random in order and wraps both ways', () => {
      // Settings phase: scroll direction inverted; `up` advances forward.
      const indexesAfter = (direction: 'up' | 'down') => {
        const seen: number[] = [];
        let s = createTestState({ phase: 'playAsSelect', menuSelectedIndex: 0 });
        for (let i = 0; i < 3; i++) {
          s = reduce(s, { type: 'SCROLL', direction });
          seen.push(s.menuSelectedIndex);
        }
        return seen;
      };
      expect(indexesAfter('up')).toEqual([1, 2, 0]);
      expect(indexesAfter('down')).toEqual([2, 1, 0]);
    });

    it('tap on a fresh board applies immediately (→ idle) and sets the preference', () => {
      const state = createTestState({ phase: 'playAsSelect', menuSelectedIndex: 1, history: [] });
      const next = reduce(state, { type: 'TAP' });
      expect(next.playAs).toBe('black');
      expect(next.phase).toBe('idle');
    });

    it('tap mid-game routes through the reset confirmation, deferring the choice', () => {
      const state = createTestState({ phase: 'playAsSelect', menuSelectedIndex: 2, playAs: 'white', history: ['e4', 'e5'] });
      const next = reduce(state, { type: 'TAP' });
      expect(next.playAs).toBe('white');         // NOT committed until reset is confirmed
      expect(next.pendingPlayAs).toBe('random'); // deferred choice
      expect(next.phase).toBe('resetConfirm');
      expect(next.menuSelectedIndex).toBe(1); // default to Cancel
    });

    it('double-tap returns to the menu at the Play As item', () => {
      const state = createTestState({ phase: 'playAsSelect', menuSelectedIndex: 1 });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('menu');
      expect(next.menuSelectedIndex).toBe(MENU_INDEX.playAs);
    });

    it('SET_PLAYER_COLOR updates the resolved color', () => {
      const state = createTestState({ playerColor: 'w' });
      expect(reduce(state, { type: 'SET_PLAYER_COLOR', color: 'b' }).playerColor).toBe('b');
    });

    it('rowSelect swipe inverts for Black so swipe-up still moves the band up the screen', () => {
      const threeRows: PieceEntry[] = [
        { id: 'w-n-g1', label: 'Ng1', color: 'w', type: 'n', square: 'g1', moves: [{ uci: 'g1f3', san: 'Nf3', from: 'g1', to: 'f3' }] },
        { id: 'w-p-e2', label: 'Pe2', color: 'w', type: 'p', square: 'e2', moves: [{ uci: 'e2e3', san: 'e3', from: 'e2', to: 'e3' }] },
        { id: 'w-p-d4', label: 'Pd4', color: 'w', type: 'p', square: 'd4', moves: [{ uci: 'd4d5', san: 'd5', from: 'd4', to: 'd5' }] },
      ];
      // White: SCROLL down = next-higher rank (rank 1 → rank 2)
      const w = createTestState({ phase: 'rowSelect', selectedPieceId: 'w-n-g1', pieces: threeRows, playerColor: 'w' });
      expect(reduce(w, { type: 'SCROLL', direction: 'down' }).selectedPieceId).toBe('w-p-e2');
      // Black (flipped): SCROLL down must invert → previous (wraps rank 1 → rank 4)
      const b = createTestState({ phase: 'rowSelect', selectedPieceId: 'w-n-g1', pieces: threeRows, playerColor: 'b' });
      expect(reduce(b, { type: 'SCROLL', direction: 'down' }).selectedPieceId).toBe('w-p-d4');
      // White with Position: Top is drawn flipped too, so it inverts like Black.
      const wTop = createTestState({ phase: 'rowSelect', selectedPieceId: 'w-n-g1', pieces: threeRows, playerColor: 'w', boardPosition: 'top' });
      expect(reduce(wTop, { type: 'SCROLL', direction: 'down' }).selectedPieceId).toBe('w-p-d4');
      // Black with Position: Top is drawn unflipped (White at the bottom), so it does not invert.
      const bTop = createTestState({ phase: 'rowSelect', selectedPieceId: 'w-n-g1', pieces: threeRows, playerColor: 'b', boardPosition: 'top' });
      expect(reduce(bTop, { type: 'SCROLL', direction: 'down' }).selectedPieceId).toBe('w-p-e2');
    });
  });

  describe('Play As choice is deferred until reset is confirmed', () => {
    const openPlayAs = (state: GameState) =>
      pickMenu(reduce(state, { type: 'DOUBLE_TAP' }), 'playAs');

    it('in-progress: picking a side defers to pendingPlayAs without changing playAs', () => {
      let s = openPlayAs(createTestState({ phase: 'idle', playAs: 'white', history: ['e4', 'e5'] }));
      expect(s.phase).toBe('playAsSelect');
      s = { ...s, menuSelectedIndex: 1 }; // 'black'
      s = reduce(s, { type: 'TAP' });
      expect(s.phase).toBe('resetConfirm');
      expect(s.playAs).toBe('white');        // NOT committed yet
      expect(s.pendingPlayAs).toBe('black');
    });

    it('in-progress: Cancel leaves the side unchanged and clears the deferred choice', () => {
      let s = openPlayAs(createTestState({ phase: 'idle', playAs: 'white', history: ['e4', 'e5'] }));
      s = { ...s, menuSelectedIndex: 1 }; // black
      s = reduce(s, { type: 'TAP' }); // → resetConfirm (cursor on Cancel)
      s = reduce(s, { type: 'TAP' }); // Cancel
      expect(s.playAs).toBe('white');        // unchanged (the reported bug)
      expect(s.pendingPlayAs).toBeFalsy();
    });

    it('in-progress: double-tap back also discards the deferred choice', () => {
      let s = openPlayAs(createTestState({ phase: 'idle', playAs: 'white', history: ['e4', 'e5'] }));
      s = { ...s, menuSelectedIndex: 1 };
      s = reduce(s, { type: 'TAP' }); // → resetConfirm
      s = reduce(s, { type: 'DOUBLE_TAP' });
      expect(s.playAs).toBe('white');
      expect(s.pendingPlayAs).toBeFalsy();
    });

    it('in-progress: Confirm commits the chosen side and flags the reset', () => {
      let s = openPlayAs(createTestState({ phase: 'idle', playAs: 'white', history: ['e4', 'e5'] }));
      s = { ...s, menuSelectedIndex: 1 }; // black
      s = reduce(s, { type: 'TAP' }); // → resetConfirm
      s = { ...s, menuSelectedIndex: 0 }; // Confirm
      s = reduce(s, { type: 'TAP' });
      expect(s.playAs).toBe('black');        // committed
      expect(s.pendingPlayAs).toBeFalsy();
      expect(s.pendingReset).toBe(true);
    });

    it('fresh board: applies immediately without a confirmation', () => {
      let s = openPlayAs(createTestState({ phase: 'idle', playAs: 'white', history: [] }));
      s = { ...s, menuSelectedIndex: 1 }; // black
      s = reduce(s, { type: 'TAP' });
      expect(s.phase).toBe('idle');
      expect(s.playAs).toBe('black');
    });
  });

  describe('BULLET_PAUSE / BULLET_RESUME (system-overlay clock pause)', () => {
    const bullet = (over?: Partial<GameState>) => createTestState({
      mode: 'bullet', phase: 'idle',
      timers: { whiteMs: 60000, blackMs: 60000, incrementMs: 0 },
      timerActive: true, lastTickTime: 1000, ...over,
    });

    it('PAUSE freezes a running clock and marks it paused-for-menu', () => {
      const next = reduce(bullet(), { type: 'BULLET_PAUSE' });
      expect(next.timerActive).toBe(false);
      expect(next.bulletPausedForMenu).toBe(true);
    });

    it('PAUSE is a no-op when the clock is not running', () => {
      const s = bullet({ timerActive: false });
      expect(reduce(s, { type: 'BULLET_PAUSE' })).toBe(s);
    });

    it('PAUSE is a no-op outside bullet mode', () => {
      const s = createTestState({ mode: 'play' });
      expect(reduce(s, { type: 'BULLET_PAUSE' })).toBe(s);
    });

    it('RESUME restarts a menu-paused clock in a game phase and resets lastTickTime', () => {
      const paused = bullet({ timerActive: false, bulletPausedForMenu: true, lastTickTime: 1000 });
      const next = reduce(paused, { type: 'BULLET_RESUME' });
      expect(next.timerActive).toBe(true);
      expect(next.bulletPausedForMenu).toBe(false);
      expect(next.lastTickTime).not.toBe(1000); // reset so the paused span isn't charged
    });

    it('RESUME never starts a clock that was not paused by the menu', () => {
      const s = bullet({ timerActive: false, bulletPausedForMenu: false });
      expect(reduce(s, { type: 'BULLET_RESUME' })).toBe(s);
    });

    it('RESUME does NOT fire in a menu sub-phase (that sub-screen resumes on its own)', () => {
      const s = bullet({ timerActive: false, bulletPausedForMenu: true, phase: 'difficultySelect' });
      expect(reduce(s, { type: 'BULLET_RESUME' })).toBe(s);
    });

    it('RESUME does not restart the clock after game over', () => {
      const s = bullet({ timerActive: false, bulletPausedForMenu: true, gameOver: 'White wins on time!' });
      expect(reduce(s, { type: 'BULLET_RESUME' })).toBe(s);
    });

    it('a menu opened before the first move does not start the clock on close', () => {
      // Fresh bullet game, clock not started: open the menu and close it again. The clock must
      // stay stopped.
      let s = bullet({ timerActive: false });
      s = reduce(s, { type: 'DOUBLE_TAP' });            // -> menu
      expect(s.phase).toBe('menu');
      s = reduce(s, { type: 'DOUBLE_TAP' });            // close -> gameplay
      expect(s.phase).toBe('idle');
      expect(s.timerActive).toBe(false);                // NOT started
    });
  });

  // ── Review batch B2 regressions ─────────────────────────────────────────────

  describe('bullet clock start (any way the player begins a move)', () => {
    const NOW = 1_000_000;
    beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(NOW); });
    afterEach(() => { vi.restoreAllMocks(); });

    const bulletIdle = (over?: Partial<GameState>) => createTestState({
      mode: 'bullet', phase: 'idle', timerActive: false, lastTickTime: null,
      timers: { whiteMs: 60000, blackMs: 60000, incrementMs: 0 }, ...over,
    });

    it('starts on a scroll from idle, timing from now', () => {
      const next = reduce(bulletIdle(), { type: 'SCROLL', direction: 'down' });
      expect(next.phase).toBe('rowSelect');
      expect(next.timerActive).toBe(true);
      expect(next.lastTickTime).toBe(NOW);
    });

    it('starts on a tap from idle, timing from now', () => {
      const next = reduce(bulletIdle(), { type: 'TAP' });
      expect(next.phase).toBe('rowSelect');
      expect(next.timerActive).toBe(true);
      expect(next.lastTickTime).toBe(NOW);
    });

    it('starts when voice input starts, timing from now', () => {
      const next = reduce(bulletIdle(), { type: 'VOICE_LISTEN_START' });
      expect(next.voice?.listening).toBe(true);
      expect(next.timerActive).toBe(true);
      expect(next.lastTickTime).toBe(NOW);
    });

    it('a clock that is already running keeps its last tick time', () => {
      const next = reduce(bulletIdle({ timerActive: true, lastTickTime: NOW - 400 }), { type: 'TAP' });
      expect(next.timerActive).toBe(true);
      expect(next.lastTickTime).toBe(NOW - 400);
    });

    it('does not start outside Bullet mode', () => {
      const next = reduce(createTestState({ mode: 'play' }), { type: 'TAP' });
      expect(next.timerActive).toBe(false);
    });
  });

  describe('moves are blocked while it is not the player\'s turn', () => {
    const blocked: Array<[string, Partial<GameState>]> = [
      ['the engine is thinking', { engineThinking: true }],
      ['a move is still being played', { pendingMove: { uci: 'g1f3', san: 'Nf3', from: 'g1', to: 'f3' } }],
      ['it is the engine\'s turn (resumed game)', { turn: 'b', playerColor: 'w' }],
    ];
    it.each(blocked)('idle scroll and tap do nothing while %s', (_why, over) => {
      const state = createTestState({ phase: 'idle', ...over });
      expect(reduce(state, { type: 'SCROLL', direction: 'down' })).toBe(state);
      expect(reduce(state, { type: 'TAP' })).toBe(state);
    });

    it('allows selection on the player\'s own turn as Black', () => {
      const state = createTestState({ phase: 'idle', turn: 'b', playerColor: 'b' });
      expect(reduce(state, { type: 'TAP' }).phase).toBe('rowSelect');
    });
  });

  describe('menu exits never leave the clock flagged as paused', () => {
    const runningBullet = () => createTestState({
      mode: 'bullet', phase: 'idle', timerActive: true, lastTickTime: 1,
      timers: { whiteMs: 60000, blackMs: 60000, incrementMs: 0 }, history: ['e4', 'e5'],
    });

    it('reset confirm, then opening and closing the menu, does not start a fresh clock', () => {
      let s = reduce(runningBullet(), { type: 'DOUBLE_TAP' });       // menu (clock paused)
      expect(s.timerActive).toBe(false);
      s = pickMenu(s, 'reset');
      s = reduce({ ...s, menuSelectedIndex: 0 }, { type: 'TAP' }); // Confirm
      expect(s.pendingReset).toBe(true);
      s = reduce(s, { type: 'NEW_GAME' });
      s = reduce(s, { type: 'DOUBLE_TAP' });                          // open menu
      s = reduce(s, { type: 'DOUBLE_TAP' });                          // close menu
      expect(s.phase).toBe('idle');
      expect(s.history).toEqual([]);
      expect(s.timerActive).toBe(false);
    });

    it('opening the menu pauses a running clock; closing it resumes from now', () => {
      const now = 1_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(now);
      try {
        const running = { ...runningBullet(), lastTickTime: now - 5000 };
        const menu = reduce(running, { type: 'DOUBLE_TAP' });
        expect(menu.phase).toBe('menu');
        expect(menu.timerActive).toBe(false);
        expect(menu.bulletPausedForMenu).toBe(true);
        expect(menu.timers).toEqual(running.timers);
        const back = reduce(menu, { type: 'DOUBLE_TAP' });
        expect(back.phase).toBe('idle');
        expect(back.timerActive).toBe(true);
        expect(back.lastTickTime).toBe(now); // the time spent in the menu is not charged
        expect(back.bulletPausedForMenu).toBe(false);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('switching to Play vs AI from the paused menu clears the pause flag', () => {
      let s = reduce(runningBullet(), { type: 'DOUBLE_TAP' });
      expect(s.bulletPausedForMenu).toBe(true);
      s = pickMenu(s, 'mode');
      s = reduce({ ...s, menuSelectedIndex: MODE_OPTIONS.indexOf('play') }, { type: 'TAP' });
      expect(s.mode).toBe('play');
      expect(s.bulletPausedForMenu).toBe(false);
      expect(s.timerActive).toBe(false);
    });

    it('starting an Academy drill from the paused menu clears the pause flag', () => {
      let s = reduce(runningBullet(), { type: 'DOUBLE_TAP' });
      s = pickMenu(s, 'mode');
      s = reduce({ ...s, menuSelectedIndex: MODE_OPTIONS.indexOf('academy') }, { type: 'TAP' });
      s = reduce({ ...s, menuSelectedIndex: DRILL_OPTIONS.indexOf('coordinate') }, { type: 'TAP' });
      expect(s.phase).toBe('coordinateDrill');
      expect(s.bulletPausedForMenu).toBe(false);
      expect(s.timerActive).toBe(false);
    });

    it('applying Play As on a fresh board clears the pause flag', () => {
      let s = reduce({ ...runningBullet(), history: [] }, { type: 'DOUBLE_TAP' });
      expect(s.bulletPausedForMenu).toBe(true);
      s = pickMenu(s, 'playAs');
      s = reduce(s, { type: 'TAP' });
      expect(s.phase).toBe('idle');
      expect(s.bulletPausedForMenu).toBe(false);
    });
  });

  describe('Mode: Bullet and Academy commit only when started', () => {
    it('peeking at Academy and backing out keeps the running bullet game and its clock', () => {
      const timers = { whiteMs: 30000, blackMs: 60000, incrementMs: 0 };
      let s = createTestState({ mode: 'bullet', phase: 'idle', timerActive: true, lastTickTime: 1, timers, history: ['e4'] });
      s = reduce(s, { type: 'DOUBLE_TAP' });                          // menu, clock paused
      s = pickMenu(s, 'mode');
      s = reduce({ ...s, menuSelectedIndex: 2 }, { type: 'TAP' }); // Academy
      expect(s.phase).toBe('academySelect');
      s = reduce(s, { type: 'DOUBLE_TAP' });                          // → modeSelect
      s = reduce(s, { type: 'DOUBLE_TAP' });                          // → menu
      s = reduce(s, { type: 'DOUBLE_TAP' });                          // → game
      expect(s.phase).toBe('idle');
      expect(s.mode).toBe('bullet');
      expect(s.timers).toEqual(timers);
      expect(s.timerActive).toBe(true);
    });

    it('peeking at Bullet Blitz from Play and backing out leaves an untimed Play game', () => {
      let s = createTestState({ mode: 'play', phase: 'modeSelect', previousPhase: 'idle', menuSelectedIndex: 1 });
      s = reduce(s, { type: 'TAP' }); // → bulletSetup
      s = reduce(s, { type: 'DOUBLE_TAP' });                          // → modeSelect
      expect(s.mode).toBe('play');
      expect(reduce(s, { type: 'NEW_GAME' }).timers).toBeUndefined();
    });

    it('starting a time control commits Bullet mode with fresh clocks', () => {
      const s = reduce(createTestState({ mode: 'play', phase: 'bulletSetup', selectedTimeControlIndex: 0 }),
        { type: 'TAP' });
      expect(s.mode).toBe('bullet');
      expect(s.phase).toBe('idle');
      expect(s.timers).toEqual({ whiteMs: TIME_CONTROLS[0]!.initialMs, blackMs: TIME_CONTROLS[0]!.initialMs, incrementMs: TIME_CONTROLS[0]!.incrementMs });
    });

    it('starting a drill commits Academy mode and stops any bullet clock', () => {
      const s = reduce(createTestState({
        mode: 'bullet', phase: 'academySelect', menuSelectedIndex: 0, timerActive: false,
        timers: { whiteMs: 1, blackMs: 1, incrementMs: 0 },
      }), { type: 'TAP' });
      expect(s.mode).toBe('academy');
      expect(s.phase).toBe('coordinateDrill');
      expect(s.timers).toBeUndefined();
    });
  });

  describe('new game after game over resets every per-game field', () => {
    it('clears last-move squares, promotion, log offset, and pause flags; resets bullet clocks', () => {
      const s = reduce(createTestState({
        gameOver: 'Checkmate', mode: 'bullet', selectedTimeControlIndex: 1, history: ['e4'],
        playerLastMoveToSquare: 'g1', pendingPromotionMove: { from: 'e7', to: 'e8' },
        selectedPromotionIndex: 2, logScrollOffset: 3, bulletPausedForMenu: true, pendingPlayAs: 'black',
        timers: { whiteMs: 5, blackMs: 0, incrementMs: 0 },
      }), { type: 'DOUBLE_TAP' });
      expect(s.gameOver).toBeNull();
      expect(s.history).toEqual([]);
      expect(s.playerLastMoveToSquare).toBeNull();
      expect(s.pendingPromotionMove).toBeNull();
      expect(s.selectedPromotionIndex).toBe(0);
      expect(s.logScrollOffset).toBe(0);
      expect(s.bulletPausedForMenu).toBe(false);
      expect(s.pendingPlayAs).toBeNull();
      expect(s.timers?.whiteMs).toBe(TIME_CONTROLS[1]!.initialMs);
    });
  });

  describe('flag fall ends the game like checkmate', () => {
    it('returns to idle and clears the half-made selection', () => {
      const now = 1_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(now);
      try {
        const s = reduce(createTestState({
          mode: 'bullet', phase: 'promotionSelect', selectedPieceId: 'w-n-g1', selectedMoveIndex: 1,
          pendingPromotionMove: { from: 'e7', to: 'e8' }, timerActive: true, lastTickTime: now - 5000,
          timers: { whiteMs: 1000, blackMs: 60000, incrementMs: 0 },
        }), { type: 'TIMER_TICK' });
        expect(s.gameOver).toBe('Black wins on time!');
        expect(s.phase).toBe('idle');
        expect(s.selectedPieceId).toBeNull();
        expect(s.pendingPromotionMove).toBeNull();
        expect(s.timers?.whiteMs).toBe(0);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  describe('back-navigation returns to the menu item that led there', () => {
    it('View Log double-tap highlights View Log', () => {
      const s = reduce(createTestState({ phase: 'viewLog' }), { type: 'DOUBLE_TAP' });
      expect(s.phase).toBe('menu');
      expect(s.menuSelectedIndex).toBe(MENU_INDEX.viewLog);
    });

    it.each([
      ['Cancel', (s: GameState) => reduce({ ...s, menuSelectedIndex: 1 }, { type: 'TAP' })],
      ['double-tap', (s: GameState) => reduce(s, { type: 'DOUBLE_TAP' })],
    ])('%s from a Play-As confirmation highlights Play As; from Reset highlights Reset', (_how, back) => {
      const fromPlayAs = back(createTestState({ phase: 'resetConfirm', pendingPlayAs: 'black' }));
      expect(fromPlayAs.menuSelectedIndex).toBe(MENU_INDEX.playAs);
      const fromReset = back(createTestState({ phase: 'resetConfirm', pendingPlayAs: null }));
      expect(fromReset.menuSelectedIndex).toBe(MENU_INDEX.reset);
    });
  });

  describe('Knight Path cursor', () => {
    it('starts on a legal knight move, so the first tap makes a move', () => {
      let s = reduce(createTestState({ phase: 'academySelect', menuSelectedIndex: DRILL_OPTIONS.indexOf('knightPath') }), { type: 'TAP' });
      expect(s.phase).toBe('knightPathDrill');
      const kp = s.academyState!.knightPath!;
      const cursor = indicesToSquare(s.academyState!.cursorFile, s.academyState!.cursorRank).toLowerCase();
      expect(getKnightMoves(kp.startSquare)).toContain(cursor);
      s = reduce(s, { type: 'TAP' });
      expect(s.academyState!.knightPath!.movesTaken).toBe(1);
    });

    it('a first scroll from a non-move square lands on the first legal move', () => {
      let s = reduce(createTestState({ phase: 'academySelect', menuSelectedIndex: DRILL_OPTIONS.indexOf('knightPath') }), { type: 'TAP' });
      const [startFile, startRank] = squareToIndices(s.academyState!.knightPath!.startSquare);
      s = { ...s, academyState: { ...s.academyState!, cursorFile: startFile, cursorRank: startRank } };
      s = reduce(s, { type: 'SCROLL', direction: 'down' });
      const cursor = indicesToSquare(s.academyState!.cursorFile, s.academyState!.cursorRank).toLowerCase();
      expect(cursor).toBe(getKnightMoves(s.academyState!.knightPath!.startSquare)[0]);
    });
  });

  describe('Knight Path taps and scrolls', () => {
    /** A Knight Path drill from b1 to e4 (two moves: b1-c3-e4), with the cursor on `cursor`. */
    const knightDrill = (cursor: string, path: Partial<NonNullable<NonNullable<GameState['academyState']>['knightPath']>> = {}) => {
      const [cursorFile, cursorRank] = squareToIndices(cursor);
      return createTestState({
        phase: 'knightPathDrill',
        academyState: {
          drillType: 'knightPath', score: { correct: 3, total: 5 }, cursorFile, cursorRank,
          navAxis: 'file', feedback: 'none',
          knightPath: {
            startSquare: 'b1', targetSquare: 'e4', currentSquare: 'b1', optimalMoves: 2,
            movesTaken: 0, path: ['b1'], ...path,
          },
        },
      });
    };
    const cursorOf = (s: GameState) => indicesToSquare(s.academyState!.cursorFile, s.academyState!.cursorRank);

    it('a tap on a legal square moves the knight and puts the cursor on its first move from there', () => {
      const next = reduce(knightDrill('c3'), { type: 'TAP' });
      expect(next.academyState!.knightPath).toEqual({
        startSquare: 'b1', targetSquare: 'e4', currentSquare: 'c3', optimalMoves: 2, movesTaken: 1, path: ['b1', 'c3'],
      });
      expect(cursorOf(next)).toBe(getKnightMoves('c3')[0]);
      expect(next.academyState!.feedback).toBe('none');
    });

    it('a tap on a square the knight cannot reach does nothing', () => {
      const state = knightDrill('b2');
      expect(reduce(state, { type: 'TAP' })).toBe(state);
    });

    it('reaching the target in the optimal number of moves scores a correct answer', () => {
      const next = reduce(knightDrill('e4', { currentSquare: 'c3', movesTaken: 1, path: ['b1', 'c3'] }), { type: 'TAP' });
      expect(next.academyState!.feedback).toBe('correct');
      expect(next.academyState!.score).toEqual({ correct: 4, total: 6 });
      expect(next.academyState!.knightPath!.path).toEqual(['b1', 'c3', 'e4']);
    });

    it('reaching the target in more than the optimal moves scores it as incorrect', () => {
      const next = reduce(knightDrill('e4', { currentSquare: 'c3', movesTaken: 3, path: ['b1', 'a3', 'b5', 'c3'] }), { type: 'TAP' });
      expect(next.academyState!.feedback).toBe('incorrect');
      expect(next.academyState!.score).toEqual({ correct: 3, total: 6 });
    });

    it('using optimal + 2 moves without reaching the target ends the puzzle as incorrect', () => {
      // Optimal is 2; this is move 4 and a4 is not the target.
      const next = reduce(knightDrill('a4', { currentSquare: 'c3', movesTaken: 3, path: ['b1', 'a3', 'b1', 'c3'] }), { type: 'TAP' });
      expect(next.academyState!.feedback).toBe('incorrect');
      expect(next.academyState!.score).toEqual({ correct: 3, total: 6 });
      expect(next.academyState!.knightPath!.movesTaken).toBe(4);
    });

    it('a tap after feedback loads the next puzzle with the cursor on a legal first move', () => {
      vi.mocked(generateKnightPuzzle).mockReturnValueOnce({ start: 'g1', target: 'g5', optimalMoves: 2 });
      const done = knightDrill('e4');
      const next = reduce({ ...done, academyState: { ...done.academyState!, feedback: 'correct' } }, { type: 'TAP' });
      expect(next.academyState!.knightPath).toEqual({
        startSquare: 'g1', targetSquare: 'g5', currentSquare: 'g1', optimalMoves: 2, movesTaken: 0, path: ['g1'],
      });
      expect(next.academyState!.feedback).toBe('none');
      expect(cursorOf(next)).toBe(getKnightMoves('g1')[0]);
      expect(next.academyState!.score).toEqual({ correct: 3, total: 5 }); // the score carries over
    });

    it('scrolling steps the cursor through the knight\'s legal moves and wraps', () => {
      // From b1 the knight can reach a3, c3, d2 (in getKnightMoves order).
      expect(getKnightMoves('b1')).toEqual(['a3', 'c3', 'd2']);
      expect(cursorOf(reduce(knightDrill('a3'), { type: 'SCROLL', direction: 'down' }))).toBe('c3');
      expect(cursorOf(reduce(knightDrill('d2'), { type: 'SCROLL', direction: 'down' }))).toBe('a3');
      expect(cursorOf(reduce(knightDrill('a3'), { type: 'SCROLL', direction: 'up' }))).toBe('d2');
    });
  });

  describe('Tactics and Mate taps', () => {
    const puzzleDrill = (drillType: 'tactics' | 'mate', feedback: 'none' | 'correct') => createTestState({
      phase: drillType === 'mate' ? 'mateDrill' : 'tacticsDrill',
      academyState: {
        drillType, score: { correct: 1, total: 4 }, cursorFile: 0, cursorRank: 0, navAxis: 'file', feedback,
        tacticsPuzzle: drillType === 'mate' ? MATE_PUZZLES[0]! : TACTICS_PUZZLES[0]!, tacticsSolutionIndex: 0,
      },
    });

    it('the first tap reveals the answer and counts it toward the total only', () => {
      const next = reduce(puzzleDrill('tactics', 'none'), { type: 'TAP' });
      expect(next.academyState!.feedback).toBe('correct');
      expect(next.academyState!.score).toEqual({ correct: 1, total: 5 });
      expect(next.academyState!.tacticsPuzzle).toBe(TACTICS_PUZZLES[0]);
    });

    it('a tap after the reveal loads the next tactics puzzle', () => {
      vi.mocked(getRandomTacticsPuzzle).mockReturnValueOnce(TACTICS_PUZZLES[3]!);
      const next = reduce(puzzleDrill('tactics', 'correct'), { type: 'TAP' });
      expect(next.academyState!.tacticsPuzzle).toBe(TACTICS_PUZZLES[3]);
      expect(next.academyState!.feedback).toBe('none');
      expect(next.academyState!.tacticsSolutionIndex).toBe(0);
      expect(next.academyState!.score).toEqual({ correct: 1, total: 4 });
    });

    it('a tap after the reveal in the Mate drill loads the next mate puzzle', () => {
      vi.mocked(getRandomMatePuzzle).mockReturnValueOnce(MATE_PUZZLES[2]!);
      const next = reduce(puzzleDrill('mate', 'correct'), { type: 'TAP' });
      expect(next.phase).toBe('mateDrill');
      expect(next.academyState!.tacticsPuzzle).toBe(MATE_PUZZLES[2]);
      expect(next.academyState!.feedback).toBe('none');
    });
  });

  describe('PGN Study taps and scrolls', () => {
    const game = FAMOUS_GAMES[0]!;
    const pgnDrill = (currentMoveIndex: number) => createTestState({
      phase: 'pgnStudy',
      academyState: {
        drillType: 'pgn', score: { correct: 2, total: 2 }, cursorFile: 0, cursorRank: 0, navAxis: 'file', feedback: 'none',
        pgnStudy: { gameName: game.name, moves: game.moves, currentMoveIndex, fen: STARTING_FEN, guessMode: false },
      },
    });

    it('scrolling down steps forward one move and scrolling up steps back', () => {
      expect(reduce(pgnDrill(3), { type: 'SCROLL', direction: 'down' }).academyState!.pgnStudy!.currentMoveIndex).toBe(4);
      expect(reduce(pgnDrill(3), { type: 'SCROLL', direction: 'up' }).academyState!.pgnStudy!.currentMoveIndex).toBe(2);
    });

    it('scrolling stops at the start and at the end of the game', () => {
      const start = pgnDrill(0);
      expect(reduce(start, { type: 'SCROLL', direction: 'up' })).toBe(start);
      const end = pgnDrill(game.moves.length);
      expect(reduce(end, { type: 'SCROLL', direction: 'down' })).toBe(end);
    });

    it('a tap mid-game jumps to the final position without scoring', () => {
      const next = reduce(pgnDrill(3), { type: 'TAP' });
      expect(next.academyState!.pgnStudy!.currentMoveIndex).toBe(game.moves.length);
      expect(next.academyState!.pgnStudy!.gameName).toBe(game.name);
      expect(next.academyState!.score).toEqual({ correct: 2, total: 2 });
    });

    it('a tap at the end of the game loads the next game from the start and counts the finished one', () => {
      const nextGame = FAMOUS_GAMES[1]!;
      vi.mocked(getRandomFamousGame).mockReturnValueOnce(nextGame);
      const next = reduce(pgnDrill(game.moves.length), { type: 'TAP' });
      expect(next.academyState!.pgnStudy).toEqual({
        gameName: nextGame.name, moves: nextGame.moves, currentMoveIndex: 0, fen: STARTING_FEN, guessMode: false,
      });
      expect(next.academyState!.score).toEqual({ correct: 3, total: 3 });
    });
  });

  describe('VOICE_STATUS_EXPIRE', () => {
    it('clears the status it was scheduled for', () => {
      const s = createTestState({ voice: { listening: false, status: "Didn't catch that", statusExpiresAt: 42, pendingConfirm: null } });
      const next = reduce(s, { type: 'VOICE_STATUS_EXPIRE', expiresAt: 42 });
      expect(next.voice?.status).toBeNull();
      expect(next.voice?.statusExpiresAt).toBeNull();
    });

    it('ignores a stale expiry for a status that has since been replaced', () => {
      const s = createTestState({ voice: { listening: false, status: 'Played e4', statusExpiresAt: 99, pendingConfirm: null } });
      expect(reduce(s, { type: 'VOICE_STATUS_EXPIRE', expiresAt: 42 })).toBe(s);
    });
  });
});
