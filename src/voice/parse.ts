/**
 * Transcript → structured move intent.
 *
 * Tolerant by design: a small offline model produces noisy, filler-laden text, so we
 * scan a typed token stream rather than match rigid templates. Connectors ("to",
 * "from") are ignored — "knight to c3", "knight c3", "knight b1 c3" all parse.
 */

import {
  FILE_WORDS,
  RANK_WORDS,
  PIECE_WORDS,
  CAPTURE_WORDS,
  PROMOTE_WORDS,
  FILLER_WORDS,
  fileToIndex,
  type PieceType,
} from './grammar';

export interface VoiceIntent {
  piece?: PieceType;
  /** disambiguation source file, 0–7 */
  fromFile?: number;
  /** disambiguation source rank, 1–8 */
  fromRank?: number;
  /** destination square, e.g. "c3" */
  to?: string;
  promotion?: PieceType;
  castle?: 'k' | 'q';
  isCapture?: boolean;
}

type Tok =
  | { k: 'piece'; v: PieceType }
  | { k: 'file'; v: string }
  | { k: 'rank'; v: number }
  | { k: 'capture' }
  | { k: 'promote' };

function tokenize(transcript: string): string[] {
  return transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/([1-8])/g, ' $1 ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !FILLER_WORDS.has(w));
}

function detectCastle(words: string[]): 'k' | 'q' | undefined {
  if (!words.some((w) => w === 'castle' || w === 'castles')) return undefined;
  if (words.some((w) => w === 'queenside' || w === 'long')) return 'q';
  if (words.some((w) => w === 'kingside' || w === 'short')) return 'k';
  // "castle queen [side]" / "castle king [side]"
  const ci = words.findIndex((w) => w === 'castle' || w === 'castles');
  const rest = words.slice(ci + 1);
  if (rest.includes('queen')) return 'q';
  if (rest.includes('king')) return 'k';
  return 'k'; // bare "castle" → assume kingside (most common)
}

/** Map a raw word to a typed token, or null if it carries no move meaning. */
function classify(word: string): Tok | null {
  if (PROMOTE_WORDS.has(word)) return { k: 'promote' };
  if (CAPTURE_WORDS.has(word)) return { k: 'capture' };
  if (word in PIECE_WORDS) return { k: 'piece', v: PIECE_WORDS[word]! };
  if (/^[1-8]$/.test(word)) return { k: 'rank', v: Number(word) };
  if (word in RANK_WORDS) return { k: 'rank', v: RANK_WORDS[word]! };
  if (word in FILE_WORDS) return { k: 'file', v: FILE_WORDS[word]! };
  return null;
}

export function parseVoiceCommand(transcript: string): VoiceIntent {
  const words = tokenize(transcript);
  const intent: VoiceIntent = {};

  const castle = detectCastle(words);
  if (castle) {
    intent.castle = castle;
    if (words.some((w) => CAPTURE_WORDS.has(w))) intent.isCapture = true;
    return intent;
  }

  const toks: Tok[] = [];
  for (const w of words) {
    const t = classify(w);
    if (t) toks.push(t);
  }

  if (toks.some((t) => t.k === 'capture')) intent.isCapture = true;

  // Pass 1: collect squares (file immediately followed by a rank) and lone files.
  const squares: Array<{ file: string; rank: number; at: number }> = [];
  const loneFiles: number[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.k === 'file') {
      const next = toks[i + 1];
      if (next && next.k === 'rank') {
        squares.push({ file: t.v, rank: next.v, at: i });
        i++;
      } else {
        loneFiles.push(i);
      }
    }
  }

  const promoteAt = toks.findIndex((t) => t.k === 'promote');
  const leadingPieceIdx = toks.findIndex((t) => t.k === 'piece');
  const lastSquareAt = squares.length ? squares[squares.length - 1]!.at + 1 : -1;

  // Moving piece: a piece token that comes before the first square.
  if (
    leadingPieceIdx >= 0 &&
    (squares.length === 0 || leadingPieceIdx < squares[0]!.at)
  ) {
    intent.piece = (toks[leadingPieceIdx] as { k: 'piece'; v: PieceType }).v;
  }

  // Promotion: a piece token after a "promote" word, OR a trailing piece token after
  // the destination square when no piece is leading (e.g. "e8 queen").
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.k !== 'piece') continue;
    if (i === leadingPieceIdx && intent.piece) continue;
    const afterPromote = promoteAt >= 0 && i > promoteAt;
    const trailing = lastSquareAt >= 0 && i >= lastSquareAt && !intent.piece;
    if (afterPromote || trailing) {
      intent.promotion = t.v;
      break;
    }
  }

  // Destination = last full square. From-square = the one before it (if any).
  if (squares.length >= 1) {
    const dest = squares[squares.length - 1]!;
    intent.to = `${dest.file}${dest.rank}`;
    if (squares.length >= 2) {
      const src = squares[squares.length - 2]!;
      intent.fromFile = fileToIndex(src.file);
      intent.fromRank = src.rank;
    } else if (loneFiles.length > 0) {
      // "e takes d5" / "rook e to e8" → first lone file is the source file.
      const lf = toks[loneFiles[0]!] as { k: 'file'; v: string };
      intent.fromFile = fileToIndex(lf.v);
    }
  }

  return intent;
}
