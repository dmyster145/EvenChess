/**
 * Shared piece silhouette bitmaps for chess piece rendering.
 *
 * Each piece is a 19x19 pixel bitmap where each row is a 19-bit number.
 * Bit ordering: MSB = leftmost pixel, 1 = piece pixel, 0 = transparent.
 */

export const PIECE_SIZE = 19;

/** Piece silhouette bitmaps indexed by piece type (k, q, r, b, n, p). */
export const PIECE_SILHOUETTES: Record<string, number[]> = {
  // King: Crown with cross on top
  k: [
    0b0000000010000000000, // row 0:  cross top
    0b0000000111000000000, // row 1:  cross horizontal
    0b0000000010000000000, // row 2:  cross stem
    0b0000000010000000000, // row 3:  cross stem
    0b0000011111110000000, // row 4:  crown top
    0b0000111111111000000, // row 5:  crown
    0b0001111111111100000, // row 6:  crown
    0b0011111111111110000, // row 7:  crown
    0b0011111111111110000, // row 8:  crown body
    0b0001111111111100000, // row 9:  body
    0b0001111111111100000, // row 10: body
    0b0000111111111000000, // row 11: neck
    0b0000111111111000000, // row 12: neck
    0b0000111111111000000, // row 13: neck
    0b0001111111111100000, // row 14: base flare
    0b0011111111111110000, // row 15: base
    0b0111111111111111000, // row 16: base
    0b0111111111111111000, // row 17: base bottom
    0b0000000000000000000, // row 18: empty
  ],
  // Queen: Tall tapered crown with 5 points (hourglass silhouette)
  q: [
    0b0000100010001000000, // row 0:  point tips
    0b0000100010001000000, // row 1:  points
    0b0001100111001100000, // row 2:  points widen
    0b0001110111011100000, // row 3:  points merge
    0b0000111111111000000, // row 4:  crown top
    0b0000011111110000000, // row 5:  crown taper
    0b0000011111110000000, // row 6:  crown body
    0b0000001111100000000, // row 7:  narrow waist
    0b0000001111100000000, // row 8:  narrow waist
    0b0000000111000000000, // row 9:  thinnest point
    0b0000000111000000000, // row 10: thinnest point
    0b0000001111100000000, // row 11: flare out
    0b0000011111110000000, // row 12: body widens
    0b0000111111111000000, // row 13: base flare
    0b0001111111111100000, // row 14: base
    0b0011111111111110000, // row 15: base
    0b0111111111111111000, // row 16: base wider
    0b0111111111111111000, // row 17: base bottom
    0b0000000000000000000, // row 18: empty
  ],
  // Rook: Castle tower with crenellations
  r: [
    0b0011011111110110000, // row 0:  crenellations
    0b0011011111110110000, // row 1:  crenellations
    0b0011111111111110000, // row 2:  top
    0b0011111111111110000, // row 3:  top
    0b0001111111111100000, // row 4:  neck
    0b0000111111111000000, // row 5:  body
    0b0000111111111000000, // row 6:  body
    0b0000111111111000000, // row 7:  body
    0b0000111111111000000, // row 8:  body
    0b0000111111111000000, // row 9:  body
    0b0000111111111000000, // row 10: body
    0b0000111111111000000, // row 11: body
    0b0001111111111100000, // row 12: body flare
    0b0001111111111100000, // row 13: base flare
    0b0011111111111110000, // row 14: base
    0b0111111111111111000, // row 15: base wider
    0b0111111111111111000, // row 16: base
    0b0111111111111111000, // row 17: base bottom
    0b0000000000000000000, // row 18: empty
  ],
  // Bishop: Miter hat with slit
  b: [
    0b0000000010000000000, // row 0:  tip
    0b0000000111000000000, // row 1:  tip
    0b0000001111100000000, // row 2:  head
    0b0000011111110000000, // row 3:  head
    0b0000011101110000000, // row 4:  slit
    0b0000111101111000000, // row 5:  slit
    0b0000111101111000000, // row 6:  slit
    0b0000111111111000000, // row 7:  head
    0b0000011111110000000, // row 8:  neck
    0b0000011111110000000, // row 9:  neck
    0b0000001111100000000, // row 10: stem
    0b0000001111100000000, // row 11: stem
    0b0000001111100000000, // row 12: stem
    0b0000011111110000000, // row 13: collar
    0b0000111111111000000, // row 14: base flare
    0b0001111111111100000, // row 15: base
    0b0011111111111110000, // row 16: base wider
    0b0011111111111110000, // row 17: base bottom
    0b0000000000000000000, // row 18: empty
  ],
  // Knight: Classic Staunton-style horse head facing left
  n: [
    0b0000011000000000000, // row 0:  ear tip
    0b0000111111100000000, // row 1:  ear
    0b0000111111100000000, // row 2:  head top curve
    0b0001111111111000000, // row 3:  forehead + back of head
    0b0011111111111000000, // row 4:  eye area + mane curve
    0b0111111111111110000, // row 5:  face + mane
    0b0111111111111100000, // row 6:  muzzle + mane
    0b0111111111111110000, // row 7:  nose + neck mane
    0b0000001111111100000, // row 8:  nostril/mouth + mane
    0b0000011111111100000, // row 9:  chin + mane
    0b0000111111111000000, // row 10: jaw line
    0b0000111111111000000, // row 11: throat
    0b0000011111110000000, // row 12: neck narrow
    0b0000011111110000000, // row 13: neck
    0b0000111111111000000, // row 14: collar flare
    0b0001111111111100000, // row 15: base top
    0b0011111111111110000, // row 16: base wider
    0b0011111111111110000, // row 17: base bottom
    0b0000000000000000000, // row 18: empty
  ],
  // Pawn: Simple ball head on base
  p: [
    0b0000000000000000000, // row 0:  empty
    0b0000000000000000000, // row 1:  empty
    0b0000000111000000000, // row 2:  head top
    0b0000001111100000000, // row 3:  head
    0b0000011111110000000, // row 4:  head
    0b0000011111110000000, // row 5:  head
    0b0000011111110000000, // row 6:  head
    0b0000001111100000000, // row 7:  head bottom
    0b0000000111000000000, // row 8:  neck
    0b0000000111000000000, // row 9:  neck
    0b0000001111100000000, // row 10: body
    0b0000001111100000000, // row 11: body
    0b0000011111110000000, // row 12: body
    0b0000011111110000000, // row 13: body
    0b0000111111111000000, // row 14: base flare
    0b0001111111111100000, // row 15: base
    0b0011111111111110000, // row 16: base wider
    0b0011111111111110000, // row 17: base bottom
    0b0000000000000000000, // row 18: empty
  ],
};
