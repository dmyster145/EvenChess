/**
 * WebView keep-alive (best effort) against aggressive timer throttling in constrained WebViews:
 * a near-silent oscillator plus a held Web Lock.
 *
 * Activated once, on the first glasses input event (app.ts). That is a bridge message, not a DOM
 * user gesture, so autoplay policy may keep the AudioContext suspended; the Web Lock still applies.
 * A failed attempt is not retried, so input events never pile up AudioContexts or lock requests.
 */

import { perfLogIfEnabled, perfLogLazyIfEnabled } from '../perf/log';

let attempted = false;
/** Holds the session's AudioContext so the running audio graph is never garbage-collected. */
const heldAudio: AudioContext[] = [];

/** Start the keep-alive. Idempotent: only the first call does anything. */
export function activateKeepAlive(): void {
  if (attempted) return;
  attempted = true;

  try {
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error('AudioContext unsupported');

    const ctx = new Ctor();
    heldAudio.push(ctx);
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.frequency.value = 1;
    gainNode.gain.value = 0.001;
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start();
    perfLogLazyIfEnabled?.(() => `[Perf][KeepAlive][Audio] activated state=${ctx.state}`);

    ctx.addEventListener('statechange', () => {
      perfLogLazyIfEnabled?.(() => `[Perf][KeepAlive][Audio] statechange=${ctx.state}`);
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {
          perfLogIfEnabled?.('[Perf][KeepAlive][Audio] resume-failed');
        });
      }
    });
  } catch {
    perfLogIfEnabled?.('[Perf][KeepAlive][Audio] init-failed');
  }

  try {
    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      (navigator.locks as LockManager)
        .request(
          'evenchess_keep_alive',
          () =>
            new Promise<void>(() => {
              perfLogIfEnabled?.('[Perf][KeepAlive][WebLock] acquired');
            }),
        )
        .catch(() => {
          perfLogIfEnabled?.('[Perf][KeepAlive][WebLock] request-failed');
        });
    }
  } catch {
    // Noop.
  }
}
