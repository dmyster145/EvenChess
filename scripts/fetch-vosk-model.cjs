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
const { execFileSync } = require('child_process');

const MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip';
const OUT_DIR = path.join(__dirname, '..', 'public', 'vosk');
const OUT_FILE = path.join(OUT_DIR, 'model.tar.gz');

if (fs.existsSync(OUT_FILE)) {
  console.log('[fetch-vosk-model] public/vosk/model.tar.gz already exists — skipping.');
  process.exit(0);
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(download(res.headers.location, dest, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vosk-'));
  const zipPath = path.join(tmp, 'model.zip');
  try {
    console.log('[fetch-vosk-model] downloading', MODEL_URL);
    await download(MODEL_URL, zipPath);

    console.log('[fetch-vosk-model] extracting…');
    execFileSync('unzip', ['-q', zipPath, '-d', tmp], { stdio: 'inherit' });
    const top = fs
      .readdirSync(tmp, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)[0];
    if (!top) throw new Error('no model folder found in archive');
    fs.renameSync(path.join(tmp, top), path.join(tmp, 'model'));

    fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log('[fetch-vosk-model] packaging public/vosk/model.tar.gz …');
    execFileSync('tar', ['-czf', OUT_FILE, '-C', tmp, 'model'], { stdio: 'inherit' });

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
