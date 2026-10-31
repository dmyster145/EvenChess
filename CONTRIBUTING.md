# Contributing

Thanks for helping. Read [AGENTS.md](AGENTS.md) first: it maps the code, the reducer /
side-effect split, and the SDK quirks the code works around.

## Setup

Node.js 20.19.0 or newer.

```bash
git clone https://github.com/dmyster145/EvenChess.git
cd EvenChess
npm install                  # also copies Stockfish into public/stockfish/
npm run fetch:voice-model    # optional, ~40 MB; needs unzip and tar
npm run dev
```

See the [README](README.md#setup) for opening the app on the glasses.

## Before you commit

```bash
npx tsc -b
npm run lint
npm test
npm run build
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs lint, typecheck, tests and build
on every push and pull request.

Bug fixes come with a test that fails without the fix. Test conventions are in
[AGENTS.md](AGENTS.md#tests).

## Commits

- Subject: short, imperative, capitalized, no trailing period, no type prefix
  (e.g. `Fix input filters, stored-data validation, keep-alive, and capture strip`).
- Body: what changed and why, wrapped at ~72 columns; bullet lists are fine.
- One logical change per commit. Update [CHANGELOG.md](CHANGELOG.md) for user-visible changes.
