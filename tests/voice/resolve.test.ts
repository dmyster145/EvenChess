import { describe, it, expect } from 'vitest';
import { resolveVoiceMove } from '../../src/voice/resolve';
import type { GameState, PieceEntry } from '../../src/state/contracts';
import { parseVoiceCommand } from '../../src/voice/parse';
import { ChessService } from '../../src/chess/chessservice';

function mkState(pieces: PieceEntry[], playerColor: 'w' | 'b' = 'w'): GameState {
  return { pieces, playerColor, turn: playerColor } as unknown as GameState;
}

const knightB1: PieceEntry = {
  id: 'w-n-b1', label: 'Knight B1', color: 'w', type: 'n', square: 'b1',
  moves: [
    { uci: 'b1c3', san: 'Nc3', from: 'b1', to: 'c3' },
    { uci: 'b1a3', san: 'Na3', from: 'b1', to: 'a3' },
  ],
};
const knightE2: PieceEntry = {
  id: 'w-n-e2', label: 'Knight E2', color: 'w', type: 'n', square: 'e2',
  moves: [
    { uci: 'e2c3', san: 'Nc3', from: 'e2', to: 'c3' },
    { uci: 'e2g3', san: 'Ng3', from: 'e2', to: 'g3' },
  ],
};
const pawnE2: PieceEntry = {
  id: 'w-p-e2', label: 'Pawn E2', color: 'w', type: 'p', square: 'e2',
  moves: [
    { uci: 'e2e4', san: 'e4', from: 'e2', to: 'e4' },
    { uci: 'e2e3', san: 'e3', from: 'e2', to: 'e3' },
  ],
};
const kingE1: PieceEntry = {
  id: 'w-k-e1', label: 'King E1', color: 'w', type: 'k', square: 'e1',
  moves: [
    { uci: 'e1g1', san: 'O-O', from: 'e1', to: 'g1' },
    { uci: 'e1c1', san: 'O-O-O', from: 'e1', to: 'c1' },
    { uci: 'e1f1', san: 'Kf1', from: 'e1', to: 'f1' },
  ],
};
const pawnE7: PieceEntry = {
  id: 'w-p-e7', label: 'Pawn E7', color: 'w', type: 'p', square: 'e7',
  moves: [
    { uci: 'e7e8q', san: 'e8=Q', from: 'e7', to: 'e8', promotion: 'q' },
    { uci: 'e7e8r', san: 'e8=R', from: 'e7', to: 'e8', promotion: 'r' },
    { uci: 'e7e8b', san: 'e8=B', from: 'e7', to: 'e8', promotion: 'b' },
    { uci: 'e7e8n', san: 'e8=N', from: 'e7', to: 'e8', promotion: 'n' },
  ],
};

describe('resolveVoiceMove', () => {
  it('resolves a simple unambiguous move', () => {
    const r = resolveVoiceMove(parseVoiceCommand('knight to c3'), mkState([knightB1, pawnE2]));
    expect(r.kind).toBe('move');
    if (r.kind === 'move') expect(r.move.uci).toBe('b1c3');
  });

  it('resolves a bare pawn move', () => {
    const r = resolveVoiceMove(parseVoiceCommand('e4'), mkState([knightB1, pawnE2]));
    expect(r.kind).toBe('move');
    if (r.kind === 'move') expect(r.move.san).toBe('e4');
  });

  it('reports ambiguity when two knights reach the square', () => {
    const r = resolveVoiceMove(parseVoiceCommand('knight to c3'), mkState([knightB1, knightE2]));
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') {
      expect(r.message).toContain('B1');
      expect(r.message).toContain('E2');
    }
  });

  it('resolves ambiguity with a source-file disambiguator', () => {
    const r = resolveVoiceMove(
      parseVoiceCommand('knight b to c3'),
      mkState([knightB1, knightE2]),
    );
    expect(r.kind).toBe('move');
    if (r.kind === 'move') expect(r.move.from).toBe('b1');
  });

  it('reports an illegal destination', () => {
    const r = resolveVoiceMove(parseVoiceCommand('knight to h6'), mkState([knightB1]));
    expect(r.kind).toBe('illegal');
  });

  it('resolves castling both sides', () => {
    const k = resolveVoiceMove(parseVoiceCommand('castle kingside'), mkState([kingE1]));
    expect(k.kind).toBe('move');
    if (k.kind === 'move') expect(k.move.san).toBe('O-O');
    const q = resolveVoiceMove(parseVoiceCommand('castle queenside'), mkState([kingE1]));
    expect(q.kind).toBe('move');
    if (q.kind === 'move') expect(q.move.san).toBe('O-O-O');
  });

  it('asks for a promotion piece when unspecified', () => {
    const r = resolveVoiceMove(parseVoiceCommand('e8'), mkState([pawnE7]));
    expect(r.kind).toBe('needsPromotion');
  });

  it('resolves an explicit promotion', () => {
    const r = resolveVoiceMove(parseVoiceCommand('e8 knight'), mkState([pawnE7]));
    expect(r.kind).toBe('move');
    if (r.kind === 'move') {
      expect(r.move.promotion).toBe('n');
      expect(r.move.san).toBe('e8=N');
    }
  });

  it('ignores opponent pieces', () => {
    const blackKnight: PieceEntry = { ...knightB1, id: 'b-n-b1', color: 'b' };
    const r = resolveVoiceMove(parseVoiceCommand('knight to c3'), mkState([blackKnight], 'w'));
    expect(r.kind).toBe('illegal');
  });

  it('returns unparsed for empty / invalid input', () => {
    expect(resolveVoiceMove(parseVoiceCommand(''), mkState([knightB1])).kind).toBe('unparsed');
    expect(resolveVoiceMove({ to: 'zz' }, mkState([knightB1])).kind).toBe('unparsed');
  });

  describe('promotion vs a normal move to the same square', () => {
    // A knight on d6 can also go to e8, so both a promotion and a normal move land there.
    const knightD6: PieceEntry = {
      id: 'w-n-d6', label: 'Knight D6', color: 'w', type: 'n', square: 'd6',
      moves: [{ uci: 'd6e8', san: 'Ne8', from: 'd6', to: 'e8' }],
    };

    it('a spoken promotion piece picks the pawn promotion, not the other piece\'s move', () => {
      const r = resolveVoiceMove(parseVoiceCommand('e8 queen'), mkState([pawnE7, knightD6]));
      expect(r.kind).toBe('move');
      if (r.kind === 'move') expect(r.move.uci).toBe('e7e8q');
    });

    it('with no promotion piece spoken, the normal move wins', () => {
      const r = resolveVoiceMove(parseVoiceCommand('e8'), mkState([pawnE7, knightD6]));
      expect(r.kind).toBe('move');
      if (r.kind === 'move') expect(r.move.uci).toBe('d6e8');
    });
  });

  describe('follow-up prompts ask for the whole move (each utterance is parsed alone)', () => {
    it('needsPromotion suggests a full command with the square', () => {
      const r = resolveVoiceMove(parseVoiceCommand('e8'), mkState([pawnE7]));
      expect(r.kind).toBe('needsPromotion');
      if (r.kind === 'needsPromotion') expect(r.message).toContain('"E8 queen"');
    });

    it('ambiguous suggests a full command naming the source square', () => {
      const r = resolveVoiceMove(parseVoiceCommand('knight c3'), mkState([knightB1, knightE2]));
      expect(r.kind).toBe('ambiguous');
      if (r.kind === 'ambiguous') expect(r.message).toMatch(/"knight (B1|E2) to C3"/);
    });

    it('the suggested command resolves to a single move', () => {
      const r = resolveVoiceMove(parseVoiceCommand('knight b1 to c3'), mkState([knightB1, knightE2]));
      expect(r.kind).toBe('move');
      if (r.kind === 'move') expect(r.move.uci).toBe('b1c3');
    });
  });
});

describe('resolveVoiceMove: "takes"', () => {
  // White pawn e5 can take d5 en passant on d6, and the knight on c4 can move quietly to d6.
  const enPassant = (): GameState => {
    const pieces = new ChessService('4k3/8/8/3pP3/2N5/8/8/4K3 w - d6 0 1').getPiecesWithMoves();
    return mkState(pieces);
  };

  it('without "takes", two pieces reaching the square is ambiguous', () => {
    expect(resolveVoiceMove(parseVoiceCommand('d6'), enPassant()).kind).toBe('ambiguous');
  });

  it('"takes" picks the en passant capture over the quiet knight move', () => {
    const r = resolveVoiceMove(parseVoiceCommand('takes d6'), enPassant());
    expect(r).toMatchObject({ kind: 'move', move: { from: 'e5', to: 'd6', san: 'exd6' } });
  });

  it('a misheard "takes" with no capture available still finds the move', () => {
    const r = resolveVoiceMove(parseVoiceCommand('knight takes c3'), mkState([knightB1, pawnE2]));
    expect(r).toMatchObject({ kind: 'move', move: { uci: 'b1c3' } });
  });
});
