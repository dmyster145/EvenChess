/**
 * Stockfish Web Worker — placeholder.
 *
 * To enable the real Stockfish engine:
 *   1. Download stockfish.js + stockfish.wasm from
 *      https://github.com/nicreye/stockfish.wasm or
 *      https://github.com/nicl-e/stockfish-nnue.wasm
 *   2. Replace this file with the Stockfish worker entry point.
 *
 * This placeholder immediately sends 'uciok' so the bridge init
 * succeeds, then responds to 'go' commands with a random bestmove.
 *
 * When using the real Stockfish WASM, delete this file and point the
 * Worker URL in stockfishbridge.ts to the real entry point.
 */

self.addEventListener('message', function (event) {
  var msg = String(event.data || '');

  if (msg === 'uci') {
    self.postMessage('id name Stockfish Placeholder');
    self.postMessage('id author EvenChess');
    self.postMessage('uciok');
    return;
  }

  if (msg === 'isready') {
    self.postMessage('readyok');
    return;
  }

  if (msg.startsWith('go')) {
    // Placeholder: respond with a fixed bestmove after a short delay
    // The real Stockfish would compute here.
    setTimeout(function () {
      self.postMessage('bestmove 0000');
    }, 200);
    return;
  }
});
