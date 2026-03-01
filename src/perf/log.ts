/**
 * Perf log capture used for on-glasses measurements where terminal/devtools logging is not accessible.
 *
 * Design goals:
 * - Best-effort only (must never break gameplay)
 * - Persist enough history for manual export after a test run
 * - Batch localStorage writes to avoid adding noticeable overhead to hot paths
 * - Keep perf instrumentation in place with near-zero cost when disabled
 */
const STORAGE_KEY = 'evenchess-perf-log-v1';
const MAX_ENTRIES = 4000;
const FLUSH_INTERVAL_MS = 1000;
// Runtime perf log sinks are disabled by default so instrumentation can stay in the codebase
// without adding console noise or localStorage write overhead in normal use.
// Turn these on temporarily for on-device profiling sessions.
const PERF_LOG_CONSOLE_ENABLED = false;
const PERF_LOG_CAPTURE_ENABLED = false;

type MaybeIdleHandle = number;

type IdleCallback = () => void;

interface PerfLogEntry {
  ts: number;
  msg: string;
}

let entries: PerfLogEntry[] = [];
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let idleFlushHandle: MaybeIdleHandle | null = null;
let initialized = false;

export function safeNow(): number {
  return Date.now();
}

export function perfNowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function isPerfLoggingEnabled(): boolean {
  return PERF_LOG_CONSOLE_ENABLED || PERF_LOG_CAPTURE_ENABLED;
}

function getRequestIdleCallback(): ((cb: IdleCallback, opts?: { timeout?: number }) => number) | null {
  if (typeof window === 'undefined') return null;
  const ric = (window as Window & {
    requestIdleCallback?: (cb: IdleCallback, opts?: { timeout?: number }) => number;
  }).requestIdleCallback;
  return typeof ric === 'function' ? ric.bind(window) : null;
}

function getCancelIdleCallback(): ((id: number) => void) | null {
  if (typeof window === 'undefined') return null;
  const cic = (window as Window & {
    cancelIdleCallback?: (id: number) => void;
  }).cancelIdleCallback;
  return typeof cic === 'function' ? cic.bind(window) : null;
}

function loadEntries(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as PerfLogEntry[];
    if (!Array.isArray(parsed)) return;
    entries = parsed.filter((e) => e && typeof e.ts === 'number' && typeof e.msg === 'string').slice(-MAX_ENTRIES);
  } catch {
    entries = [];
  }
}

function clearScheduledFlushHandles(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (idleFlushHandle != null) {
    getCancelIdleCallback()?.(idleFlushHandle);
    idleFlushHandle = null;
  }
}

function flushEntriesForced(): void {
  clearScheduledFlushHandles();
  if (!dirty) return;
  dirty = false;
  try {
    // localStorage is synchronous; writes are batched and trimmed to keep impact predictable.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Best effort only.
  }
}

function scheduleFlush(): void {
  if (!PERF_LOG_CAPTURE_ENABLED) return;
  if (flushTimer || idleFlushHandle != null) return;

  const run = (): void => {
    idleFlushHandle = null;
    flushTimer = null;
    flushEntriesForced();
  };

  const ric = getRequestIdleCallback();
  if (ric) {
    idleFlushHandle = ric(run, { timeout: FLUSH_INTERVAL_MS });
    // Fallback safety timer in case requestIdleCallback is throttled aggressively.
    flushTimer = setTimeout(run, FLUSH_INTERVAL_MS + 500);
    return;
  }

  flushTimer = setTimeout(run, FLUSH_INTERVAL_MS);
}

function formatDumpLines(logEntries: PerfLogEntry[]): string {
  return logEntries
    .map((e) => `${new Date(e.ts).toISOString()} ${e.msg}`)
    .join('\n');
}

function ensureInitialized(): void {
  if (initialized) return;
  if (!PERF_LOG_CAPTURE_ENABLED) return;
  initialized = true;
  if (typeof window === 'undefined') return;
  loadEntries();

  const api = {
    dumpText: (): string => formatDumpLines(entries),
    getEntries: (): PerfLogEntry[] => [...entries],
    clear: (): void => {
      entries = [];
      dirty = true;
      flushEntriesForced();
      console.log('[PerfLog] Cleared.');
    },
    download: (): void => {
      const text = formatDumpLines(entries);
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `evenchess-perf-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };

  (window as Window & { __evenChessPerf?: typeof api }).__evenChessPerf = api;
  window.addEventListener('beforeunload', flushEntriesForced);
}

export function perfLog(msg: string): void {
  if (!isPerfLoggingEnabled()) return;
  if (PERF_LOG_CONSOLE_ENABLED) {
    // Optional live debugging path.
    console.log(msg);
  }
  if (!PERF_LOG_CAPTURE_ENABLED) return;
  ensureInitialized();
  if (typeof window === 'undefined') return;
  entries.push({ ts: safeNow(), msg });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  dirty = true;
  scheduleFlush();
}

/** Avoids building perf log strings when all perf sinks are disabled. */
export function perfLogLazy(msgFactory: () => string): void {
  if (!isPerfLoggingEnabled()) return;
  perfLog(msgFactory());
}

export function clearPerfLog(): void {
  if (!PERF_LOG_CAPTURE_ENABLED) return;
  ensureInitialized();
  if (typeof window === 'undefined') return;
  entries = [];
  dirty = true;
  flushEntriesForced();
}
