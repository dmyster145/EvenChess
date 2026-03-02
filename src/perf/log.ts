/**
 * Lightweight perf log capture for on-device profiling sessions.
 * Includes an optional floating DOM console panel (ported from EvenSolitaire).
 */

const STORAGE_KEY = 'evenchess-perf-log-v1';
const MAX_ENTRIES = 4000;
const FLUSH_INTERVAL_MS = 1000;
const FLUSH_IDLE_GAP_MS = 1500;
const FLUSH_MAX_DEFER_MS = 5000;
/** Max lines in the DOM console; oldest lines are dropped when exceeded (running flush). */
const DOM_MAX_LINES = 500;
const DOM_FLUSH_BATCH_MS = 16;
// Runtime perf log sinks are disabled by default so instrumentation can stay in the codebase
// without adding overhead in normal use. Turn on temporarily for profiling sessions.
const PERF_LOG_CONSOLE_ENABLED = false;
const PERF_LOG_CAPTURE_ENABLED = false;
const PERF_LOG_DOM_ENABLED = false;

export const PERF_LOG_ENABLED = PERF_LOG_CONSOLE_ENABLED || PERF_LOG_CAPTURE_ENABLED || PERF_LOG_DOM_ENABLED;

if (typeof window !== 'undefined') {
  (
    window as Window & {
      __evenChessPerfConfig?: {
        consoleEnabled: boolean;
        captureEnabled: boolean;
        domEnabled: boolean;
        anyEnabled: boolean;
      };
    }
  ).__evenChessPerfConfig = {
    consoleEnabled: PERF_LOG_CONSOLE_ENABLED,
    captureEnabled: PERF_LOG_CAPTURE_ENABLED,
    domEnabled: PERF_LOG_DOM_ENABLED,
    anyEnabled: PERF_LOG_ENABLED,
  };
}

interface PerfLogEntry {
  ts: number;
  msg: string;
}

let entries: PerfLogEntry[] = [];
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let dirtySinceTs = 0;
let lastEntryTs = 0;
let initialized = false;
let domInitialized = false;
let domRenderedLines: string[] = [];
let domPendingLines: string[] = [];
let domFlushTimer: ReturnType<typeof setTimeout> | null = null;
/** When true, perfLog does not append to DOM or capture (Stop/Start button). */
let recordingPaused = false;

export function safeNow(): number {
  return Date.now();
}

export function perfNowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function isPerfLoggingEnabled(): boolean {
  return PERF_LOG_ENABLED;
}

function loadEntries(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as PerfLogEntry[];
    if (!Array.isArray(parsed)) return;
    entries = parsed
      .filter((e) => e && typeof e.ts === 'number' && typeof e.msg === 'string')
      .slice(-MAX_ENTRIES);
  } catch {
    entries = [];
  }
}

function persistEntriesNow(): void {
  if (!dirty) return;
  dirty = false;
  dirtySinceTs = 0;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Best effort only.
  }
}

function scheduleFlush(delayMs: number = FLUSH_INTERVAL_MS): void {
  if (!PERF_LOG_CAPTURE_ENABLED) return;
  if (flushTimer) return;
  flushTimer = setTimeout(flushEntries, delayMs);
}

function flushEntries(): void {
  flushTimer = null;
  if (!dirty) return;
  const nowTs = safeNow();
  const dirtyAgeMs = dirtySinceTs > 0 ? nowTs - dirtySinceTs : 0;
  const idleAgeMs = lastEntryTs > 0 ? nowTs - lastEntryTs : Number.POSITIVE_INFINITY;
  if (idleAgeMs < FLUSH_IDLE_GAP_MS && dirtyAgeMs < FLUSH_MAX_DEFER_MS) {
    const untilIdleMs = Math.max(0, FLUSH_IDLE_GAP_MS - idleAgeMs);
    const untilMaxDeferMs = Math.max(0, FLUSH_MAX_DEFER_MS - dirtyAgeMs);
    scheduleFlush(Math.max(16, Math.min(untilIdleMs, untilMaxDeferMs)));
    return;
  }
  persistEntriesNow();
}

function flushEntriesForced(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!dirty) return;
  persistEntriesNow();
}

function formatDumpLines(logEntries: PerfLogEntry[]): string {
  return logEntries.map((e) => `${new Date(e.ts).toISOString()} ${e.msg}`).join('\n');
}

function getDomDumpText(): string {
  const allLines = [...domRenderedLines, ...domPendingLines];
  return allLines.join('\n');
}

function getAllLogText(): string {
  if (PERF_LOG_CAPTURE_ENABLED) return formatDumpLines(entries);
  if (PERF_LOG_DOM_ENABLED) return getDomDumpText();
  return '';
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!text) return true;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to execCommand fallback.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

function getDomPanel(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById('perf-console-panel');
}

function getDomOutput(): HTMLPreElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById('perf-console-output');
  return el instanceof HTMLPreElement ? el : null;
}

function getRecordButton(): HTMLButtonElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById('perf-console-record');
  return el instanceof HTMLButtonElement ? el : null;
}

function updateRecordButtonLabel(): void {
  const btn = getRecordButton();
  if (!btn) return;
  btn.textContent = recordingPaused ? 'Start' : 'Stop';
}

function setDomPanelVisibility(visible: boolean): void {
  const panel = getDomPanel();
  if (!panel) return;
  panel.style.display = visible ? 'flex' : 'none';
}

function clearDomOutput(): void {
  if (domFlushTimer) {
    clearTimeout(domFlushTimer);
    domFlushTimer = null;
  }
  domPendingLines = [];
  domRenderedLines = [];
  const output = getDomOutput();
  if (!output) return;
  output.textContent = '';
}

function flushDomOutput(): void {
  domFlushTimer = null;
  if (!PERF_LOG_DOM_ENABLED) return;
  if (domPendingLines.length === 0) return;
  const output = getDomOutput();
  if (!output) {
    domPendingLines = [];
    return;
  }
  domRenderedLines.push(...domPendingLines);
  domPendingLines = [];
  if (domRenderedLines.length > DOM_MAX_LINES) {
    domRenderedLines.splice(0, domRenderedLines.length - DOM_MAX_LINES);
  }
  output.textContent = domRenderedLines.join('\n');
  output.scrollTop = output.scrollHeight;
}

function scheduleDomOutputFlush(): void {
  if (domFlushTimer) return;
  domFlushTimer = setTimeout(flushDomOutput, DOM_FLUSH_BATCH_MS);
}

function appendDomLine(line: string): void {
  if (!PERF_LOG_DOM_ENABLED) return;
  domPendingLines.push(line);
  scheduleDomOutputFlush();
}

function wireDomControls(): void {
  if (typeof document === 'undefined') return;
  const panel = getDomPanel();
  if (!panel) return;
  const toggleBtn = document.getElementById('perf-console-toggle');
  const clearBtn = document.getElementById('perf-console-clear');
  const copyBtn = document.getElementById('perf-console-copy');
  const recordBtn = document.getElementById('perf-console-record');

  if (toggleBtn instanceof HTMLButtonElement) {
    toggleBtn.addEventListener('click', () => {
      const collapsed = panel.getAttribute('data-collapsed') === 'true';
      panel.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
      toggleBtn.textContent = collapsed ? 'Hide' : 'Show';
    });
  }

  if (clearBtn instanceof HTMLButtonElement) {
    clearBtn.addEventListener('click', () => {
      const api = (window as Window & { __evenChessPerf?: { clear: () => void } }).__evenChessPerf;
      if (api) api.clear();
      else clearDomOutput();
    });
  }

  if (copyBtn instanceof HTMLButtonElement) {
    copyBtn.addEventListener('click', () => {
      const api = (window as Window & { __evenChessPerf?: { copyAll: () => Promise<boolean> } }).__evenChessPerf;
      if (api) {
        void api.copyAll();
      }
    });
  }

  if (recordBtn instanceof HTMLButtonElement) {
    recordBtn.addEventListener('click', () => {
      recordingPaused = !recordingPaused;
      updateRecordButtonLabel();
    });
  }
}

function ensureDomInitialized(): void {
  if (domInitialized) return;
  if (!PERF_LOG_DOM_ENABLED) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  domInitialized = true;
  setDomPanelVisibility(true);
  wireDomControls();
  updateRecordButtonLabel();
}

function ensureInitialized(): void {
  ensureDomInitialized();
  if (initialized) return;
  initialized = true;
  if (typeof window === 'undefined') return;

  if (PERF_LOG_CAPTURE_ENABLED) {
    loadEntries();
    if (PERF_LOG_DOM_ENABLED && entries.length > 0) {
      clearDomOutput();
      for (const line of formatDumpLines(entries).split('\n')) {
        if (line) appendDomLine(line);
      }
      flushDomOutput();
    }
  }

  const api = {
    dumpText: (): string => getAllLogText(),
    getEntries: (): PerfLogEntry[] => [...entries],
    clear: (): void => {
      entries = [];
      dirty = true;
      dirtySinceTs = safeNow();
      clearDomOutput();
      if (PERF_LOG_CAPTURE_ENABLED) flushEntriesForced();
      console.log('[PerfLog] Cleared.');
    },
    download: (): void => {
      const text = getAllLogText();
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
    copyAll: async (): Promise<boolean> => {
      const ok = await copyTextToClipboard(getAllLogText());
      console.log(ok ? '[PerfLog] Copied.' : '[PerfLog] Copy failed.');
      return ok;
    },
    toggleRecording: (): void => {
      recordingPaused = !recordingPaused;
      updateRecordButtonLabel();
    },
  };

  (window as Window & { __evenChessPerf?: typeof api }).__evenChessPerf = api;

  if (PERF_LOG_CAPTURE_ENABLED) {
    window.addEventListener('beforeunload', flushEntriesForced);
  }
}

if (PERF_LOG_DOM_ENABLED && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ensureInitialized(), { once: true });
  } else {
    ensureInitialized();
  }
}

export function perfLog(msg: string): void {
  if (!PERF_LOG_ENABLED) return;
  if (recordingPaused) return;

  ensureInitialized();

  if (PERF_LOG_CONSOLE_ENABLED) {
    console.log(msg);
  }

  if (PERF_LOG_DOM_ENABLED) {
    appendDomLine(`${new Date(safeNow()).toISOString()} ${msg}`);
  }

  if (!PERF_LOG_CAPTURE_ENABLED) return;
  if (typeof window === 'undefined') return;

  const nowTs = safeNow();
  entries.push({ ts: nowTs, msg });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  lastEntryTs = nowTs;
  if (!dirty) dirtySinceTs = nowTs;
  dirty = true;
  scheduleFlush();
}

/** Avoids building perf log strings when all perf sinks are disabled. */
export function perfLogLazy(msgFactory: () => string): void {
  if (!PERF_LOG_ENABLED) return;
  perfLog(msgFactory());
}

// Optional call target for callers that want to avoid evaluating log arguments when disabled.
export const perfLogIfEnabled: ((msg: string) => void) | undefined = PERF_LOG_ENABLED ? perfLog : undefined;

// Optional call target for callers that want to avoid allocating lazy lambdas when disabled.
export const perfLogLazyIfEnabled: ((msgFactory: () => string) => void) | undefined = PERF_LOG_ENABLED
  ? perfLogLazy
  : undefined;

export function clearPerfLog(): void {
  ensureInitialized();
  if (PERF_LOG_DOM_ENABLED) {
    clearDomOutput();
  }
  if (!PERF_LOG_CAPTURE_ENABLED) return;
  if (typeof window === 'undefined') return;
  entries = [];
  dirty = true;
  dirtySinceTs = safeNow();
  flushEntriesForced();
}
