/**
 * Copy the Stockfish worker, WASM and GPL-3.0 license text from node_modules to public/stockfish/
 * so Vite serves (and the build ships) them, plus a SOURCE.txt saying where the matching source
 * is. Runs as the postinstall hook; public/stockfish/ is generated, not committed. Cross-platform.
 */
const fs = require('fs');
const path = require('path');

const fromDir = path.join(__dirname, '..', 'node_modules', 'stockfish.js');
const toDir = path.join(__dirname, '..', 'public', 'stockfish');
const files = ['stockfish.wasm.js', 'stockfish.wasm', 'Copying.txt'];

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

// Upstream has no tag for the npm release, so pin the commit that published it.
const SOURCE_COMMITS = { '10.0.2': 'e105072e84cf8ee5dd5219e2c5be29c3b8bf8a5a' };
const { version } = require(path.join(fromDir, 'package.json'));
const ref = SOURCE_COMMITS[version] ?? 'ddugovic';
fs.writeFileSync(
  path.join(toDir, 'SOURCE.txt'),
  `Stockfish ${version} (WebAssembly build from the stockfish.js npm package), licensed under the\n` +
    'GNU General Public License v3.0; see Copying.txt in this folder.\n' +
    `Corresponding source: https://github.com/niklasf/stockfish.js/tree/${ref}\n`,
);
console.log('[copy-stockfish] Wrote SOURCE.txt');
