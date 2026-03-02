/**
 * WebView keep-alive utilities.
 *
 * Best-effort protection against aggressive timer throttling in constrained WebViews.
 * Activation must happen from a user gesture context due autoplay policy.
 */

import { perfLogIfEnabled, perfLogLazyIfEnabled } from '../perf/log';

let audioCtx: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;
let gainNode: GainNode | null = null;
let active = false;

export function activateKeepAlive(): void {
  if (active) return;

  try {
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error('AudioContext unsupported');

    audioCtx = new Ctor();
    oscillator = audioCtx.createOscillator();
    gainNode = audioCtx.createGain();
    oscillator.frequency.value = 1;
    gainNode.gain.value = 0.001;
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.start();
    active = true;
    perfLogLazyIfEnabled?.(() => `[Perf][KeepAlive][Audio] activated state=${audioCtx?.state ?? 'null'}`);

    audioCtx.addEventListener('statechange', () => {
      perfLogLazyIfEnabled?.(() => `[Perf][KeepAlive][Audio] statechange=${audioCtx?.state ?? 'null'}`);
      if (audioCtx?.state === 'suspended') {
        audioCtx.resume().catch(() => {
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

export function isKeepAliveActive(): boolean {
  return active;
}

export function deactivateKeepAlive(): void {
  if (oscillator) {
    try {
      oscillator.stop();
    } catch {
      // already stopped
    }
    oscillator = null;
  }
  if (gainNode) {
    try {
      gainNode.disconnect();
    } catch {
      // already disconnected
    }
    gainNode = null;
  }
  if (audioCtx) {
    try {
      void audioCtx.close();
    } catch {
      // already closed
    }
    audioCtx = null;
  }
  if (active) {
    active = false;
    perfLogIfEnabled?.('[Perf][KeepAlive] deactivated');
  }
}
