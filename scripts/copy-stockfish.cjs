/**
 * Copy Stockfish worker and WASM from node_modules to public/stockfish/
 * so Vite can serve them. Cross-platform (Node fs).
 */
const fs = require('fs');
const path = require('path');

const fromDir = path.join(__dirname, '..', 'node_modules', 'stockfish.js');
const toDir = path.join(__dirname, '..', 'public', 'stockfish');
const files = ['stockfish.wasm.js', 'stockfish.wasm'];

if (!fs.existsSync(fromDir)) {
  console.warn('[copy-stockfish] stockfish.js not installed, skipping copy.');
  process.exit(0);
}

fs.mkdirSync(toDir, { recursive: true });
for (const file of files) {
  const src = path.join(fromDir, file);
  const dest = path.join(toDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log('[copy-stockfish] Copied', file, 'to public/stockfish/');
  } else {
    console.warn('[copy-stockfish] Missing', src);
  }
}
