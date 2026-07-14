# Changelog

## 2.0.5 — 2026-07-13

### Fixed

- **Board images render again on SDK 0.0.12.** 0.0.12's `ImageRawDataUpdate.toJson`
  tags every image payload `compressMode: 2` (LZ4) but the bundle ships no LZ4
  compression, so the host rejected every image with `sendFailed` (text was
  unaffected). Patched the static serializer at bridge init to strip the bogus
  field, restoring the pre-0.0.12 wire format. See
  [docs/sdk-0.0.12-image-compressmode-bug.md](docs/sdk-0.0.12-image-compressmode-bug.md).
- **Board no longer decomposes when the exit dialog is cancelled.** The lifecycle no
  longer rebuilds/repaints the page while the system exit dialog is on screen (that
  emptied the image containers); it now leaves the firmware's retained frame intact.
  Note: `shutDownPageContainer(1)` still kills the image channel for the session, so
  after tapping "No" the board is frozen until an app restart — an ER SDK defect with
  no software recovery (reported upstream).

### Changed

- **Exit follows ER's documented "Chess" reference pattern.** Root (game) double-tap
  opens the settings menu; the menu's **Exit** item fires the system exit-confirmation
  dialog (`shutDownPageContainer(1)`). Double-tap inside the menu now just closes it,
  so a stray gesture can't trip the exit-dialog SDK defect.
- **Board Markers moved under Settings → Display Options** (alongside Alignment and
  Size), decluttering the top-level menu.
- **Display Options toggle in place.** Tapping Alignment, Size, or Board Markers now
  flips the value directly (each is binary) and shows it inline — no sub-menu.
- **Gestures are captured by a dedicated invisible full-screen container** so the
  firmware no longer re-anchors/scrolls the visible menu text as you swipe between
  options. Toggle via `USE_INPUT_CAPTURE_CONTAINER` in `src/render/composer.ts`.

### Dependencies

- Bumped `@evenrealities/even_hub_sdk` `0.0.10` → `0.0.12`; raised manifest
  `min_sdk_version` to `0.0.11` (current ER submission floor).

## 2.0.4 — 2026-05-18

### Fixed

- Voice confirm label now names the piece for pawn moves: "Pawn to D4" shows
  `Heard: Pawn D4` instead of a bare `Heard: D4`.

## 2.0.3 — 2026-05-18

### Added — Offline voice move input

- **Push-to-talk voice moves.** Tap in the idle phase and speak a move (e.g.
  "Knight to C3"). Scroll still opens the manual carousel and double-tap still
  opens the menu.
- **Tap-to-confirm safeguard.** A recognized move is shown for review
  ("Heard: Knight c3") and is played only after you tap to confirm — double-tap
  aborts it, scrolling discards it for the manual carousel. This prevents a
  misheard command from being played. If nothing matches, the error is shown
  and no confirmation step is needed.
- **Fully on-device.** Speech is recognized locally via a bundled, grammar-
  constrained Vosk model — no server, no network, no API key. The mic uses the
  SDK `audioControl` PCM bridge (added `g2-microphone` permission).
- **Flexible phrasing.** Files accept both plain letters ("c3") and NATO
  phonetic ("charlie three"); supports captures, castling ("castle kingside"),
  promotion, and source-square disambiguation ("Which knight? B1 or E2").
- **Graceful fallback.** If the model can't load or the mic is unavailable,
  tap-in-idle silently falls back to the manual carousel — voice is additive
  and never blocks play. The mic is force-closed on every exit path.
- Model is fetched/repackaged via `npm run fetch:voice-model` (not committed).

_Note: iOS WKWebView memory under the model is pending real-hardware verification._
