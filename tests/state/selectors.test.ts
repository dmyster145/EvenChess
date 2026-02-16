import { describe, it, expect } from 'vitest';
import {
  getSelectedPiece,
  getSelectedMove,
  getCarouselItems,
  getCarouselSelectedIndex,
  getStatusText,
  getBoardPreviewData,
  getCarouselDisplayText,
  getMenuDisplayText,
  getDifficultyDisplayText,
  getBoardMarkersDisplayText,
  getLogDisplayText,
  getResetConfirmDisplayText,
  getExitConfirmDisplayText,
  getModeSelectDisplayText,
  getBulletSetupDisplayText,
  getAcademySelectDisplayText,
  getCoordinateDrillDisplayText,
  getKnightPathDisplayText,
  getTacticsDisplayText,
  getPgnStudyDisplayText,
  getCombinedDisplayText,
} from '../../src/state/selectors';
import type { GameState, PieceEntry } from '../../src/state/contracts';

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

  describe('getCarouselItems', () => {
    it('returns empty for idle', () => {
      const state = createTestState();
      expect(getCarouselItems(state)).toEqual([]);
    });

    it('returns piece labels for pieceSelect', () => {
      const state = createTestState({ phase: 'pieceSelect' });
      expect(getCarouselItems(state)).toEqual(['Qd1', 'Nf3']);
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

    it('returns the correct piece index', () => {
      const state = createTestState({
        phase: 'pieceSelect',
        selectedPieceId: 'w-n-f3',
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

  describe('getStatusText', () => {
    it('shows game-over reason', () => {
      const state = createTestState({ gameOver: 'checkmate' });
      expect(getStatusText(state)).toContain('Checkmate');
    });

    it('shows engine thinking', () => {
      const state = createTestState({ engineThinking: true });
      expect(getStatusText(state)).toContain('thinking');
    });

    it('shows turn and phase hint', () => {
      const state = createTestState();
      const text = getStatusText(state);
      expect(text).toContain('White to move');
      expect(text).toContain('Scroll');
    });
  });

  describe('getBoardPreviewData', () => {
    it('returns nulls when nothing selected', () => {
      const state = createTestState();
      const data = getBoardPreviewData(state);
      expect(data.originSquare).toBeNull();
      expect(data.destSquare).toBeNull();
    });

    it('returns origin and dest when selected', () => {
      const state = createTestState({
        selectedPieceId: 'w-q-d1',
        selectedMoveIndex: 1,
      });
      const data = getBoardPreviewData(state);
      expect(data.originSquare).toBe('d1');
      expect(data.destSquare).toBe('h5');
    });
  });

  // ── Move Expansion Tests (via getCarouselItems) ─────────────────────────────

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
  });

  // ── Carousel Display Text Tests ─────────────────────────────────────────────

  describe('getCarouselDisplayText', () => {
    it('shows "Scroll to begin" in idle', () => {
      const state = createTestState({ phase: 'idle' });
      expect(getCarouselDisplayText(state)).toBe('Scroll to begin');
    });

    it('shows empty when engine thinking', () => {
      const state = createTestState({ phase: 'idle', engineThinking: true });
      expect(getCarouselDisplayText(state)).toBe('');
    });

    it('shows double-tap hint when game over', () => {
      const state = createTestState({ phase: 'idle', gameOver: 'checkmate' });
      expect(getCarouselDisplayText(state)).toContain('Double-tap');
    });

    it('shows piece selection with counter in pieceSelect', () => {
      const state = createTestState({ phase: 'pieceSelect', selectedPieceId: 'w-q-d1' });
      const text = getCarouselDisplayText(state);
      expect(text).toContain('Qd1');
      expect(text).toContain('1/2');
    });

    it('shows move selection with piece prefix in destSelect', () => {
      const state = createTestState({
        phase: 'destSelect',
        selectedPieceId: 'w-q-d1',
        selectedMoveIndex: 0,
      });
      const text = getCarouselDisplayText(state);
      expect(text).toContain('Qd1');
      expect(text).toContain('Queen D3');
    });
  });

  // ── Menu Display Text Tests ─────────────────────────────────────────────────

  describe('getMenuDisplayText', () => {
    it('shows MENU header', () => {
      const state = createTestState({ phase: 'menu' });
      const text = getMenuDisplayText(state);
      expect(text).toContain('MENU');
    });

    it('highlights selected option with >', () => {
      const state = createTestState({ phase: 'menu', menuSelectedIndex: 2 });
      const text = getMenuDisplayText(state);
      const lines = text.split('\n');
      const viewLogLine = lines.find(l => l.includes('View Log'));
      expect(viewLogLine).toMatch(/^> /);
    });

    it('shows all menu options', () => {
      const state = createTestState({ phase: 'menu' });
      const text = getMenuDisplayText(state);
      expect(text).toContain('Mode');
      expect(text).toContain('Board Markers');
      expect(text).toContain('View Log');
      expect(text).toContain('Difficulty');
      expect(text).toContain('Reset');
      expect(text).toContain('Exit');
    });
  });

  // ── Difficulty Display Text Tests ───────────────────────────────────────────

  describe('getDifficultyDisplayText', () => {
    it('shows DIFFICULTY header', () => {
      const state = createTestState({ phase: 'difficultySelect' });
      const text = getDifficultyDisplayText(state);
      expect(text).toContain('DIFFICULTY');
    });

    it('shows Casual and Serious options', () => {
      const state = createTestState({ phase: 'difficultySelect' });
      const text = getDifficultyDisplayText(state);
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

  describe('getBoardMarkersDisplayText', () => {
    it('shows BOARD MARKERS header', () => {
      const state = createTestState({ phase: 'boardMarkersSelect' });
      const text = getBoardMarkersDisplayText(state);
      expect(text).toContain('BOARD MARKERS');
    });

    it('shows On and Off options', () => {
      const state = createTestState({ phase: 'boardMarkersSelect' });
      const text = getBoardMarkersDisplayText(state);
      expect(text).toContain('On');
      expect(text).toContain('Off');
    });

    it('marks current setting with *', () => {
      const state = createTestState({ phase: 'boardMarkersSelect', showBoardMarkers: false });
      const text = getBoardMarkersDisplayText(state);
      expect(text).toContain('Off *');
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

  describe('getExitConfirmDisplayText', () => {
    it('shows UNSAVED CHANGES header', () => {
      const state = createTestState({ phase: 'exitConfirm' });
      const text = getExitConfirmDisplayText(state);
      expect(text).toContain('UNSAVED CHANGES');
    });

    it('shows save options', () => {
      const state = createTestState({ phase: 'exitConfirm' });
      const text = getExitConfirmDisplayText(state);
      expect(text).toContain('Save');
    });
  });

  // ── Mode Select Display Text Tests ──────────────────────────────────────────

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
  });

  // ── Combined Display Text Tests ─────────────────────────────────────────────

  describe('getCombinedDisplayText', () => {
    it('returns menu display text for menu phase', () => {
      const state = createTestState({ phase: 'menu' });
      const text = getCombinedDisplayText(state);
      expect(text).toContain('MENU');
    });

    it('returns difficulty display text for difficultySelect', () => {
      const state = createTestState({ phase: 'difficultySelect' });
      const text = getCombinedDisplayText(state);
      expect(text).toContain('DIFFICULTY');
    });

    it('returns board markers display text for boardMarkersSelect', () => {
      const state = createTestState({ phase: 'boardMarkersSelect' });
      const text = getCombinedDisplayText(state);
      expect(text).toContain('BOARD MARKERS');
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
});
