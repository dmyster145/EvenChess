import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reduce } from '../../src/state/reducer';
import type { GameState, PieceEntry, Action } from '../../src/state/contracts';
import { MAX_HISTORY_LENGTH, MENU_OPTION_COUNT, TIME_CONTROLS, MENU_INDEX } from '../../src/state/constants';

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
    lastMoveToSquare: null,
    playerLastMoveToSquare: null,
    engineThinking: false,
    inCheck: false,
    gameOver: null,
    pendingMove: null,
    menuSelectedIndex: 0,
    hasUnsavedChanges: false,
    previousPhase: null,
    difficulty: 'casual',
    logScrollOffset: 0,
    phaseEnteredAt: Date.now(),
    timerActive: false,
    lastTickTime: null,
    selectedTimeControlIndex: 2,
    showBoardMarkers: true,
    playAs: 'white',
    playerColor: 'w',
    ...overrides,
  };
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
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.phase).toBe('rowSelect');
    });

    it('descends rowSelect → pieceSelect on tap, keeping the selected piece', () => {
      const state = createTestState({ phase: 'rowSelect', selectedPieceId: 'w-p-e2' });
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.phase).toBe('pieceSelect');
      expect(next.selectedPieceId).toBe('w-p-e2');
    });

    it('transitions from pieceSelect to destSelect using internal selection', () => {
      const state = createTestState({ phase: 'pieceSelect', selectedPieceId: 'w-n-g1' });
      // TAP confirms the internally-tracked piece (w-n-g1)
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.phase).toBe('destSelect');
      expect(next.selectedPieceId).toBe('w-n-g1');
      expect(next.selectedMoveIndex).toBe(0);
    });

    it('transitions from pieceSelect with second piece selected', () => {
      const state = createTestState({ phase: 'pieceSelect', selectedPieceId: 'w-p-e2' });
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.phase).toBe('destSelect');
      expect(next.selectedPieceId).toBe('w-p-e2');
    });

    it('commits a move from destSelect using internal selection', () => {
      const state = createTestState({
        phase: 'destSelect',
        selectedPieceId: 'w-n-g1',
        selectedMoveIndex: 1, // second destination = Nh3
      });
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
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
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
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
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
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
    it('records the engine move and returns to idle', () => {
      const state = createTestState({ engineThinking: true });
      const action: Action = { type: 'ENGINE_MOVE', uci: 'e7e5', san: 'e5' };
      const next = reduce(state, action);
      expect(next.engineThinking).toBe(false);
      expect(next.lastMove).toBe('e5');
      expect(next.history).toContain('e5');
      expect(next.pendingMove).toBeNull();
    });
  });

  describe('GAME_OVER', () => {
    it('blocks all actions except NEW_GAME', () => {
      const state = createTestState({ gameOver: 'checkmate' });
      const scrolled = reduce(state, { type: 'SCROLL', direction: 'down' });
      expect(scrolled).toBe(state); // unchanged

      const newGame = reduce(state, { type: 'NEW_GAME' });
      expect(newGame.gameOver).toBeNull();
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

  describe('OPEN_MENU', () => {
    it('opens menu from idle', () => {
      const state = createTestState({ phase: 'idle' });
      const next = reduce(state, { type: 'OPEN_MENU' });
      expect(next.phase).toBe('menu');
      expect(next.previousPhase).toBe('idle');
      expect(next.menuSelectedIndex).toBe(0);
    });

    it('opens menu from pieceSelect', () => {
      const state = createTestState({ phase: 'pieceSelect', selectedPieceId: 'w-n-g1' });
      const next = reduce(state, { type: 'OPEN_MENU' });
      expect(next.phase).toBe('menu');
      expect(next.previousPhase).toBe('pieceSelect');
    });

    it('preserves previousPhase when already in menu', () => {
      const state = createTestState({ phase: 'menu', previousPhase: 'destSelect' });
      const next = reduce(state, { type: 'OPEN_MENU' });
      expect(next.previousPhase).toBe('destSelect');
    });

    it('does not open menu during engine thinking', () => {
      const state = createTestState({ phase: 'idle', engineThinking: true });
      const next = reduce(state, { type: 'OPEN_MENU' });
      expect(next.phase).toBe('idle'); // Unchanged
    });
  });

  describe('CLOSE_MENU', () => {
    it('returns to previous phase', () => {
      const state = createTestState({ phase: 'menu', previousPhase: 'pieceSelect' });
      const next = reduce(state, { type: 'CLOSE_MENU' });
      expect(next.phase).toBe('pieceSelect');
      expect(next.previousPhase).toBeNull();
    });

    it('returns to idle when no previous phase', () => {
      const state = createTestState({ phase: 'menu', previousPhase: null });
      const next = reduce(state, { type: 'CLOSE_MENU' });
      expect(next.phase).toBe('idle');
    });
  });

  describe('MENU_SELECT', () => {
    it('navigates to modeSelect on mode option', () => {
      const state = createTestState({ phase: 'menu' });
      const next = reduce(state, { type: 'MENU_SELECT', option: 'mode' });
      expect(next.phase).toBe('modeSelect');
    });

    it('navigates to boardMarkersSelect on boardMarkers option', () => {
      const state = createTestState({ phase: 'menu', showBoardMarkers: true });
      const next = reduce(state, { type: 'MENU_SELECT', option: 'boardMarkers' });
      expect(next.phase).toBe('boardMarkersSelect');
      expect(next.menuSelectedIndex).toBe(0); // 'on' selected
    });

    it('navigates to viewLog on viewLog option', () => {
      const state = createTestState({ phase: 'menu', history: ['e4', 'e5'] });
      const next = reduce(state, { type: 'MENU_SELECT', option: 'viewLog' });
      expect(next.phase).toBe('viewLog');
    });

    it('navigates to difficultySelect on difficulty option', () => {
      const state = createTestState({ phase: 'menu', difficulty: 'serious' });
      const next = reduce(state, { type: 'MENU_SELECT', option: 'difficulty' });
      expect(next.phase).toBe('difficultySelect');
      expect(next.menuSelectedIndex).toBe(2); // 'serious' = index 2 (easy=0, casual=1, serious=2)
    });

    it('navigates to resetConfirm on reset option', () => {
      const state = createTestState({ phase: 'menu' });
      const next = reduce(state, { type: 'MENU_SELECT', option: 'reset' });
      expect(next.phase).toBe('resetConfirm');
      expect(next.menuSelectedIndex).toBe(1); // Cancel selected by default
    });

    it('closes the menu regardless of unsaved changes (autosave handles durability)', () => {
      const unsavedState = createTestState({ phase: 'menu', hasUnsavedChanges: true, previousPhase: 'idle' });
      const unsavedNext = reduce(unsavedState, { type: 'MENU_SELECT', option: 'exit' });
      expect(unsavedNext.phase).toBe('idle');

      const savedState = createTestState({ phase: 'menu', hasUnsavedChanges: false, previousPhase: 'idle' });
      const savedNext = reduce(savedState, { type: 'MENU_SELECT', option: 'exit' });
      expect(savedNext.phase).toBe('idle');
    });
  });

  describe('menu scroll navigation', () => {
    // Scroll direction is inverted in settings phases (see SETTINGS_PHASES in
    // reducer.ts) so that a physical scroll-down gesture moves the cursor to
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
      const state = createTestState({ phase: 'menu', menuSelectedIndex: MENU_INDEX.VIEW_LOG });
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.phase).toBe('viewLog');
    });
  });

  // ── Settings Tests ──────────────────────────────────────────────────────────

  describe('SET_DIFFICULTY', () => {
    it('sets difficulty and returns to menu', () => {
      const state = createTestState({ phase: 'difficultySelect', difficulty: 'casual' });
      const next = reduce(state, { type: 'SET_DIFFICULTY', level: 'serious' });
      expect(next.difficulty).toBe('serious');
      expect(next.phase).toBe('menu');
    });
  });

  describe('SET_BOARD_MARKERS', () => {
    it('enables board markers', () => {
      const state = createTestState({ phase: 'boardMarkersSelect', showBoardMarkers: false });
      const next = reduce(state, { type: 'SET_BOARD_MARKERS', enabled: true });
      expect(next.showBoardMarkers).toBe(true);
      expect(next.phase).toBe('menu');
    });

    it('disables board markers', () => {
      const state = createTestState({ phase: 'boardMarkersSelect', showBoardMarkers: true });
      const next = reduce(state, { type: 'SET_BOARD_MARKERS', enabled: false });
      expect(next.showBoardMarkers).toBe(false);
    });
  });

  describe('difficulty and board markers scroll', () => {
    it('cycles difficulty options', () => {
      // Settings phase: scroll direction inverted; `up` advances forward.
      const state = createTestState({ phase: 'difficultySelect', menuSelectedIndex: 0 });
      const next = reduce(state, { type: 'SCROLL', direction: 'up' });
      expect(next.menuSelectedIndex).toBe(1);
      const next2 = reduce(next, { type: 'SCROLL', direction: 'up' });
      expect(next2.menuSelectedIndex).toBe(2);
      const wrapped = reduce(next2, { type: 'SCROLL', direction: 'up' });
      expect(wrapped.menuSelectedIndex).toBe(0);
    });

    it('cycles board markers options', () => {
      // Settings phase: scroll direction inverted; `up` advances forward.
      const state = createTestState({ phase: 'boardMarkersSelect', menuSelectedIndex: 0 });
      const next = reduce(state, { type: 'SCROLL', direction: 'up' });
      expect(next.menuSelectedIndex).toBe(1);

      const wrapped = reduce(next, { type: 'SCROLL', direction: 'up' });
      expect(wrapped.menuSelectedIndex).toBe(0);
    });
  });

  describe('difficulty and board markers tap', () => {
    it('tap selects difficulty and returns to menu', () => {
      const state = createTestState({ phase: 'difficultySelect', menuSelectedIndex: 2 }); // index 2 = Serious
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.difficulty).toBe('serious');
      expect(next.phase).toBe('menu');
    });

    it('tap selects board markers and returns to menu', () => {
      const state = createTestState({ phase: 'boardMarkersSelect', menuSelectedIndex: 1 });
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.showBoardMarkers).toBe(false);
      expect(next.phase).toBe('menu');
    });
  });

  // ── Mode Tests ──────────────────────────────────────────────────────────────

  describe('SET_MODE', () => {
    it('sets play mode and returns to idle', () => {
      const state = createTestState({ phase: 'modeSelect', mode: 'bullet' });
      const next = reduce(state, { type: 'SET_MODE', mode: 'play' });
      expect(next.mode).toBe('play');
      expect(next.phase).toBe('idle');
      expect(next.timerActive).toBe(false);
    });

    it('sets bullet mode and goes to bulletSetup', () => {
      const state = createTestState({ phase: 'modeSelect', mode: 'play' });
      const next = reduce(state, { type: 'SET_MODE', mode: 'bullet' });
      expect(next.mode).toBe('bullet');
      expect(next.phase).toBe('bulletSetup');
    });

    it('sets academy mode and goes to academySelect', () => {
      const state = createTestState({ phase: 'modeSelect', mode: 'play' });
      const next = reduce(state, { type: 'SET_MODE', mode: 'academy' });
      expect(next.mode).toBe('academy');
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

    it('tap selects mode', () => {
      const state = createTestState({ phase: 'modeSelect', menuSelectedIndex: 1 });
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.mode).toBe('bullet');
      expect(next.phase).toBe('bulletSetup');
    });
  });

  // ── Bullet Timer Tests ──────────────────────────────────────────────────────

  describe('START_BULLET_GAME', () => {
    it('initializes timers with selected time control', () => {
      const state = createTestState({ phase: 'bulletSetup', selectedTimeControlIndex: 0 });
      const next = reduce(state, { type: 'START_BULLET_GAME', timeControlIndex: 0 });
      
      expect(next.phase).toBe('idle');
      expect(next.timers).toBeDefined();
      expect(next.timers!.whiteMs).toBe(TIME_CONTROLS[0].initialMs);
      expect(next.timers!.blackMs).toBe(TIME_CONTROLS[0].initialMs);
      expect(next.timers!.incrementMs).toBe(TIME_CONTROLS[0].incrementMs);
      expect(next.timerActive).toBe(false);
    });

    it('uses 3+5 time control when index 3', () => {
      const state = createTestState({ phase: 'bulletSetup' });
      const next = reduce(state, { type: 'START_BULLET_GAME', timeControlIndex: 3 });
      
      expect(next.timers!.whiteMs).toBe(180000); // 3 minutes
      expect(next.timers!.incrementMs).toBe(5000); // 5 seconds
    });
  });

  describe('bullet setup scroll and tap', () => {
    it('cycles time control options', () => {
      // Settings phase: scroll direction inverted; `up` advances forward.
      const state = createTestState({ phase: 'bulletSetup', selectedTimeControlIndex: 0 });
      const next = reduce(state, { type: 'SCROLL', direction: 'up' });
      expect(next.selectedTimeControlIndex).toBe(1);
    });

    it('tap starts bullet game', () => {
      const state = createTestState({ phase: 'bulletSetup', selectedTimeControlIndex: 2 });
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.phase).toBe('idle');
      expect(next.timers).toBeDefined();
      expect(next.timerActive).toBe(false);
    });
  });

  describe('TIMER_TICK', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
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

  describe('START_DRILL', () => {
    it('starts coordinate drill', () => {
      const state = createTestState({ phase: 'academySelect' });
      const next = reduce(state, { type: 'START_DRILL', drillType: 'coordinate' });
      
      expect(next.phase).toBe('coordinateDrill');
      expect(next.academyState).toBeDefined();
      expect(next.academyState!.drillType).toBe('coordinate');
      expect(next.academyState!.targetSquare).toBeDefined();
      expect(next.academyState!.score).toEqual({ correct: 0, total: 0 });
    });

    it('starts knight path drill', () => {
      const state = createTestState({ phase: 'academySelect' });
      const next = reduce(state, { type: 'START_DRILL', drillType: 'knightPath' });
      
      expect(next.phase).toBe('knightPathDrill');
      expect(next.academyState!.knightPath).toBeDefined();
      expect(next.academyState!.knightPath!.startSquare).toBeDefined();
      expect(next.academyState!.knightPath!.targetSquare).toBeDefined();
    });

    it('starts tactics drill', () => {
      const state = createTestState({ phase: 'academySelect' });
      const next = reduce(state, { type: 'START_DRILL', drillType: 'tactics' });
      
      expect(next.phase).toBe('tacticsDrill');
      expect(next.academyState!.tacticsPuzzle).toBeDefined();
    });

    it('starts mate drill', () => {
      const state = createTestState({ phase: 'academySelect' });
      const next = reduce(state, { type: 'START_DRILL', drillType: 'mate' });
      
      expect(next.phase).toBe('mateDrill');
      expect(next.academyState!.tacticsPuzzle).toBeDefined();
    });

    it('starts pgn study', () => {
      const state = createTestState({ phase: 'academySelect' });
      const next = reduce(state, { type: 'START_DRILL', drillType: 'pgn' });
      
      expect(next.phase).toBe('pgnStudy');
      expect(next.academyState!.pgnStudy).toBeDefined();
      expect(next.academyState!.pgnStudy!.gameName).toBeDefined();
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
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.phase).toBe('coordinateDrill');
    });
  });

  describe('DRILL_ANSWER', () => {
    it('increments correct count on correct answer', () => {
      const state = createTestState({
        phase: 'coordinateDrill',
        academyState: {
          drillType: 'coordinate',
          targetSquare: 'e4',
          score: { correct: 2, total: 5 },
          cursorFile: 4,
          cursorRank: 3,
          navAxis: 'file',
          feedback: 'none',
        },
      });
      
      const next = reduce(state, { type: 'DRILL_ANSWER', correct: true });
      
      expect(next.academyState!.score.correct).toBe(3);
      expect(next.academyState!.score.total).toBe(6);
    });

    it('does not increment correct count on incorrect answer', () => {
      const state = createTestState({
        phase: 'coordinateDrill',
        academyState: {
          drillType: 'coordinate',
          targetSquare: 'e4',
          score: { correct: 2, total: 5 },
          cursorFile: 4,
          cursorRank: 3,
          navAxis: 'file',
          feedback: 'none',
        },
      });
      
      const next = reduce(state, { type: 'DRILL_ANSWER', correct: false });
      
      expect(next.academyState!.score.correct).toBe(2);
      expect(next.academyState!.score.total).toBe(6);
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
      
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      
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
      
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      
      expect(next.academyState!.feedback).toBe('correct');
      expect(next.academyState!.score.correct).toBe(1);
      expect(next.academyState!.score.total).toBe(1);
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

  describe('exit confirm', () => {
    it('scroll toggles between options', () => {
      const state = createTestState({ phase: 'exitConfirm', menuSelectedIndex: 0 });
      const next = reduce(state, { type: 'SCROLL', direction: 'down' });
      expect(next.menuSelectedIndex).toBe(1);
      
      const toggled = reduce(next, { type: 'SCROLL', direction: 'down' });
      expect(toggled.menuSelectedIndex).toBe(0);
    });

    it('tap on confirm exits', () => {
      const state = createTestState({ phase: 'exitConfirm', menuSelectedIndex: 0 });
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.phase).toBe('idle');
    });

    it('tap on cancel returns to menu', () => {
      const state = createTestState({ phase: 'exitConfirm', menuSelectedIndex: 1 });
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.phase).toBe('menu');
    });

    it('double-tap returns to menu', () => {
      const state = createTestState({ phase: 'exitConfirm' });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('menu');
    });
  });

  describe('reset confirm', () => {
    it('scroll toggles between options', () => {
      const state = createTestState({ phase: 'resetConfirm', menuSelectedIndex: 1 });
      const next = reduce(state, { type: 'SCROLL', direction: 'up' });
      expect(next.menuSelectedIndex).toBe(0);
    });

    it('tap on confirm resets', () => {
      const state = createTestState({ phase: 'resetConfirm', menuSelectedIndex: 0 });
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.phase).toBe('idle');
    });

    it('tap on cancel returns to menu', () => {
      const state = createTestState({ phase: 'resetConfirm', menuSelectedIndex: 1 });
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.phase).toBe('menu');
    });
  });

  describe('CONFIRM_EXIT', () => {
    it('clears unsavedChanges when save is true', () => {
      const state = createTestState({ phase: 'exitConfirm', hasUnsavedChanges: true });
      const next = reduce(state, { type: 'CONFIRM_EXIT', save: true });
      expect(next.hasUnsavedChanges).toBe(false);
    });

    it('preserves unsavedChanges when save is false', () => {
      const state = createTestState({ phase: 'exitConfirm', hasUnsavedChanges: true });
      const next = reduce(state, { type: 'CONFIRM_EXIT', save: false });
      expect(next.hasUnsavedChanges).toBe(true);
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
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.phase).toBe('menu');
    });

    it('double-tap returns to menu', () => {
      const state = createTestState({ phase: 'viewLog' });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('menu');
    });
  });

  // ── History Capping Tests ───────────────────────────────────────────────────

  describe('history capping', () => {
    it('caps history at MAX_HISTORY_LENGTH on player move', () => {
      const longHistory = Array.from({ length: MAX_HISTORY_LENGTH }, (_, i) => `move${i}`);
      const state = createTestState({
        phase: 'destSelect',
        selectedPieceId: 'w-n-g1',
        selectedMoveIndex: 0,
        history: longHistory,
      });
      
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      
      expect(next.history.length).toBe(MAX_HISTORY_LENGTH);
      expect(next.history[next.history.length - 1]).toBe('Nf3');
    });

    it('caps history at MAX_HISTORY_LENGTH on engine move', () => {
      const longHistory = Array.from({ length: MAX_HISTORY_LENGTH }, (_, i) => `move${i}`);
      const state = createTestState({
        history: longHistory,
        engineThinking: true,
      });
      
      const next = reduce(state, {
        type: 'ENGINE_MOVE',
        uci: 'e7e5',
        san: 'e5',
        fen: 'new-fen',
        turn: 'w',
        pieces: [],
        inCheck: false,
      });
      
      expect(next.history.length).toBe(MAX_HISTORY_LENGTH);
      expect(next.history[next.history.length - 1]).toBe('e5');
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

  // ── Load Game Tests ─────────────────────────────────────────────────────────

  describe('LOAD_GAME', () => {
    it('loads saved game state', () => {
      const state = createTestState();
      const next = reduce(state, {
        type: 'LOAD_GAME',
        fen: 'saved-fen',
        history: ['e4', 'e5', 'Nf3'],
        turn: 'b',
      });
      
      expect(next.fen).toBe('saved-fen');
      expect(next.history).toEqual(['e4', 'e5', 'Nf3']);
      expect(next.turn).toBe('b');
      expect(next.phase).toBe('idle');
      expect(next.hasUnsavedChanges).toBe(false);
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

    it('requests the system exit dialog from menu (sets pendingSystemExitDialog, stays in menu)', () => {
      // Per ER guidance, double-tap in the settings menu surfaces the system "End this feature?"
      // confirmation dialog rather than closing the menu. The app subscriber observes the flag and
      // calls bridge.shutDownPageContainer(1).
      const state = createTestState({ phase: 'menu', previousPhase: 'pieceSelect' });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('menu');
      expect(next.pendingSystemExitDialog).toBe(true);
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

    it('returns from difficultySelect to menu', () => {
      const state = createTestState({ phase: 'difficultySelect' });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('menu');
    });

    it('returns from boardMarkersSelect to menu', () => {
      const state = createTestState({ phase: 'boardMarkersSelect' });
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
    it('MENU_SELECT playAs opens playAsSelect at the current preference', () => {
      const state = createTestState({ phase: 'menu', playAs: 'black' });
      const next = reduce(state, { type: 'MENU_SELECT', option: 'playAs' });
      expect(next.phase).toBe('playAsSelect');
      expect(next.menuSelectedIndex).toBe(1); // ['white','black','random'] → black = 1
    });

    it('scroll cycles the three options', () => {
      const s0 = createTestState({ phase: 'playAsSelect', menuSelectedIndex: 0 });
      const s1 = reduce(s0, { type: 'SCROLL', direction: 'down' });
      const s2 = reduce(s1, { type: 'SCROLL', direction: 'down' });
      const s3 = reduce(s2, { type: 'SCROLL', direction: 'down' });
      expect([s1.menuSelectedIndex, s2.menuSelectedIndex, s3.menuSelectedIndex].every((i) => i >= 0 && i < 3)).toBe(true);
      expect(s3.menuSelectedIndex).toBe(s0.menuSelectedIndex); // 3 steps wraps a 3-option list
    });

    it('tap on a fresh board applies immediately (→ idle) and sets the preference', () => {
      const state = createTestState({ phase: 'playAsSelect', menuSelectedIndex: 1, history: [] });
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.playAs).toBe('black');
      expect(next.phase).toBe('idle');
    });

    it('tap mid-game routes through the reset confirmation', () => {
      const state = createTestState({ phase: 'playAsSelect', menuSelectedIndex: 2, history: ['e4', 'e5'] });
      const next = reduce(state, { type: 'TAP', selectedIndex: 0, selectedName: '' });
      expect(next.playAs).toBe('random');
      expect(next.phase).toBe('resetConfirm');
      expect(next.menuSelectedIndex).toBe(1); // default to Cancel
    });

    it('double-tap returns to the menu at the Play As item', () => {
      const state = createTestState({ phase: 'playAsSelect', menuSelectedIndex: 1 });
      const next = reduce(state, { type: 'DOUBLE_TAP' });
      expect(next.phase).toBe('menu');
      expect(next.menuSelectedIndex).toBe(MENU_INDEX.PLAY_AS);
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
    });
  });
});
