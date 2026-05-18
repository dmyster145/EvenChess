# Changelog

## Unreleased

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
