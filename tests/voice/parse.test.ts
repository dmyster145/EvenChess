import { describe, it, expect } from 'vitest';
import { parseVoiceCommand } from '../../src/voice/parse';

describe('parseVoiceCommand', () => {
  it('parses "knight to c3" (plain letter)', () => {
    expect(parseVoiceCommand('knight to c3')).toEqual({ piece: 'n', to: 'c3' });
  });

  it('parses NATO phonetic files', () => {
    expect(parseVoiceCommand('knight to charlie three')).toEqual({ piece: 'n', to: 'c3' });
    expect(parseVoiceCommand('bishop takes echo five')).toEqual({
      piece: 'b',
      to: 'e5',
      isCapture: true,
    });
  });

  it('parses a bare pawn move', () => {
    expect(parseVoiceCommand('e4')).toEqual({ to: 'e4' });
    expect(parseVoiceCommand('pawn e four')).toEqual({ piece: 'p', to: 'e4' });
  });

  it('parses a capture with a source file ("e takes d5")', () => {
    expect(parseVoiceCommand('e takes d5')).toEqual({
      to: 'd5',
      fromFile: 4,
      isCapture: true,
    });
  });

  it('ignores a leading article "a" (a file word) before the piece name', () => {
    expect(parseVoiceCommand('a knight to c three')).toEqual({ piece: 'n', to: 'c3' });
    expect(parseVoiceCommand('a rook e to e eight')).toEqual({ piece: 'r', fromFile: 4, to: 'e8' });
  });

  it('keeps a source file spoken before a trailing promotion piece ("e takes d8 queen")', () => {
    expect(parseVoiceCommand('e takes d eight queen')).toEqual({ fromFile: 4, to: 'd8', promotion: 'q', isCapture: true });
  });

  it('parses full disambiguation "knight b1 to c3"', () => {
    expect(parseVoiceCommand('knight b1 to c3')).toEqual({
      piece: 'n',
      fromFile: 1,
      fromRank: 1,
      to: 'c3',
    });
  });

  it('parses partial disambiguation "rook e to e8"', () => {
    expect(parseVoiceCommand('rook e to e8')).toEqual({
      piece: 'r',
      fromFile: 4,
      to: 'e8',
    });
  });

  // The live recognizer is constrained to VOICE_GRAMMAR words. Inputs outside it ("kingside",
  // homophones like "night", fillers like "please") only arrive as free text, e.g. through the
  // injectTranscript debug hook; the parser accepts them so it stays tolerant of any recognizer.
  it('parses castling both sides (free text, including words outside the grammar)', () => {
    expect(parseVoiceCommand('castle kingside')).toEqual({ castle: 'k' });
    expect(parseVoiceCommand('castle queenside')).toEqual({ castle: 'q' });
    expect(parseVoiceCommand('castle long')).toEqual({ castle: 'q' });
    expect(parseVoiceCommand('castle short')).toEqual({ castle: 'k' });
    expect(parseVoiceCommand('castles')).toEqual({ castle: 'k' });
  });

  it('parses promotion (trailing piece and explicit "promote")', () => {
    expect(parseVoiceCommand('e8 queen')).toEqual({ to: 'e8', promotion: 'q' });
    expect(parseVoiceCommand('e7 e8 promote knight')).toEqual({
      fromFile: 4,
      fromRank: 7,
      to: 'e8',
      promotion: 'n',
    });
  });

  it('tolerates homophones and filler words in free text (not emitted by the grammar-bound recognizer)', () => {
    expect(parseVoiceCommand('night to see three')).toEqual({ piece: 'n', to: 'c3' });
    expect(parseVoiceCommand('move knight to c three please')).toEqual({
      piece: 'n',
      to: 'c3',
    });
    expect(parseVoiceCommand('rook to ay one')).toEqual({ piece: 'r', to: 'a1' });
  });

  it('returns an empty intent for unintelligible input', () => {
    expect(parseVoiceCommand('')).toEqual({});
    expect(parseVoiceCommand('hello there')).toEqual({});
  });

  it('keeps a trailing promotion piece after a leading "pawn"', () => {
    expect(parseVoiceCommand('pawn e8 queen')).toMatchObject({ piece: 'p', to: 'e8', promotion: 'q' });
    expect(parseVoiceCommand('pawn to e eight knight')).toMatchObject({ piece: 'p', to: 'e8', promotion: 'n' });
  });

  it('does not treat a trailing piece as a promotion when a non-pawn piece moves', () => {
    expect(parseVoiceCommand('rook e8 queen').promotion).toBeUndefined();
  });

  it('parses castling spelled as the grammar emits it ("king side" / "queen side")', () => {
    expect(parseVoiceCommand('castle king side')).toEqual({ castle: 'k' });
    expect(parseVoiceCommand('castle queen side')).toEqual({ castle: 'q' });
  });

  it('a "side" phrase beats the king named as the piece ("king castles queen side")', () => {
    expect(parseVoiceCommand('king castles queen side')).toEqual({ castle: 'q' });
    expect(parseVoiceCommand('castle king queen side')).toEqual({ castle: 'q' });
    expect(parseVoiceCommand('castle my king queen side')).toEqual({ castle: 'q' });
    expect(parseVoiceCommand('queen castles king side')).toEqual({ castle: 'k' });
  });

  it('parses castling with the side spoken before "castle" ("queen side castle")', () => {
    expect(parseVoiceCommand('queen side castle')).toEqual({ castle: 'q' });
    expect(parseVoiceCommand('king side castle')).toEqual({ castle: 'k' });
    expect(parseVoiceCommand('queen castle')).toEqual({ castle: 'q' });
    expect(parseVoiceCommand('queenside castle')).toEqual({ castle: 'q' });
    expect(parseVoiceCommand('long castle')).toEqual({ castle: 'q' });
    expect(parseVoiceCommand('castle')).toEqual({ castle: 'k' });
  });

  it('ignores an article directly before a captured piece\'s name ("takes a pawn on d5")', () => {
    expect(parseVoiceCommand('knight takes a pawn on d5')).toEqual({ piece: 'n', to: 'd5', isCapture: true });
    expect(parseVoiceCommand('bishop takes the knight on f six')).toEqual({ piece: 'b', to: 'f6', isCapture: true });
    // A real source file is still kept alongside the article.
    expect(parseVoiceCommand('rook e takes a knight on e eight')).toEqual({
      piece: 'r', fromFile: 4, to: 'e8', isCapture: true,
    });
  });

  it('parses transcripts made only of grammar words, as the live recognizer emits them', () => {
    expect(parseVoiceCommand('knight to charlie three')).toEqual({ piece: 'n', to: 'c3' });
    expect(parseVoiceCommand('pawn e eight queen')).toEqual({ piece: 'p', to: 'e8', promotion: 'q' });
    expect(parseVoiceCommand('e seven e eight promote knight')).toEqual({ fromFile: 4, fromRank: 7, to: 'e8', promotion: 'n' });
    expect(parseVoiceCommand('rook a one to a four')).toEqual({ piece: 'r', fromFile: 0, fromRank: 1, to: 'a4' });
    expect(parseVoiceCommand('bishop takes foxtrot seven check')).toEqual({ piece: 'b', to: 'f7', isCapture: true });
    expect(parseVoiceCommand('[unk] knight [unk] to c three')).toEqual({ piece: 'n', to: 'c3' });
  });
});
