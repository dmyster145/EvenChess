# EvenChess

Chess for **Even Realities G2** smart glasses. Play vs Stockfish, race the clock in Bullet Blitz, or train in the Academy. Navigate with scroll and tap on the R1 ring or touchpad.

This project is licensed under the MIT License — see [LICENSE](LICENSE).

## Screenshots

| Play — piece selection | Menu | Mode select |
|------------------------|------|-------------|
| ![Piece selection and board](assets/screenshot.png) | ![Main menu](assets/screenshot-menu.png) | ![Select mode](assets/screenshot-mode-select.png) |

| Bullet Blitz — timed game | Academy — drill selection |
|---------------------------|----------------------------|
| ![Academy drills](assets/screenshot-academy.png) | ![Bullet with timers and log](assets/screenshot-bullet.png) |

## Quick links

- **In-app help:** When you open the app URL on your phone, you get the full instructions page (see [index.html](index.html)). It covers getting started, game modes, controls, menu options, academy drills, and tips. The same content is built from this repo.

## Tech stack

- **Runtime:** TypeScript, Vite
- **Chess:** [chess.js](https://github.com/jhlywa/chess.js) (rules, FEN, moves); [Stockfish](https://stockfishchess.org/) WASM via the **stockfish.js** npm package — worker and WASM are copied to `public/stockfish/` by the postinstall script so Vite can serve them. If the engine fails to load, the app falls back to random moves.
- **Glasses:** [Even Hub SDK](https://www.npmjs.com/package/@evenrealities/even_hub_sdk) — containers, 1-bit BMP updates, event mapping
- **Tests:** Vitest

## Project structure

```
EvenChess/
├── index.html          # Entry page; shows help/instructions on phone, mounts app in #app
├── src/
│   ├── main.ts         # Boots the app
│   ├── app.ts          # Wires ChessService, store, composer, EvenHub bridge, TurnLoop, persistence
│   ├── state/          # Redux-like state: contracts, reducer, selectors, store, constants, utils
│   ├── render/         # Board (boardimage), branding, composer (SDK containers), BMP helpers, pieces
│   ├── evenhub/        # SDK bridge: init, page setup, text/image updates, event subscription
│   ├── chess/          # ChessService (chess.js wrapper), square-utils
│   ├── engine/         # TurnLoop, StockfishBridge (worker), profiles
│   ├── bullet/         # Clock (tick, increment, format, expiry)
│   ├── academy/        # Drills (coordinates, knight path, tactics, mate, PGN), puzzles, knight logic
│   ├── storage/        # Persistence (game save, difficulty, board markers)
│   └── input/          # SDK event → Action mapping (scroll/tap/double-tap), replay fixtures
└── tests/              # Unit tests for state, storage, bullet, academy, chess, input
```

## Scripts

| Command        | Description                |
|----------------|----------------------------|
| `npm run dev`  | Start Vite dev server      |
| `npm run build`| TypeScript build + Vite build |
| `npm run preview` | Preview production build |
| `npm run test` | Run Vitest once            |
| `npm run test:watch` | Vitest watch mode    |
| `npm run lint` | ESLint on `src/`           |

## Running and testing

1. **Install:** `npm install`
2. **Dev:** `npm run dev` — open the URL in a browser to see the [help page](index.html); use the Even Hub simulator or real glasses for the chess HUD.
3. **Test:** `npm test`
4. **Build:** `npm run build` — output in `dist/`.

## Features (summary)

- **Play vs AI:** White vs Stockfish; Easy, Casual, or Serious difficulty. Game auto-saves.
- **Bullet Blitz:** Timed game with optional increment (e.g. 1+0, 3+2, 5+5).
- **Academy:** Coordinate drill, Tactics, Mate-in-one, Knight Path, PGN Study (famous games and openings).
- **Menu (double-tap from idle):** Mode, Board Markers (A–H / 1–8), View Log, Difficulty, Reset, Exit. Difficulty and board markers persist.

All behavior is documented on the in-app help page defined in [index.html](index.html).

## License & credits

- **chess.js** — [BSD-2-Clause](https://opensource.org/licenses/BSD-2-Clause). Copyright © Jeff Hlywa. Used for move generation, validation, FEN, and PGN. [GitHub](https://github.com/jhlywa/chess.js).
- **Stockfish** — The app uses [stockfish.js](https://www.npmjs.com/package/stockfish.js) (GPL-3.0) from npm; the worker and WASM are copied to `public/stockfish/` on install. A placeholder worker file (`src/engine/stockfish-worker.js`) still exists for reference; if the real engine does not load (e.g. missing files), the app uses random moves and difficulty has no effect. The MIT license above applies only to EvenChess; distribution of a build that includes Stockfish must comply with GPL-3.0 for that component (attribution, license text, source offer).
