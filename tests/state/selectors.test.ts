import { describe, it, expect, vi } from 'vitest';
import {
  getSelectedPiece,
  getSelectedMove,
  getCarouselItems,
  getCarouselSelectedIndex,
  getMenuDisplayText,
  getDifficultyDisplayText,
  getDisplayOptionsDisplayText,
  getBoardViewColor,
  getLogDisplayText,
  getResetConfirmDisplayText,
  getModeSelectDisplayText,
  getBulletSetupDisplayText,
  getAcademySelectDisplayText,
  getCoordinateDrillDisplayText,
  getKnightPathDisplayText,
  getTacticsDisplayText,
  getPgnStudyDisplayText,
  getCombinedDisplayText,
  getCandidateRows,
  getPiecesOnRow,
  getSelectedRow,
  getCapturedDisplay,
} from '../../src/state/selectors';
import { MENU_INDEX, TIME_CONTROLS } from '../../src/state/constants';
import type { GameState, PieceEntry } from '../../src/state/contracts';
import { baseGameState } from '../helpers/game-state';
import { EASY, CASUAL, SERIOUS, nearestCustomLevel, buildCustomEngineProfile } from '../../src/engine/profiles';

function createTestState(overrides?: Partial<GameState>): GameState {
  const pieces: PieceEntry[] = [
    {
      id: 'w-q-d1',
      label: 'Qd1',
      color: 'w',
      type: 'q',
      square: 'd1',
      moves: [
        { uci: 'd1d3', san: 'Qd3', from: 'd1', to: 'd3' },
        { uci: 'd1h5', san: 'Qh5', from: 'd1', to: 'h5' },
      ],
    },
    {
      id: 'w-n-f3',
      label: 'Nf3',
      color: 'w',
      type: 'n',
      square: 'f3',
      moves: [
        { uci: 'f3e5', san: 'Nxe5', from: 'f3', to: 'e5' },
      ],
    },
  ];

  return {
    ...baseGameState(),
    fen: 'test-fen',
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

describe('selectors', () => {
  describe('getSelectedPiece', () => {
    it('returns null when no piece selected', () => {
      const state = createTestState();
      expect(getSelectedPiece(state)).toBeNull();
    });

    it('returns the selected piece', () => {
      const state = createTestState({ selectedPieceId: 'w-q-d1' });
      const piece = getSelectedPiece(state);
      expect(piece).not.toBeNull();
      expect(piece!.label).toBe('Qd1');
    });
  });

  describe('getSelectedMove', () => {
    it('returns null when no piece selected', () => {
      const state = createTestState();
      expect(getSelectedMove(state)).toBeNull();
    });

    it('returns the highlighted move', () => {
      const state = createTestState({
        selectedPieceId: 'w-q-d1',
        selectedMoveIndex: 1,
      });
      const move = getSelectedMove(state);
      expect(move).not.toBeNull();
      expect(move!.san).toBe('Qh5');
    });
  });

  describe('row selectors', () => {
    const multiRow: PieceEntry[] = [
      { id: 'w-n-b1', label: 'Nb1', color: 'w', type: 'n', square: 'b1', moves: [{ uci: 'b1c3', san: 'Nc3', from: 'b1', to: 'c3' }] },
      { id: 'w-n-g1', label: 'Ng1', color: 'w', type: 'n', square: 'g1', moves: [{ uci: 'g1f3', san: 'Nf3', from: 'g1', to: 'f3' }] },
      { id: 'w-p-e2', label: 'Pe2', color: 'w', type: 'p', square: 'e2', moves: [{ uci: 'e2e4', san: 'e4', from: 'e2', to: 'e4' }] },
    ];

    it('getCandidateRows returns distinct ranks ascending, deduped', () => {
      const state = createTestState({ pieces: multiRow });
      expect(getCandidateRows(state)).toEqual([1, 2]);
    });

    it('getPiecesOnRow filters to the rank, preserving file order', () => {
      const state = createTestState({ pieces: multiRow });
      expect(getPiecesOnRow(state, 1).map((p) => p.id)).toEqual(['w-n-b1', 'w-n-g1']);
      expect(getPiecesOnRow(state, 2).map((p) => p.id)).toEqual(['w-p-e2']);
      expect(getPiecesOnRow(state, 5)).toEqual([]);
    });

    it('getSelectedRow derives the rank from the selected piece', () => {
      expect(getSelectedRow(createTestState({ pieces: multiRow }))).toBeNull();
      expect(getSelectedRow(createTestState({ pieces: multiRow, selectedPieceId: 'w-p-e2' }))).toBe(2);
    });
  });

  describe('getCapturedDisplay', () => {
    it('returns empty strings for the starting position (no captures)', () => {
      const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      expect(getCapturedDisplay(createTestState({ fen: startFen }))).toEqual({ top: '', bottom: '' });
    });

    it('returns empty strings when the FEN is not a board placement', () => {
      expect(getCapturedDisplay(createTestState({ fen: 'startpos' }))).toEqual({ top: '', bottom: '' });
    });

    it('lists captured pieces value-desc, lowercase=Black (top), uppercase=White (bottom), counts when >1', () => {
      // White is missing the queen + 1 knight; Black is missing 1 rook + 3 pawns.
      const fen = '1nbqkbnr/ppppp3/8/8/8/8/PPPPPPPP/R1B1KBNR w KQkq - 0 1';
      const { top, bottom } = getCapturedDisplay(createTestState({ fen }));
      // top = Black's losses (lowercase), value order Q R B N P
      expect(top).toBe('r p3');
      // bottom = White's losses (uppercase)
      expect(bottom).toBe('Q N');
    });
  });

  describe('getCarouselItems', () => {
    it('returns empty for idle', () => {
      const state = createTestState();
      expect(getCarouselItems(state)).toEqual([]);
    });

    it('returns "Row N (count)" labels for rowSelect', () => {
      // d1 = rank 1, f3 = rank 3
      const state = createTestState({ phase: 'rowSelect' });
      expect(getCarouselItems(state)).toEqual(['Row 1 (1)', 'Row 3 (1)']);
    });

    it('returns all piece labels for pieceSelect when nothing selected', () => {
      const state = createTestState({ phase: 'pieceSelect' });
      expect(getCarouselItems(state)).toEqual(['Qd1', 'Nf3']);
    });

    it('returns only the active row\'s piece labels in pieceSelect', () => {
      const rank1: PieceEntry[] = [
        { id: 'w-q-d1', label: 'Qd1', color: 'w', type: 'q', square: 'd1', moves: [{ uci: 'd1d3', san: 'Qd3', from: 'd1', to: 'd3' }] },
        { id: 'w-r-h1', label: 'Rh1', color: 'w', type: 'r', square: 'h1', moves: [{ uci: 'h1g1', san: 'Rg1', from: 'h1', to: 'g1' }] },
        { id: 'w-n-f3', label: 'Nf3', color: 'w', type: 'n', square: 'f3', moves: [{ uci: 'f3e5', san: 'Ne5', from: 'f3', to: 'e5' }] },
      ];
      const state = createTestState({ phase: 'pieceSelect', selectedPieceId: 'w-q-d1', pieces: rank1 });
      expect(getCarouselItems(state)).toEqual(['Qd1', 'Rh1']); // rank 1 only, not Nf3
    });

    it('returns move SANs for destSelect', () => {
      const state = createTestState({
        phase: 'destSelect',
        selectedPieceId: 'w-q-d1',
      });
      expect(getCarouselItems(state)).toEqual(['Queen D3', 'Queen H5']);
    });

    it('returns promotion piece names for promotionSelect', () => {
      const state = createTestState({ phase: 'promotionSelect' });
      expect(getCarouselItems(state)).toEqual(['Queen', 'Rook', 'Bishop', 'Knight']);
    });
  });

  describe('getCarouselSelectedIndex', () => {
    it('returns 0 for idle', () => {
      const state = createTestState();
      expect(getCarouselSelectedIndex(state)).toBe(0);
    });

    it('returns the correct piece index within the active row', () => {
      // Two pieces on rank 1; pieceSelect is row-scoped so index is within that row.
      const rank1: PieceEntry[] = [
        { id: 'w-q-d1', label: 'Qd1', color: 'w', type: 'q', square: 'd1', moves: [{ uci: 'd1d3', san: 'Qd3', from: 'd1', to: 'd3' }] },
        { id: 'w-r-h1', label: 'Rh1', color: 'w', type: 'r', square: 'h1', moves: [{ uci: 'h1g1', san: 'Rg1', from: 'h1', to: 'g1' }] },
      ];
      const state = createTestState({
        phase: 'pieceSelect',
        selectedPieceId: 'w-r-h1',
        pieces: rank1,
      });
      expect(getCarouselSelectedIndex(state)).toBe(1);
    });

    it('returns selectedPromotionIndex for promotionSelect', () => {
      const state = createTestState({
        phase: 'promotionSelect',
        selectedPromotionIndex: 2,
      });
      expect(getCarouselSelectedIndex(state)).toBe(2);
    });
  });

  describe('move expansion (expandMoveName)', () => {
    it('expands piece moves with full piece name', () => {
      const pieces: PieceEntry[] = [
        {
          id: 'w-n-g1',
          label: 'Ng1',
          color: 'w',
          type: 'n',
          square: 'g1',
          moves: [
            { uci: 'g1f3', san: 'Nf3', from: 'g1', to: 'f3' },
          ],
        },
      ];
      const state = createTestState({ phase: 'destSelect', selectedPieceId: 'w-n-g1', pieces });
      expect(getCarouselItems(state)).toEqual(['Knight F3']);
    });

    it('expands captures with "takes"', () => {
      const state = createTestState({
        phase: 'destSelect',
        selectedPieceId: 'w-n-f3',
      });
      const items = getCarouselItems(state);
      expect(items).toContain('Knight takes E5');
    });

    it('expands pawn moves without prefix in carousel', () => {
      const pieces: PieceEntry[] = [
        {
          id: 'w-p-e2',
          label: 'Pe2',
          color: 'w',
          type: 'p',
          square: 'e2',
          moves: [
            { uci: 'e2e4', san: 'e4', from: 'e2', to: 'e4' },
          ],
        },
      ];
      const state = createTestState({ phase: 'destSelect', selectedPieceId: 'w-p-e2', pieces });
      expect(getCarouselItems(state)).toEqual(['E4']);
    });

    it('expands pawn captures with "takes"', () => {
      const pieces: PieceEntry[] = [
        {
          id: 'w-p-e4',
          label: 'Pe4',
          color: 'w',
          type: 'p',
          square: 'e4',
          moves: [
            { uci: 'e4d5', san: 'exd5', from: 'e4', to: 'd5' },
          ],
        },
      ];
      const state = createTestState({ phase: 'destSelect', selectedPieceId: 'w-p-e4', pieces });
      expect(getCarouselItems(state)).toEqual(['takes D5']);
    });

    it('expands castling short', () => {
      const pieces: PieceEntry[] = [
        {
          id: 'w-k-e1',
          label: 'Ke1',
          color: 'w',
          type: 'k',
          square: 'e1',
          moves: [
            { uci: 'e1g1', san: 'O-O', from: 'e1', to: 'g1' },
          ],
        },
      ];
      const state = createTestState({ phase: 'destSelect', selectedPieceId: 'w-k-e1', pieces });
      expect(getCarouselItems(state)).toEqual(['Castle Short']);
    });

    it('expands castling long', () => {
      const pieces: PieceEntry[] = [
        {
          id: 'w-k-e1',
          label: 'Ke1',
          color: 'w',
          type: 'k',
          square: 'e1',
          moves: [
            { uci: 'e1c1', san: 'O-O-O', from: 'e1', to: 'c1' },
          ],
        },
      ];
      const state = createTestState({ phase: 'destSelect', selectedPieceId: 'w-k-e1', pieces });
      expect(getCarouselItems(state)).toEqual(['Castle Long']);
    });

    it('expands promotion moves', () => {
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
      const state = createTestState({ phase: 'destSelect', selectedPieceId: 'w-p-e7', pieces });
      expect(getCarouselItems(state)).toEqual(['E8=Queen']);
    });

    it('expands promotion captures', () => {
      const pieces: PieceEntry[] = [
        {
          id: 'w-p-e7',
          label: 'Pe7',
          color: 'w',
          type: 'p',
          square: 'e7',
          moves: [
            { uci: 'e7d8n', san: 'exd8=N', from: 'e7', to: 'd8', promotion: 'n' },
          ],
        },
      ];
      const state = createTestState({ phase: 'destSelect', selectedPieceId: 'w-p-e7', pieces });
      expect(getCarouselItems(state)).toEqual(['takes D8=Knight']);
    });

    it('strips check symbol from moves', () => {
      const pieces: PieceEntry[] = [
        {
          id: 'w-q-h5',
          label: 'Qh5',
          color: 'w',
          type: 'q',
          square: 'h5',
          moves: [
            { uci: 'h5f7', san: 'Qxf7+', from: 'h5', to: 'f7' },
          ],
        },
      ];
      const state = createTestState({ phase: 'destSelect', selectedPieceId: 'w-q-h5', pieces });
      expect(getCarouselItems(state)).toEqual(['Queen takes F7']);
    });

    it('strips checkmate symbol from moves', () => {
      const pieces: PieceEntry[] = [
        {
          id: 'w-q-h5',
          label: 'Qh5',
          color: 'w',
          type: 'q',
          square: 'h5',
          moves: [
            { uci: 'h5f7', san: 'Qxf7#', from: 'h5', to: 'f7' },
          ],
        },
      ];
      const state = createTestState({ phase: 'destSelect', selectedPieceId: 'w-q-h5', pieces });
      expect(getCarouselItems(state)).toEqual(['Queen takes F7']);
    });

    it('expands rook move with file disambiguation as destination only (e.g. Rad8 → Rook D8)', () => {
      const state = createTestState({ lastMove: 'Rad8' });
      const display = getCombinedDisplayText(state);
      expect(display).toContain('Last: Rook D8');
    });
  });

  // ── Move Log Tests (expandMoveForLog) ───────────────────────────────────────

  describe('getLogDisplayText', () => {
    it('shows "No moves yet" for empty history', () => {
      const state = createTestState({ phase: 'viewLog', history: [] });
      const text = getLogDisplayText(state);
      expect(text).toContain('No moves yet');
    });

    it('shows moves with Pawn prefix in log', () => {
      const state = createTestState({ phase: 'viewLog', history: ['e4'] });
      const text = getLogDisplayText(state);
      expect(text).toContain('Pawn E4');
    });

    it('shows captures with full notation', () => {
      const state = createTestState({ phase: 'viewLog', history: ['e4', 'e5', 'Nf3', 'Nc6', 'Nxe5'] });
      const text = getLogDisplayText(state);
      expect(text).toContain('Knight takes E5');
    });

    it('shows castling in log', () => {
      const state = createTestState({ phase: 'viewLog', history: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'] });
      const text = getLogDisplayText(state);
      expect(text).toContain('Castle Short');
    });

    it('shows pawn captures with Pawn prefix', () => {
      const state = createTestState({ phase: 'viewLog', history: ['e4', 'd5', 'exd5'] });
      const text = getLogDisplayText(state);
      expect(text).toContain('Pawn takes D5');
    });

    it('includes column headers', () => {
      const state = createTestState({ phase: 'viewLog', history: ['e4', 'e5'] });
      const text = getLogDisplayText(state);
      expect(text).toContain('White | Black');
    });

    it('formats move numbers', () => {
      const state = createTestState({ phase: 'viewLog', history: ['e4', 'e5', 'Nf3', 'Nc6'] });
      const text = getLogDisplayText(state);
      expect(text).toContain('1.');
      expect(text).toContain('2.');
    });

    // 12 plies = 6 move pairs, one more than the 5-pair window.
    const twelvePlies = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+'];
    const loggedMoveNumbers = (text: string) =>
      text.split('\n').map((l) => /^(\d+)\. /.exec(l)?.[1]).filter(Boolean).map(Number);

    it('shows a 5-move window that follows logScrollOffset', () => {
      const atStart = getLogDisplayText(createTestState({ phase: 'viewLog', history: twelvePlies, logScrollOffset: 0 }));
      const scrolled = getLogDisplayText(createTestState({ phase: 'viewLog', history: twelvePlies, logScrollOffset: 1 }));
      expect(loggedMoveNumbers(atStart)).toEqual([1, 2, 3, 4, 5]);
      expect(loggedMoveNumbers(scrolled)).toEqual([2, 3, 4, 5, 6]);
      expect(scrolled).toContain('MOVE LOG 2-6/6');
    });

    it('clamps an out-of-range offset to the last window', () => {
      const text = getLogDisplayText(createTestState({ phase: 'viewLog', history: twelvePlies, logScrollOffset: 99 }));
      expect(loggedMoveNumbers(text)).toEqual([2, 3, 4, 5, 6]);
    });

    it('omits the range header when every move fits', () => {
      const text = getLogDisplayText(createTestState({ phase: 'viewLog', history: ['e4', 'e5'] }));
      expect(text).not.toMatch(/MOVE LOG \d/);
    });
  });

  // ── Carousel Display Text Tests ─────────────────────────────────────────────

  describe('getMenuDisplayText', () => {
    it('renders the menu options (top-level menu has no header by design)', () => {
      // The top-level menu intentionally omits a header string; submenus
      // (DIFFICULTY, BOARD MARKERS, etc.) are the ones that include headers.
      const state = createTestState({ phase: 'menu' });
      const text = getMenuDisplayText(state);
      expect(text).toContain('Mode');
      expect(text).not.toContain('MENU');
    });

    it('lists the items in menu order', () => {
      const lines = getMenuDisplayText(createTestState({ phase: 'menu' })).split('\n').map((l) => l.trim().replace(/^> /, ''));
      const order = ['Play As', 'Mode', 'View Log', 'Difficulty', 'Display Options', 'Reset', 'Exit'];
      const found = order.map((label) => lines.findIndex((l) => l.startsWith(label)));
      expect(found.every((i) => i >= 0)).toBe(true);
      expect([...found].sort((a, b) => a - b)).toEqual(found);
    });

    it('highlights selected option with >', () => {
      const state = createTestState({ phase: 'menu', menuSelectedIndex: MENU_INDEX.viewLog });
      const text = getMenuDisplayText(state);
      const lines = text.split('\n');
      const viewLogLine = lines.find(l => l.includes('View Log'));
      expect(viewLogLine).toMatch(/^> /);
    });

    it('shows all menu options', () => {
      const state = createTestState({ phase: 'menu' });
      const text = getMenuDisplayText(state);
      expect(text).toContain('Mode');
      expect(text).toContain('View Log');
      expect(text).toContain('Difficulty');
      expect(text).toContain('Display Options');
      expect(text).toContain('Reset');
      expect(text).toContain('Exit');
      // Board Markers now lives under Display Options, not the top-level menu.
      expect(text).not.toContain('Board Markers');
    });
  });

  // ── Difficulty Display Text Tests ───────────────────────────────────────────

  describe('getDifficultyDisplayText', () => {
    it('shows DIFFICULTY header', () => {
      const state = createTestState({ phase: 'difficultySelect' });
      const text = getDifficultyDisplayText(state);
      expect(text).toContain('DIFFICULTY');
    });

    it('shows Easy, Casual, and Serious options', () => {
      const state = createTestState({ phase: 'difficultySelect' });
      const text = getDifficultyDisplayText(state);
      expect(text).toContain('Easy');
      expect(text).toContain('Casual');
      expect(text).toContain('Serious');
    });

    it('marks current difficulty with *', () => {
      const state = createTestState({ phase: 'difficultySelect', difficulty: 'serious' });
      const text = getDifficultyDisplayText(state);
      expect(text).toContain('Serious *');
    });
  });

  // ── Board Markers Display Text Tests ────────────────────────────────────────

  describe('getDisplayOptionsDisplayText', () => {
    it('shows DISPLAY OPTIONS header and all rows with inline values', () => {
      const state = createTestState({
        phase: 'displayOptionsSelect',
        boardAlignment: 'right',
        boardSize: 'small',
        showBoardMarkers: true,
      });
      const text = getDisplayOptionsDisplayText(state);
      expect(text).toContain('DISPLAY OPTIONS');
      expect(text).toContain('Alignment: Right');
      expect(text).toContain('Size: Small');
      expect(text).toContain('Board Markers: On');
      expect(text).toContain('Position: Bottom');
    });

    it('reflects toggled values inline', () => {
      const state = createTestState({
        phase: 'displayOptionsSelect',
        boardAlignment: 'center',
        boardSize: 'small',
        showBoardMarkers: false,
      });
      const text = getDisplayOptionsDisplayText(state);
      expect(text).toContain('Alignment: Center');
      expect(text).toContain('Board Markers: Off');
    });

    it('shows Position: Top when the player is placed at the top', () => {
      const state = createTestState({ phase: 'displayOptionsSelect', boardPosition: 'top' });
      expect(getDisplayOptionsDisplayText(state)).toContain('Position: Top');
    });

    it('hides the Board Markers row when the board is large', () => {
      const state = createTestState({ phase: 'displayOptionsSelect', boardSize: 'large' });
      const text = getDisplayOptionsDisplayText(state);
      expect(text).toContain('Size: Large');
      expect(text).not.toContain('Board Markers');
    });
  });

  // ── Confirm Display Text Tests ──────────────────────────────────────────────

  describe('getResetConfirmDisplayText', () => {
    it('shows RESET GAME header', () => {
      const state = createTestState({ phase: 'resetConfirm' });
      const text = getResetConfirmDisplayText(state);
      expect(text).toContain('RESET GAME');
    });

    it('shows Confirm Reset and Cancel options', () => {
      const state = createTestState({ phase: 'resetConfirm' });
      const text = getResetConfirmDisplayText(state);
      expect(text).toContain('Confirm Reset');
      expect(text).toContain('Cancel');
    });
  });

  describe('getModeSelectDisplayText', () => {
    it('shows MODE header', () => {
      const state = createTestState({ phase: 'modeSelect' });
      const text = getModeSelectDisplayText(state);
      expect(text).toContain('MODE');
    });

    it('shows all mode options', () => {
      const state = createTestState({ phase: 'modeSelect' });
      const text = getModeSelectDisplayText(state);
      expect(text).toContain('Play vs AI');
      expect(text).toContain('Bullet Blitz');
      expect(text).toContain('Academy');
    });

    it('marks current mode with *', () => {
      const state = createTestState({ phase: 'modeSelect', mode: 'bullet' });
      const text = getModeSelectDisplayText(state);
      expect(text).toContain('Bullet Blitz *');
    });
  });

  // ── Bullet Setup Display Text Tests ─────────────────────────────────────────

  describe('getBulletSetupDisplayText', () => {
    it('shows BULLET BLITZ header', () => {
      const state = createTestState({ phase: 'bulletSetup' });
      const text = getBulletSetupDisplayText(state);
      expect(text).toContain('BULLET BLITZ');
    });

    it('shows time control options', () => {
      const state = createTestState({ phase: 'bulletSetup' });
      const text = getBulletSetupDisplayText(state);
      expect(text).toContain('1+0');
      expect(text).toContain('3+0');
      expect(text).toContain('3+5');
      expect(text).toContain('5+0');
      expect(text).toContain('5+5');
    });

    it('marks the cursor, not the committed time control', () => {
      const text = getBulletSetupDisplayText(createTestState({ phase: 'bulletSetup', selectedTimeControlIndex: 0, menuSelectedIndex: 3 }));
      const marked = text.split('\n').filter((l) => l.startsWith('> '));
      expect(marked).toEqual([`> ${TIME_CONTROLS[3]!.label}`]);
    });
  });

  // ── Academy Select Display Text Tests ───────────────────────────────────────

  describe('getAcademySelectDisplayText', () => {
    it('shows ACADEMY header', () => {
      const state = createTestState({ phase: 'academySelect' });
      const text = getAcademySelectDisplayText(state);
      expect(text).toContain('ACADEMY');
    });

    it('shows all drill options', () => {
      const state = createTestState({ phase: 'academySelect' });
      const text = getAcademySelectDisplayText(state);
      expect(text).toContain('Coordinates');
      expect(text).toContain('Tactics');
      expect(text).toContain('Checkmate');
      expect(text).toContain('Knight Path');
      expect(text).toContain('PGN Study');
    });
  });

  // ── Drill Display Text Tests ────────────────────────────────────────────────

  describe('getCoordinateDrillDisplayText', () => {
    it('shows target square', () => {
      const state = createTestState({
        phase: 'coordinateDrill',
        academyState: {
          drillType: 'coordinate',
          targetSquare: 'e4',
          score: { correct: 3, total: 5 },
          cursorFile: 4,
          cursorRank: 3,
          navAxis: 'file',
          feedback: 'none',
        },
      });
      const text = getCoordinateDrillDisplayText(state);
      // Display shows uppercase E4
      expect(text).toContain('E4');
    });

    it('shows score', () => {
      const state = createTestState({
        phase: 'coordinateDrill',
        academyState: {
          drillType: 'coordinate',
          targetSquare: 'e4',
          score: { correct: 3, total: 5 },
          cursorFile: 4,
          cursorRank: 3,
          navAxis: 'file',
          feedback: 'none',
        },
      });
      const text = getCoordinateDrillDisplayText(state);
      expect(text).toContain('3/5');
    });

    // Target G6 and cursor letters B/E keep the cursor letter out of the header and the "Find:" line,
    // so only the exact Column/Row lines can satisfy these assertions.
    const coordinateDrill = (academy: Partial<NonNullable<GameState['academyState']>>) => createTestState({
      phase: 'coordinateDrill',
      academyState: {
        drillType: 'coordinate', targetSquare: 'g6', score: { correct: 2, total: 3 },
        cursorFile: 1, cursorRank: 3, navAxis: 'file', feedback: 'none', ...academy,
      },
    });
    const drillHeader = ['', 'COORDINATE DRILL', 'Score: 2/3', 'Find: G6', ''];

    it('on the file axis, arrows wrap the cursor column and the row shows its number', () => {
      const text = getCoordinateDrillDisplayText(coordinateDrill({ cursorFile: 1, cursorRank: 3, navAxis: 'file' }));
      expect(text).toBe([...drillHeader, 'Column: ◀ B ▶', '   Row: 4'].join('\n'));
    });

    it('on the rank axis, the chosen column is fixed and the arrows move to the row', () => {
      const text = getCoordinateDrillDisplayText(coordinateDrill({ cursorFile: 4, cursorRank: 2, navAxis: 'rank' }));
      expect(text).toBe([...drillHeader, 'Column: E', '   Row: ▲  ▼'].join('\n'));
    });

    it('a correct answer shows CORRECT and the next-square prompt', () => {
      const text = getCoordinateDrillDisplayText(coordinateDrill({ feedback: 'correct' }));
      expect(text).toBe([...drillHeader, '+ CORRECT!', '', 'Tap: next square'].join('\n'));
    });

    it('a wrong answer names the square that was guessed', () => {
      // File and rank indices differ (e = 4, rank 3 = 2) so a swapped guess would read C5.
      const text = getCoordinateDrillDisplayText(coordinateDrill({ feedback: 'incorrect', cursorFile: 4, cursorRank: 2 }));
      expect(text).toBe([...drillHeader, 'X WRONG (E3)', '', 'Tap: next square'].join('\n'));
    });

    it('shows a loading line until a target square is set', () => {
      expect(getCoordinateDrillDisplayText(coordinateDrill({ targetSquare: undefined }))).toBe('Loading drill...');
    });
  });

  describe('getKnightPathDisplayText', () => {
    it('shows start and target squares', () => {
      const state = createTestState({
        phase: 'knightPathDrill',
        academyState: {
          drillType: 'knightPath',
          score: { correct: 0, total: 0 },
          cursorFile: 0,
          cursorRank: 0,
          navAxis: 'file',
          feedback: 'none',
          knightPath: {
            startSquare: 'a1',
            targetSquare: 'c2',
            currentSquare: 'a1',
            optimalMoves: 1,
            movesTaken: 0,
            path: ['a1'],
          },
        },
      });
      const text = getKnightPathDisplayText(state);
      // Display shows uppercase squares
      expect(text).toContain('A1');
      expect(text).toContain('C2');
    });
  });

  describe('getTacticsDisplayText', () => {
    it('shows puzzle theme', () => {
      const state = createTestState({
        phase: 'tacticsDrill',
        academyState: {
          drillType: 'tactics',
          score: { correct: 0, total: 0 },
          cursorFile: 0,
          cursorRank: 0,
          navAxis: 'file',
          feedback: 'none',
          tacticsPuzzle: {
            fen: 'test-fen',
            solution: ['e2e4'],
            theme: 'fork',
            description: 'Test puzzle',
          },
          tacticsSolutionIndex: 0,
        },
      });
      const text = getTacticsDisplayText(state);
      expect(text).toContain('fork');
    });
  });

  describe('getPgnStudyDisplayText', () => {
    it('shows game name', () => {
      const state = createTestState({
        phase: 'pgnStudy',
        academyState: {
          drillType: 'pgn',
          score: { correct: 0, total: 0 },
          cursorFile: 0,
          cursorRank: 0,
          navAxis: 'file',
          feedback: 'none',
          pgnStudy: {
            gameName: 'Immortal Game',
            moves: ['e4', 'e5'],
            currentMoveIndex: 0,
            fen: 'startpos',
            guessMode: false,
          },
        },
      });
      const text = getPgnStudyDisplayText(state);
      expect(text).toContain('Immortal Game');
    });

    const pgnAt = (currentMoveIndex: number) => createTestState({
      phase: 'pgnStudy',
      academyState: {
        drillType: 'pgn', score: { correct: 0, total: 0 }, cursorFile: 0, cursorRank: 0,
        navAxis: 'file', feedback: 'none',
        pgnStudy: { gameName: 'Test', moves: ['e4', 'e5', 'Nf3', 'Nc6'], currentMoveIndex, fen: 'startpos', guessMode: false },
      },
    });
    const markedLine = (text: string) => text.split('\n').find((l) => l.startsWith('>'));

    it('marks the move just played (the board shows the position after it)', () => {
      expect(markedLine(getPgnStudyDisplayText(pgnAt(1)))).toBe('>1.e4');
      expect(markedLine(getPgnStudyDisplayText(pgnAt(2)))).toBe('>e5');
      expect(markedLine(getPgnStudyDisplayText(pgnAt(3)))).toBe('>2.Nf3');
    });

    it('does not list moves that have not been played yet', () => {
      expect(getPgnStudyDisplayText(pgnAt(1))).not.toContain('e5');
    });
  });

  // ── Combined Display Text Tests ─────────────────────────────────────────────

  describe('getCombinedDisplayText', () => {
    it('returns menu display text for menu phase', () => {
      // Top-level menu has no header; assert a menu option is present instead.
      const state = createTestState({ phase: 'menu' });
      const text = getCombinedDisplayText(state);
      expect(text).toContain('Mode');
      expect(text).toContain('View Log');
    });

    it('returns difficulty display text for difficultySelect', () => {
      const state = createTestState({ phase: 'difficultySelect' });
      const text = getCombinedDisplayText(state);
      expect(text).toContain('DIFFICULTY');
    });

    it('returns display options text for displayOptionsSelect', () => {
      const state = createTestState({ phase: 'displayOptionsSelect' });
      const text = getCombinedDisplayText(state);
      expect(text).toContain('DISPLAY OPTIONS');
    });

    it('returns mode select display text for modeSelect', () => {
      const state = createTestState({ phase: 'modeSelect' });
      const text = getCombinedDisplayText(state);
      expect(text).toContain('MODE');
    });

    it('returns bullet setup display text for bulletSetup', () => {
      const state = createTestState({ phase: 'bulletSetup' });
      const text = getCombinedDisplayText(state);
      expect(text).toContain('BULLET BLITZ');
    });

    it('returns academy select display text for academySelect', () => {
      const state = createTestState({ phase: 'academySelect' });
      const text = getCombinedDisplayText(state);
      expect(text).toContain('ACADEMY');
    });
  });

  describe('drill feedback prompts match what a tap does (load the next question)', () => {
    it('coordinate drill: wrong answer says "next square", not "try again"', () => {
      const text = getCoordinateDrillDisplayText(createTestState({
        phase: 'coordinateDrill',
        academyState: { drillType: 'coordinate', score: { correct: 0, total: 1 }, cursorFile: 4, cursorRank: 4, navAxis: 'rank', feedback: 'incorrect', targetSquare: 'e4' },
      }));
      expect(text).toContain('Tap: next square');
      expect(text).not.toContain('try again');
    });

    it('knight path: too many moves says "next puzzle", not "try again"', () => {
      const text = getKnightPathDisplayText(createTestState({
        phase: 'knightPathDrill',
        academyState: {
          drillType: 'knightPath', score: { correct: 0, total: 1 }, cursorFile: 0, cursorRank: 0, navAxis: 'file', feedback: 'incorrect',
          knightPath: { startSquare: 'a1', targetSquare: 'c5', currentSquare: 'b3', optimalMoves: 2, movesTaken: 4, path: ['a1'] },
        },
      }));
      expect(text).toContain('Tap: next puzzle');
      expect(text).not.toContain('try again');
    });
  });

  describe('voice status on the idle screen', () => {
    it('shows a timed status until it is cleared, without reading the clock', () => {
      const text = getCombinedDisplayText(createTestState({
        phase: 'idle', voice: { listening: false, status: "Didn't catch that", statusExpiresAt: 1, pendingConfirm: null },
      }));
      // statusExpiresAt is long past; the selector still shows it because clearing is the
      // reducer's job (VOICE_STATUS_EXPIRE), not a render-time clock check.
      expect(text).toContain("Didn't catch that");
    });
  });

  describe('Custom difficulty picker', () => {
    it('marks where Easy, Casual, and Serious sit, from the real engine settings', () => {
      const text = getCombinedDisplayText(createTestState({ phase: 'customDifficultySelect', menuSelectedIndex: 5 }));
      const bandOf = (level: number) => {
        const lo = level - (level % 2);
        return text.split('\n').find((l) => l.startsWith(`  ${lo}–${lo + 1}:`)) ?? '';
      };
      expect(bandOf(nearestCustomLevel(EASY))).toMatch(/\(.*Easy.*\)/);
      expect(bandOf(nearestCustomLevel(CASUAL))).toMatch(/\(.*Casual.*\)/);
      expect(bandOf(nearestCustomLevel(SERIOUS))).toMatch(/\(.*Serious.*\)/);
    });

    it('fits in nine lines, so the last band stays on screen', () => {
      const text = getCombinedDisplayText(createTestState({ phase: 'customDifficultySelect', menuSelectedIndex: 5 }));
      expect(text.split('\n')).toHaveLength(9);
      expect(text.split('\n').at(-1)).toMatch(/^ {2}8–9: Expert/);
    });

    it('shows the level being picked, not the committed one', () => {
      const text = getCombinedDisplayText(createTestState({ phase: 'customDifficultySelect', customSkillLevel: 2, menuSelectedIndex: 6 }));
      expect(text).toContain('Level: ◀ 6 ▶');
    });

    it('does not reuse the tier names as band labels', () => {
      const text = getCombinedDisplayText(createTestState({ phase: 'customDifficultySelect', menuSelectedIndex: 5 }));
      expect(text).not.toMatch(/\d–\d: (Easy|Casual|Serious)/);
    });
  });

  describe('tactics reveal shows the whole solution line', () => {
    const revealed = (fen: string, solution: string[]) => getTacticsDisplayText(createTestState({
      phase: 'tacticsDrill',
      academyState: {
        drillType: 'tactics', score: { correct: 0, total: 1 }, cursorFile: 0, cursorRank: 0, navAxis: 'file', feedback: 'correct',
        tacticsPuzzle: { fen, solution, theme: 'fork', description: 'test' },
      },
    }));

    it('names the piece, both squares, and check', () => {
      expect(revealed('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', ['b5c7'])).toContain('Knight B5 → C7 check');
    });

    it('lists every move of a multi-move line', () => {
      // 1.Nc7+ Kd7 2.Nxa8
      const text = revealed('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', ['b5c7', 'e8d7', 'c7a8']);
      expect(text).toContain('Knight B5 → C7 check');
      expect(text).toContain('King E8 → D7');
      expect(text).toContain('Knight C7 takes A8');
    });
  });

  // ── Gameplay screen (the text that ships during play) ───────────────────────

  describe('getCombinedDisplayText on the gameplay screen', () => {
    const SEP = '────────';
    // Header for createTestState's defaults: White to move, no history, no clock.
    const header = ['', 'White - Move 1', SEP];
    const lines = (...rest: string[]) => [...header, ...rest].join('\n');
    const idlePrompt = ['', 'Tap to speak', 'Scroll to begin ▲▼'];
    const voice = (v: Partial<NonNullable<GameState['voice']>>): GameState['voice'] =>
      ({ listening: false, status: null, statusExpiresAt: null, pendingConfirm: null, ...v });

    it('idle with no voice activity invites a voice tap or a scroll', () => {
      expect(getCombinedDisplayText(createTestState())).toBe(lines(...idlePrompt));
    });

    it('shows the turn, full move number and expanded last move above the separator', () => {
      const text = getCombinedDisplayText(createTestState({ turn: 'b', history: ['e4', 'e5', 'Nf3'], lastMove: 'Nf3' }));
      expect(text).toBe(['', 'Black - Move 2', 'Last: Knight F3', SEP, ...idlePrompt].join('\n'));
    });

    // A pawn capture: the confirm prompt uses the log wording ("Pawn takes"), not the carousel's ("takes").
    const confirmMove = { uci: 'e4d5', san: 'exd5', from: 'e4', to: 'd5' };
    const idleCases: { name: string; voice: GameState['voice']; boardReady?: boolean; expected: string[] }[] = [
      {
        name: 'board not ready yet: no board-dependent instructions',
        voice: undefined, boardReady: false,
        expected: ['', 'Preparing board…'],
      },
      {
        name: 'a heard move awaiting confirmation (wins over listening)',
        voice: voice({ listening: true, status: 'Listening…', pendingConfirm: confirmMove }),
        expected: ['', 'Heard: Pawn takes D5', 'Tap to confirm · Double-tap aborts'],
      },
      {
        name: 'listening with no status uses the default listening prompt',
        voice: voice({ listening: true }),
        expected: ['', 'Listening… speak your move', 'Tap to cancel  (e.g. Knight to C3)'],
      },
      {
        name: 'listening with a status shows that status',
        voice: voice({ listening: true, status: 'Hearing: knight' }),
        expected: ['', 'Hearing: knight', 'Tap to cancel  (e.g. Knight to C3)'],
      },
      {
        name: 'a status while idle sits above the normal prompt',
        voice: voice({ status: "Didn't catch that", statusExpiresAt: 5_000 }),
        expected: ['', "Didn't catch that", 'Tap to speak', 'Scroll to begin ▲▼'],
      },
      {
        name: 'a status before the board is ready sits above "Preparing board…"',
        voice: voice({ status: "Didn't catch that" }), boardReady: false,
        expected: ['', "Didn't catch that", 'Preparing board…'],
      },
      {
        name: 'a cleared status falls back to the normal prompt',
        voice: voice({ status: null }),
        expected: idlePrompt,
      },
    ];

    it.each(idleCases)('idle: $name', ({ voice: v, boardReady, expected }) => {
      const text = getCombinedDisplayText(createTestState({ voice: v }), { boardReady });
      expect(text).toBe(lines(...expected));
    });

    it('keeps showing a timed status after its expiry time (clearing is the reducer\'s job)', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(10_000);
        const state = createTestState({ voice: voice({ status: "Didn't catch that", statusExpiresAt: 5_000 }) });
        expect(getCombinedDisplayText(state)).toBe(lines('', "Didn't catch that", 'Tap to speak', 'Scroll to begin ▲▼'));
      } finally {
        vi.useRealTimers();
      }
    });

    // createTestState pieces: Qd1 (rank 1, moves Qd3/Qh5) and Nf3 (rank 3, move Nxe5).
    const selectionCases: { name: string; overrides: Partial<GameState>; expected: string[] }[] = [
      { name: 'rowSelect, first row by default', overrides: { phase: 'rowSelect' }, expected: ['Select row:', 'Row 1 (1) (1/2) ▲▼'] },
      { name: 'rowSelect, row of the selected piece', overrides: { phase: 'rowSelect', selectedPieceId: 'w-n-f3' }, expected: ['Select row:', 'Row 3 (1) (2/2) ▲▼'] },
      { name: 'pieceSelect with a chosen row', overrides: { phase: 'pieceSelect', selectedPieceId: 'w-n-f3' }, expected: ['Select piece (Row 3):', 'Nf3 (1/1) ▲▼'] },
      { name: 'pieceSelect with no piece selected', overrides: { phase: 'pieceSelect' }, expected: ['Select piece:', 'Qd1 (1/2) ▲▼'] },
      { name: 'destSelect', overrides: { phase: 'destSelect', selectedPieceId: 'w-q-d1', selectedMoveIndex: 1 }, expected: ['Moving: Qd1', 'Queen H5 (2/2) ▲▼'] },
      { name: 'promotionSelect', overrides: { phase: 'promotionSelect', selectedPromotionIndex: 2 }, expected: ['Select promotion:', 'Bishop (3/4) ▲▼'] },
      { name: 'rowSelect with no movable pieces shows no selection line', overrides: { phase: 'rowSelect', pieces: [] }, expected: [] },
    ];

    it.each(selectionCases)('$name', ({ overrides, expected }) => {
      expect(getCombinedDisplayText(createTestState(overrides))).toBe(lines('', ...expected));
    });

    it('game over replaces the turn line and prompts for a new game', () => {
      const text = getCombinedDisplayText(createTestState({ gameOver: 'checkmate', lastMove: 'Qxf7#', history: ['e4'] }));
      expect(text).toBe(['', 'Game Over: Checkmate', SEP, '', 'Double-tap: new game'].join('\n'));
    });

    it('engine thinking shows the turn and last move, then the thinking line', () => {
      const text = getCombinedDisplayText(createTestState({ turn: 'b', engineThinking: true, history: ['e4'], lastMove: 'e4' }));
      expect(text).toBe(['', 'Black - Move 1', 'Last: E4', SEP, '', 'Engine thinking...'].join('\n'));
    });

    it('bullet mode puts both clocks on the first line, marking a clock under 10s with !…!', () => {
      const timers = { whiteMs: 10_000, blackMs: 9_999, incrementMs: 0 };
      const text = getCombinedDisplayText(createTestState({ mode: 'bullet', timers }));
      expect(text.split('\n')[0]).toBe('W 0:10  |  B !0:10!');
    });

    it('bullet clocks show minutes and seconds', () => {
      const timers = { whiteMs: 65_000, blackMs: 180_000, incrementMs: 0 };
      const text = getCombinedDisplayText(createTestState({ mode: 'bullet', timers }));
      expect(text.split('\n')[0]).toBe('W 1:05  |  B 3:00');
    });

    it('leaves the clock line blank outside bullet mode even if timers exist', () => {
      const timers = { whiteMs: 65_000, blackMs: 180_000, incrementMs: 0 };
      expect(getCombinedDisplayText(createTestState({ mode: 'play', timers }))).toBe(lines(...idlePrompt));
    });
  });

  describe('getCombinedDisplayText routes each overlay phase to its screen', () => {
    const academyState: GameState['academyState'] = {
      drillType: 'coordinate', targetSquare: 'g6', score: { correct: 0, total: 0 },
      cursorFile: 0, cursorRank: 0, navAxis: 'file', feedback: 'none',
    };
    const routes: { phase: GameState['phase']; render: (s: GameState) => string }[] = [
      { phase: 'viewLog', render: getLogDisplayText },
      { phase: 'resetConfirm', render: getResetConfirmDisplayText },
      { phase: 'coordinateDrill', render: getCoordinateDrillDisplayText },
      { phase: 'knightPathDrill', render: getKnightPathDisplayText },
      { phase: 'tacticsDrill', render: getTacticsDisplayText },
      { phase: 'mateDrill', render: getTacticsDisplayText },
      { phase: 'pgnStudy', render: getPgnStudyDisplayText },
    ];

    it.each(routes)('$phase', ({ phase, render }) => {
      const state = createTestState({ phase, academyState, history: ['e4'] });
      expect(getCombinedDisplayText(state)).toBe(render(state));
    });

    it('playAsSelect lists the colors, marking the current one and the cursor', () => {
      const text = getCombinedDisplayText(createTestState({ phase: 'playAsSelect', playAs: 'black', menuSelectedIndex: 2 }));
      expect(text).toBe(['', 'PLAY AS', '', '  White', '  Black *', '> Random'].join('\n'));
    });

    it('customDifficultySelect shows the level between arrows and the tier guide', () => {
      // Tier placement here assumes the shipped profiles (Easy≈1, Casual≈2, Serious≈7); the test
      // above checks it against whatever the profiles compute.
      const text = getCombinedDisplayText(createTestState({ phase: 'customDifficultySelect', menuSelectedIndex: 7 }));
      expect(text).toBe([
        '',
        'CUSTOM DIFFICULTY',
        '  Level: ◀ 7 ▶   (0–9)',
        '  Tap to confirm',
        '  0–1: Beginner (Easy)',
        '  2–3: Novice (Casual)',
        '  4–5: Club player',
        '  6–7: Strong (Serious)',
        '  8–9: Expert',
      ].join('\n'));
    });
  });

  describe('drill screens by feedback state', () => {
    const knightPath = (feedback: 'none' | 'correct' | 'incorrect', movesTaken: number) => createTestState({
      phase: 'knightPathDrill',
      academyState: {
        drillType: 'knightPath', score: { correct: 1, total: 2 }, cursorFile: 1, cursorRank: 2, navAxis: 'file', feedback,
        knightPath: { startSquare: 'a1', targetSquare: 'c5', currentSquare: 'a1', optimalMoves: 2, movesTaken, path: ['a1'] },
      },
    });

    it('knight path, in progress: route, move count and the cursor square', () => {
      expect(getKnightPathDisplayText(knightPath('none', 0))).toBe(
        ['', 'KNIGHT PATH', 'Score: 1/2', 'A1 → C5', 'Moves: 0/2', '', 'Move to: B3 ▲▼'].join('\n'),
      );
    });

    it('knight path, optimal: OPTIMAL and the move count', () => {
      expect(getKnightPathDisplayText(knightPath('correct', 2))).toBe(
        ['', 'KNIGHT PATH', 'Score: 1/2', '', '+ OPTIMAL!', 'Moves: 2/2', '', 'Tap: next puzzle'].join('\n'),
      );
    });

    it('knight path, too many moves: the miss and the move count', () => {
      expect(getKnightPathDisplayText(knightPath('incorrect', 4))).toBe(
        ['', 'KNIGHT PATH', 'Score: 1/2', '', 'X TOO MANY MOVES', 'Moves: 4/2', '', 'Tap: next puzzle'].join('\n'),
      );
    });

    const tactics = (drillType: 'tactics' | 'mate', feedback: 'none' | 'correct' | 'incorrect') => createTestState({
      phase: drillType === 'mate' ? 'mateDrill' : 'tacticsDrill',
      academyState: {
        drillType, score: { correct: 0, total: 0 }, cursorFile: 0, cursorRank: 0, navAxis: 'file', feedback,
        tacticsPuzzle: { fen: 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', solution: ['b5c7'], theme: 'fork', description: 'Fork king and rook' },
      },
    });

    it('tactics, unanswered: asks for the best move and shows the theme', () => {
      expect(getTacticsDisplayText(tactics('tactics', 'none'))).toBe(
        ['', 'TACTICS', '', 'Find the best move!', 'Theme: fork', 'Tap: show answer'].join('\n'),
      );
    });

    it('mate drill, unanswered: titled CHECKMATE and asks for mate in 1', () => {
      expect(getTacticsDisplayText(tactics('mate', 'none'))).toBe(
        ['', 'CHECKMATE', '', 'Find mate in 1!', 'Theme: fork', 'Tap: show answer'].join('\n'),
      );
    });

    it('tactics, revealed: the solution, the description, then the next-puzzle prompt', () => {
      expect(getTacticsDisplayText(tactics('tactics', 'correct'))).toBe(
        ['', 'TACTICS', '', 'Solution:', 'Knight B5 → C7 check', '', 'Fork king and rook', '', 'Tap: next puzzle'].join('\n'),
      );
    });

    it('tactics with no puzzle loaded shows a loading line', () => {
      const state = createTestState({
        phase: 'tacticsDrill',
        academyState: { drillType: 'tactics', score: { correct: 0, total: 0 }, cursorFile: 0, cursorRank: 0, navAxis: 'file', feedback: 'none' },
      });
      expect(getTacticsDisplayText(state)).toBe(['', 'TACTICS', '', 'Loading...'].join('\n'));
    });
  });

  describe('PGN study screens across the game', () => {
    const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'];
    const pgnAt = (currentMoveIndex: number) => getPgnStudyDisplayText(createTestState({
      phase: 'pgnStudy',
      academyState: {
        drillType: 'pgn', score: { correct: 0, total: 0 }, cursorFile: 0, cursorRank: 0, navAxis: 'file', feedback: 'none',
        pgnStudy: { gameName: 'Italian', moves, currentMoveIndex, fen: 'startpos', guessMode: false },
      },
    }));

    it('at index 0 shows the start position', () => {
      expect(pgnAt(0)).toBe(['PGN STUDY', 'Italian', 'Start position', '', '▲▼ Scroll: step'].join('\n'));
    });

    it('mid-game shows the last four moves played, marking the newest', () => {
      // 5 moves played: e4 e5 Nf3 Nc6 Bc4. The window drops e4 and ends at Bc4.
      expect(pgnAt(5)).toBe(['PGN STUDY', 'Italian', ' e5', ' 2.Nf3', ' Nc6', '>3.Bc4', '', '▲▼ Step  Tap: skip'].join('\n'));
    });

    it('after the last move shows the game is complete', () => {
      expect(pgnAt(moves.length)).toBe(['PGN STUDY', 'Italian', 'Game complete!', '', 'Tap: next game'].join('\n'));
    });
  });

  describe('log and difficulty details', () => {
    it('shows "-" for Black when White made the last move', () => {
      const text = getLogDisplayText(createTestState({ phase: 'viewLog', history: ['e4', 'e5', 'Nf3'] }));
      expect(text).toBe(['', 'MOVE LOG', '', 'White | Black', '1. Pawn E4 | Pawn E5', '2. Knight F3 | -'].join('\n'));
    });

    it('shows the chosen Custom level on the Custom row only when Custom is active', () => {
      const active = getDifficultyDisplayText(createTestState({ phase: 'difficultySelect', difficulty: 'custom', customSkillLevel: 7, menuSelectedIndex: 3 }));
      expect(active).toBe(['', 'DIFFICULTY', '', '  Easy', '  Casual', '  Serious', '> Custom (7) *'].join('\n'));
      const inactive = getDifficultyDisplayText(createTestState({ phase: 'difficultySelect', difficulty: 'easy', customSkillLevel: 7, menuSelectedIndex: 0 }));
      expect(inactive).toBe(['', 'DIFFICULTY', '', '> Easy *', '  Casual', '  Serious', '  Custom'].join('\n'));
    });
  });

  describe('getBoardViewColor', () => {
    it('draws the human at the bottom by default', () => {
      expect(getBoardViewColor({ playerColor: 'w', boardPosition: 'bottom' })).toBe('w');
      expect(getBoardViewColor({ playerColor: 'b', boardPosition: 'bottom' })).toBe('b');
    });

    it('puts the opponent at the bottom when Position is Top', () => {
      expect(getBoardViewColor({ playerColor: 'w', boardPosition: 'top' })).toBe('b');
      expect(getBoardViewColor({ playerColor: 'b', boardPosition: 'top' })).toBe('w');
    });
  });
});

describe('nearestCustomLevel', () => {
  it('picks the Custom level whose skill and depth best match each named tier', () => {
    for (const tier of [EASY, CASUAL, SERIOUS]) {
      const level = nearestCustomLevel(tier);
      const gap = (l: number) => {
        const c = buildCustomEngineProfile(l);
        return Math.abs(c.skillLevel - tier.skillLevel) + Math.abs(c.depth - tier.depth);
      };
      for (let l = 0; l <= 9; l++) expect(gap(level)).toBeLessThanOrEqual(gap(l));
    }
  });

  it('places the tiers in order of strength', () => {
    expect(nearestCustomLevel(EASY)).toBeLessThan(nearestCustomLevel(CASUAL));
    expect(nearestCustomLevel(CASUAL)).toBeLessThan(nearestCustomLevel(SERIOUS));
  });
});
