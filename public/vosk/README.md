# Offline voice model

Push-to-talk voice moves use [vosk-browser](https://github.com/ccoreilly/vosk-browser),
which runs a small Kaldi speech model entirely on-device (no server, no network).

The model is **not committed** (~40 MB). Fetch + repackage it once:

```
npm run fetch:voice-model
```

This writes `public/vosk/model.tar.gz` (a gzipped tar of a `model/` folder, the
format vosk-browser expects). Vite copies `public/` into `dist/`, so it is packed
into the `.ehpk` and loaded at runtime from the relative URL `/vosk/model.tar.gz`
— fully offline.

If the file is absent the app still works: push-to-talk silently falls back to the
manual scroll carousel.
