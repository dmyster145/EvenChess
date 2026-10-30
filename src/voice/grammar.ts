/**
 * Voice grammar + token normalization for chess move dictation.
 *
 * Two consumers:
 *  - the Vosk recognizer (VOICE_GRAMMAR): the constrained word list that bounds the
 *    decoder so a small offline model only has to choose among chess words.
 *  - the parser (the *_WORDS maps): word → canonical maps. With the grammar applied the
 *    decoder can only emit VOICE_GRAMMAR words, so the extra homophone entries ("night",
 *    "see", "for", ...) only matter for unconstrained text: the injectTranscript debug hook,
 *    tests, or a future recognizer without a grammar. They are kept so the parser stays
 *    tolerant of free text.
 *
 * Files accept BOTH plain letters ("c") and NATO phonetic ("charlie") per the agreed
 * UX. Ranks accept digit-words ("three"). Pieces accept common ASR slips ("night").
 */

export type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p';

/** Canonical words handed to the Vosk decoder as its grammar (plus `[unk]`). */
export const VOICE_GRAMMAR: string[] = [
  // pieces
  'king', 'queen', 'rook', 'bishop', 'knight', 'pawn',
  // NATO files
  'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
  // plain letters (the model emits these spelled out)
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
  // ranks
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  // connectors / actions
  'to', 'takes', 'take', 'capture', 'captures', 'from', 'on',
  // "king side" / "queen side": 'kingside'/'queenside' are not words in the bundled model's
  // vocabulary, so they could never be decoded; 'king'/'queen' are already listed above.
  'castle', 'castles', 'side', 'short', 'long',
  'promote', 'promotes', 'promotion', 'equals',
  'check', 'mate',
  // allow the decoder to emit unknowns instead of force-fitting noise to a word
  '[unk]',
];

/** file token → file letter (a–h). Includes NATO + frequent small-model slips. */
export const FILE_WORDS: Record<string, string> = {
  a: 'a', alpha: 'a', alfa: 'a', ay: 'a', eh: 'a', hey: 'a',
  b: 'b', bravo: 'b', be: 'b', bee: 'b', bie: 'b',
  c: 'c', charlie: 'c', see: 'c', sea: 'c', si: 'c',
  d: 'd', delta: 'd', dee: 'd', the: 'd',
  e: 'e', echo: 'e', ee: 'e',
  f: 'f', foxtrot: 'f', ef: 'f', eff: 'f',
  g: 'g', golf: 'g', gee: 'g', je: 'g',
  h: 'h', hotel: 'h', aitch: 'h', ache: 'h',
};

/** rank token → rank number (1–8). Includes digit-words + frequent slips. */
export const RANK_WORDS: Record<string, number> = {
  one: 1, won: 1, wun: 1,
  two: 2, too: 2,
  three: 3, tree: 3, free: 3,
  four: 4, for: 4, fore: 4,
  five: 5, fife: 5,
  six: 6, sex: 6, sics: 6,
  seven: 7,
  eight: 8, ate: 8, ait: 8,
};

/** piece token → piece type. */
export const PIECE_WORDS: Record<string, PieceType> = {
  king: 'k', kings: 'k',
  queen: 'q', queens: 'q',
  rook: 'r', rooks: 'r', rock: 'r', rooke: 'r',
  bishop: 'b', bishops: 'b',
  knight: 'n', knights: 'n', night: 'n', nite: 'n',
  pawn: 'p', pawns: 'p', paun: 'p', porn: 'p',
};

/** words that mean "this is a capture". */
export const CAPTURE_WORDS = new Set(['takes', 'take', 'capture', 'captures', 'x']);

/** words that introduce a promotion piece. */
export const PROMOTE_WORDS = new Set(['promote', 'promotes', 'promotion', 'equals', 'equal']);

/** filler tokens dropped before parsing. */
export const FILLER_WORDS = new Set(['move', 'moves', 'please', 'um', 'uh', 'and', 'go', 'goes', 'my']);

export function fileToIndex(letter: string): number {
  return 'abcdefgh'.indexOf(letter);
}
