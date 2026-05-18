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

  it('parses castling both sides', () => {
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

  it('tolerates homophones and filler words', () => {
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
});
