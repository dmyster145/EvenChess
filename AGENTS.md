# AGENTS.md

Guide for coding agents and new contributors. User-facing docs are in [README.md](README.md);
the workflow is in [CONTRIBUTING.md](CONTRIBUTING.md).

## Architecture

The app is a store with a pure reducer. Everything that touches the outside world lives
outside the reducer.

- **`src/state/reducer.ts`** is `(state, action) => state`: synchronous, no I/O. It does read
  `Date.now()` (clocks) and `Math.random()` (Academy puzzles). Its header has the gameplay
  state-machine diagram.
- **`src/state/selectors.ts`** derives everything shown on the glasses (HUD text, carousel,
  log) from state.
- **`src/app/*`** holds the side effects; **`src/app.ts`** wires them together. Read the
  `app.ts` header first: it lists each `src/app/` file and has the exit-dialog notes.
  - `flush.ts`: the single render path, debounced, latest-wins per container
  - `side-effects.ts`: store-subscription effects (engine replies, settings persistence,
    menu/reset/mode effects, autosave queueing)
  - `lifecycle.ts`: foreground/background, exit dialog, wearing; pauses the bullet clock
  - `bullet-timer.ts`, `autosave.ts`, `branding.ts`, `init.ts`, `background-snapshot.ts`,
    `bridge-reinit.ts` (debug only)
- Voice is wired in `app.ts`: a tap in idle is intercepted to start listening before it
  reaches the reducer.

Add new behaviour as an action handled in the reducer plus, if needed, an effect in
`src/app/`. Don't do I/O in the reducer or selectors.

## Source folders

| Folder | What it does |
|--------|--------------|
| `src/state/` | `contracts.ts` (types, actions, `buildInitialState`), reducer, selectors, store, constants, utils |
| `src/app/` | Side effects (see above) |
| `src/input/` | `actions.ts`: SDK events → `Action`, with duplicate/timing filters |
| `src/evenhub/` | `bridge.ts`: the only module that calls the SDK |
| `src/render/` | `composer.ts` (page containers/layout), `boardimage.ts`, `branding.ts` (captured-pieces strip), PNG/BMP encoding |
| `src/chess/` | `ChessService` (chess.js wrapper), square helpers |
| `src/engine/` | `stockfishbridge.ts` (worker, random-move fallback), `turnloop.ts`, `profiles.ts` |
| `src/voice/` | `controller.ts` (push-to-talk lifecycle), `recognizer.ts` (Vosk), `grammar.ts`, `parse.ts`, `resolve.ts`, `pcm.ts` |
| `src/academy/` | Drills, puzzles, knight paths, famous games |
| `src/bullet/` | `formatTime` only; the clock runs in the reducer |
| `src/storage/` | `persistence.ts` (saved game/settings, validated on load), `background-state.ts` |
| `src/utils/`, `src/debug/`, `src/perf/` | WebView keep-alive; debug log and board snapshot; optional perf log |

## Single sources of truth

- **Phase groups:** `src/state/utils.ts` (`PHASE_GROUP` → `GAME_PHASES`, `MENU_PHASES`,
  `SUBMENU_PHASES`, `INVERTED_SCROLL_PHASES`). Every `UIPhase` must be classified there; the
  compiler enforces it. Don't write ad-hoc phase lists elsewhere.
- **Menus:** `src/state/constants.ts` builds each menu (main, Display Options, Mode, Drills,
  Difficulty, Play As) from one `optionTable` of `{ key, label }` rows. Options, labels and
  indexes derive from it; use `MENU_INDEX.x` etc., not numeric literals.

## SDK and firmware quirks the code works around

Read the comments in these files before changing them.

- **Duplicate input events** (`src/input/actions.ts`): one physical gesture can arrive as 2×
  CLICK or 2× DOUBLE_CLICK ~50–100 ms apart. Taps are deduped at 130 ms, double-taps at
  600 ms, and same-direction scrolls at 500 ms during board selection. A tap cooldown and a
  post-tap scroll filter also apply.
- **Duplicate sys events** (`src/app/lifecycle.ts`): deduped within 600 ms.
- **Serialized SDK calls** (`src/evenhub/bridge.ts` header): every SDK call (image, text, page,
  storage, shutdown) goes through one promise chain with per-call timeouts; concurrent calls
  can crash the connection. Image/text updates are latest-wins per container.
- **Image size cap** (`src/render/composer.ts`): firmware caps image containers at 200×100, so
  the board is two 200×100 halves and the "large" board uses bigger cells in the same
  containers.
- **Input-capture container** (`composer.ts`, `USE_INPUT_CAPTURE_CONTAINER`): an invisible
  full-screen container behind everything receives gestures, so the firmware doesn't scroll
  the visible menu text.
- **Exit dialog** (`src/app.ts` and `src/app/lifecycle.ts` headers): the menu's Exit calls
  `shutDownPageContainer(1)`. While the dialog is up, sys event meanings are inverted
  (sys=5 means "No", not background) and the app must not touch the page. After "No" the
  board stays frozen until restart: a known SDK defect with no software fix.

## Before committing

```bash
npx tsc -b      # typecheck src and tests
npm run lint    # eslint src/ tests/
npm test        # vitest run
npm run build   # tsc -b && vite build
```

CI runs lint, typecheck, tests and build on every push and pull request.

## Tests

- `tests/` mirrors `src/` (`src/app/flush.ts` → `tests/app/flush.test.ts`).
- Build `GameState` fixtures from `baseGameState()` in `tests/helpers/game-state.ts` and spread
  overrides on top, so new required fields can't be missed.
- A test must fail when the code it covers breaks. Check it by breaking the code once.
- Prefer exact assertions: exact values and sequences, `toBe(state)` for no-op actions, no
  conditional `expect`s.
- Drive behaviour through the real actions (`TAP`, `DOUBLE_TAP`, `SCROLL`), not test-only helpers.

## Simulator

`@evenrealities/evenhub-simulator` is a devDependency. Start `npm run dev`, then in another
terminal:

```bash
node node_modules/@evenrealities/evenhub-simulator/bin/index.js http://localhost:5173
```

Invoke the project-local `bin/index.js` directly: an older global `evenhub-simulator` on
`PATH` can shadow it. Add `--automation-port 9898` (after the URL) for its HTTP API (input,
screenshots, console logs). Without the voice model, voice falls back to manual moves; in a
browser you can test parsing with `window.__evenchess_voice('knight to c3')`.
