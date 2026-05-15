/**
 * Background-state shim — keeps the app alive across Even Hub's headless WebView migration.
 *
 * Per the everything-evenhub `background-state` skill, when the phone backgrounds the host calls
 * `window.__getStateSnapshot()` to capture JS state, spins up a `HeadlessInAppWebView` with the
 * same plugin URL, and calls `window.__restoreState(snapshot)` to replay. The headless WebView
 * continues pushing frames to the glasses; on resume the snapshot is injected back into the
 * foreground WebView before the headless one is destroyed.
 *
 * If a plugin doesn't define these globals, the snapshot is empty and the headless / restored
 * WebView starts from scratch — manifesting as "the game reset itself when I picked up my phone."
 *
 * This module is a forward-compat shim for the public API the SDK will expose (`setBackgroundState`
 * / `onBackgroundRestore`) once a newer `@evenrealities/even_hub_sdk` releases. Until then, we
 * define the host-side `window.__getStateSnapshot` / `window.__restoreState` globals ourselves
 * and route registered exporters through them. Swapping to the SDK functions later is a one-line
 * import change at call sites.
 */

type Snapshotter = () => unknown;
type Restorer = (saved: unknown) => void;

const exporters = new Map<string, Snapshotter>();
const restorers = new Map<string, Restorer>();
/**
 * Snapshot received before any restorer registered, buffered per key. When a restorer arrives, it
 * drains the corresponding entry. This handles the race where the host fires `__restoreState`
 * before our `initApp` reaches the `onBackgroundRestore` call.
 */
const pendingRestoreByKey = new Map<string, unknown>();
let globalsInstalled = false;

interface BackgroundStateGlobal {
  __getStateSnapshot?: () => string;
  __restoreState?: (snapshot: string) => void;
}

function installGlobals(): void {
  if (globalsInstalled) return;
  // Install on globalThis (which equals `window` in any WebView) so the host's
  // `window.__getStateSnapshot()` call resolves correctly in production and tests can hit the same
  // surface via globalThis in a node environment.
  if (typeof globalThis === 'undefined') return;
  const w = globalThis as unknown as BackgroundStateGlobal;

  w.__getStateSnapshot = (): string => {
    const out: Record<string, unknown> = {};
    for (const [key, snapshotter] of exporters) {
      try {
        out[key] = snapshotter();
      } catch (err) {
        console.error(`[BackgroundState] Exporter "${key}" failed:`, err);
      }
    }
    try {
      return JSON.stringify(out);
    } catch (err) {
      console.error('[BackgroundState] Snapshot JSON.stringify failed:', err);
      return '{}';
    }
  };

  w.__restoreState = (raw: string): void => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      console.error('[BackgroundState] Restore JSON.parse failed:', err);
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    for (const key of Object.keys(parsed)) {
      const value = parsed[key];
      if (value === undefined) continue;
      const restorer = restorers.get(key);
      if (restorer) {
        try {
          restorer(value);
        } catch (err) {
          console.error(`[BackgroundState] Restorer "${key}" failed:`, err);
        }
      } else {
        // No restorer yet — buffer until one registers. Drained in onBackgroundRestore().
        pendingRestoreByKey.set(key, value);
      }
    }
  };

  globalsInstalled = true;
}

// Install host-side globals immediately on module load, NOT lazily on first registration. The host
// may call `window.__restoreState` between when our JS first executes and when initApp finishes
// awaiting startup work — at that point setBackgroundState/onBackgroundRestore haven't run yet but
// the globals must already exist so the snapshot can be buffered.
installGlobals();

/**
 * Register a snapshot exporter. The function is called by the host (via `window.__getStateSnapshot`)
 * when the phone backgrounds. Must return a JSON-serializable value — spread a snapshot copy of any
 * mutable state, not a live reference.
 */
export function setBackgroundState(key: string, snapshotter: Snapshotter): void {
  exporters.set(key, snapshotter);
}

/**
 * Register a snapshot restorer. The function is called by the host (via `window.__restoreState`)
 * after migrating to a fresh WebView. Each restorer receives only the value for its own key. If a
 * snapshot for this key arrived before registration, the buffered value is replayed immediately.
 */
export function onBackgroundRestore(key: string, restorer: Restorer): void {
  restorers.set(key, restorer);
  if (pendingRestoreByKey.has(key)) {
    const value = pendingRestoreByKey.get(key);
    pendingRestoreByKey.delete(key);
    try {
      restorer(value);
    } catch (err) {
      console.error(`[BackgroundState] Buffered restorer "${key}" failed:`, err);
    }
  }
}

/** Test/teardown helper — clears all registered exporters/restorers + pending buffer. Globals stay. */
export function _resetBackgroundStateRegistry(): void {
  exporters.clear();
  restorers.clear();
  pendingRestoreByKey.clear();
}

/** Test helper — returns whether the host-side globals have been installed. */
export function _backgroundStateGlobalsInstalled(): boolean {
  return globalsInstalled;
}
