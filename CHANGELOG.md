# Changelog

## 2.1.0 — Unreleased

### Added

- **Display Options → Position (Bottom/Top).** Choose whether your pieces are drawn at
  the bottom or the top of the board. Saved with the other display options.
- **Bullet clock pauses during system overlays and in the background**, and resumes
  without charging the paused time. A clock that has not started yet stays stopped.

### Changed

- **Even Hub SDK 0.0.14 → 0.0.16.** Requires Even App 2.2.10 or newer
  (`min_app_version` 2.2.10, `min_sdk_version` 0.0.16).
- **Removed the `compressMode` image patch from 2.0.5.** The Even App fixed the image
  bug on its side in 2.2.9, so board images work without it.
- **Double-tap from idle opens the in-app menu again.** The native OS context menu tried
  in this release was reverted.
- **Help-page font is self-hosted**, so the app no longer requests the `network`
  permission. `g2-microphone` (voice moves) is the only permission.
- The Custom difficulty picker marks which level bands Easy, Casual, and Serious fall in.
- The bullet clock starts on your first move action (scroll, tap, or voice), not only on
  a scroll.
- Choosing Bullet or Academy and then backing out keeps the current game and clock.
- **Custom difficulty and Bullet time-control pickers only apply on a tap.** Scrolling
  browses; double-tapping out cancels and keeps the previous setting.

### Fixed

- Bullet clock display rounds up, so 0:00 appears only when time has run out.
- A Custom difficulty level picked while on Easy, Casual, or Serious is now saved.
- Returning from the background no longer resets the game or its move log.
- In Bullet, the increment goes to the engine's own color, and the engine's think time
  is capped by its remaining clock. An engine move that ends the game stops the clock.
- A finished or unreadable saved game starts a new game instead of a dead board.
- You can no longer start selecting a move while the engine is thinking.
- View Log scrolls through the whole game; PGN Study marks the move just played.
- In Bullet, a flag fall while a voice move waited for its tap no longer locks the
  game-over screen; double-tap starts a new game.
- In Bullet, time is charged to the side that was thinking at each turn change, not to
  whoever is on move at the next clock tick. A move made after your clock ran out loses
  on time; the increment no longer brings it back.
- Closing the menu after leaving an Academy drill returns to the Academy list, not to a
  play board stuck in Academy mode.
- Returning from the background keeps a finished game's result, and no longer lets the
  engine play a random move if it was asked to move before Stockfish had loaded.
- The Custom difficulty picker fits on screen again ("8–9: Expert" was cut off).
- Voice: "queen side castle" and "king castles queen side" castle queenside; "knight takes a pawn on D5" works; when
  two pawns can promote on one square, the prompts suggest a command that completes it.
- Voice: a leading "a" ("a knight to C3") is ignored; "takes" prefers the capture;
  spoken promotions ("E8 queen") work when another piece can reach the square; a short
  pause no longer cuts a command off; a cancelled session can't leak into the next.
- Academy: Tactics replaced with 13 verified positions; solutions show the full line;
  Knight Path fallback puzzles use the correct move count.
- Input: a stray scroll right after a tap no longer swallows your next swipe.
- The captured-pieces strip shows both sides (with "+N" when it overflows) instead of
  dropping Black's pieces.
- Saved settings and games are validated on load; invalid values fall back to defaults.

## 2.0.5 — 2026-07-13

### Fixed

- **Board images render again on SDK 0.0.12.** 0.0.12's `ImageRawDataUpdate.toJson`
  tags every image payload `compressMode: 2` (LZ4) but the bundle ships no LZ4
  compression, so the host rejected every image with `sendFailed` (text was
  unaffected). Patched the static serializer at bridge init to strip the bogus
  field, restoring the pre-0.0.12 wire format.
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
