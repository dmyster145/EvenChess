/**
 * Fetch + repackage the offline Vosk speech model for push-to-talk voice moves.
 *
 * vosk-browser loads a gzipped tar of a `model/` folder. The official small
 * English model ships as a zip with a versioned top folder, so we download it,
 * rename the top folder to `model/`, and write public/vosk/model.tar.gz.
 *
 * Not a postinstall hook on purpose — it's a ~40 MB download. Run explicitly:
 *   npm run fetch:voice-model
 * The app degrades gracefully (tap falls back to the manual carousel) if the
 * model is absent, so builds/tests don't depend on this.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip';
/** SHA-256 of that zip. The model is bundled into the .ehpk, so a changed download is rejected. */
const MODEL_SHA256 = '30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498';
const OUT_DIR = path.join(__dirname, '..', 'public', 'vosk');
const OUT_FILE = path.join(OUT_DIR, 'model.tar.gz');
/** Abort a stalled download after this long without data. */
const IDLE_TIMEOUT_MS = 60_000;

if (fs.existsSync(OUT_FILE)) {
  console.log('[fetch-vosk-model] public/vosk/model.tar.gz already exists — skipping.');
  process.exit(0);
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        // Location may be relative; resolve it against the URL that redirected.
        const next = new URL(res.headers.location, url);
        if (next.protocol !== 'https:') return reject(new Error(`refusing non-https redirect to ${next}`));
        return resolve(download(next.toString(), dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const file = fs.createWriteStream(dest);
      // pipe() does not forward errors from the response, so handle each stream's failures.
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('download aborted')));
      file.on('error', reject);
      file.on('finish', () => file.close(() => resolve()));
      res.pipe(file);
    });
    req.on('error', reject);
    req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new Error(`no data for ${IDLE_TIMEOUT_MS / 1000}s`)));
  });
}

/** The extracted model folder: the directory holding the model's am/ and conf/ subfolders. */
function findModelDir(root) {
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = path.join(root, d.name);
    if (fs.existsSync(path.join(dir, 'am')) && fs.existsSync(path.join(dir, 'conf'))) return dir;
  }
  return null;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vosk-'));
  const zipPath = path.join(tmp, 'model.zip');
  try {
    console.log('[fetch-vosk-model] downloading', MODEL_URL);
    await download(MODEL_URL, zipPath);
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
    if (sha256 !== MODEL_SHA256) throw new Error(`checksum mismatch: got ${sha256}, expected ${MODEL_SHA256}`);

    console.log('[fetch-vosk-model] extracting…');
    execFileSync('unzip', ['-q', zipPath, '-d', tmp], { stdio: 'inherit' });
    const modelDir = findModelDir(tmp);
    if (!modelDir) throw new Error('no model folder (with am/ and conf/) found in archive');
    fs.renameSync(modelDir, path.join(tmp, 'model'));

    fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log('[fetch-vosk-model] packaging public/vosk/model.tar.gz …');
    // Package to a temp file and move it into place only on success: a partial OUT_FILE would
    // make every later run skip ("already exists") and ship a broken model.
    const tmpTar = path.join(tmp, 'model.tar.gz');
    execFileSync('tar', ['-czf', tmpTar, '-C', tmp, 'model'], { stdio: 'inherit' });
    const partFile = `${OUT_FILE}.part`;
    fs.copyFileSync(tmpTar, partFile);
    fs.renameSync(partFile, OUT_FILE); // same directory, so the rename is atomic

    const mb = (fs.statSync(OUT_FILE).size / 1e6).toFixed(1);
    console.log(`[fetch-vosk-model] done — ${mb} MB at public/vosk/model.tar.gz`);
  } catch (err) {
    console.error('[fetch-vosk-model] FAILED:', err.message);
    console.error('Voice input will fall back to the manual carousel until this succeeds.');
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
