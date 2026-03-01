/**
 * Debug logger for slowdown investigation.
 * Buffers entries in memory, batches DOM updates for copy-on-glasses, and supports optional ingest POSTs.
 */

const MAX_ENTRIES = 800;
const SESSION_ID = '6c20bb';
const INGEST_URL = 'http://127.0.0.1:7245/ingest/1dbbbb74-93c2-4c2d-8e81-7109ba1b91d6';
const DEBUG_LOG_DOM_ENABLED = true;
const DEBUG_LOG_INGEST_ENABLED = false; // Opt-in only; never send network traffic by default.
const DEBUG_LOG_DOM_FLUSH_MS = 50;

interface DebugEntry {
  ts: number;
  msg: string;
  data: Record<string, unknown>;
  hypothesisId?: string;
}

let entries: DebugEntry[] = [];
let runStartTs = Date.now();
let pendingDomFlush: ReturnType<typeof setTimeout> | null = null;

function ensureEl(): HTMLPreElement | null {
  if (!DEBUG_LOG_DOM_ENABLED) return null;
  if (typeof document === 'undefined') return null;
  const el = document.getElementById('debug-log-output') as HTMLPreElement | null;
  return el;
}

function formatEntry(e: DebugEntry): string {
  const d = Object.keys(e.data).length ? ` ${JSON.stringify(e.data)}` : '';
  const h = e.hypothesisId ? ` [${e.hypothesisId}]` : '';
  return `${new Date(e.ts).toISOString()}${h} ${e.msg}${d}`;
}

function flushToDom(): void {
  pendingDomFlush = null;
  const el = ensureEl();
  if (!el) return;
  const lines = entries.slice(-200).map(formatEntry);
  el.textContent = lines.join('\n');
}

function scheduleDomFlush(): void {
  if (!DEBUG_LOG_DOM_ENABLED) return;
  if (pendingDomFlush) return;
  pendingDomFlush = setTimeout(flushToDom, DEBUG_LOG_DOM_FLUSH_MS);
}

function sendToIngest(entry: DebugEntry): void {
  if (!DEBUG_LOG_INGEST_ENABLED) return;
  try {
    fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': SESSION_ID },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        runId: runStartTs,
        hypothesisId: entry.hypothesisId ?? null,
        location: 'debug-logger',
        message: entry.msg,
        data: entry.data,
        timestamp: entry.ts,
      }),
    }).catch(() => {});
  } catch {
    // ignore
  }
}

export function debugLog(
  msg: string,
  data: Record<string, unknown> = {},
  hypothesisId?: string,
): void {
  const entry: DebugEntry = { ts: Date.now(), msg, data, hypothesisId };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  scheduleDomFlush();
  sendToIngest(entry);
}

export function getDebugLogText(): string {
  return entries.map(formatEntry).join('\n');
}

export function copyDebugLog(): boolean {
  const text = getDebugLogText();
  if (!text) return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

export function clearDebugLog(): void {
  entries = [];
  runStartTs = Date.now();
  if (pendingDomFlush) {
    clearTimeout(pendingDomFlush);
    pendingDomFlush = null;
  }
  flushToDom();
}

export function markRunStart(): void {
  runStartTs = Date.now();
  debugLog('Run started (play until slowdown, then copy logs)', { runId: runStartTs });
}

// Expose for index.html Copy button
// (UI hook is harmless when the page does not render debug controls.)
declare global {
  interface Window {
    __evenChessDebugLog?: {
      getText: () => string;
      copy: () => boolean;
      clear: () => void;
    };
  }
}

export function attachDebugCopyApi(): void {
  if (typeof window === 'undefined') return;
  window.__evenChessDebugLog = {
    getText: getDebugLogText,
    copy: copyDebugLog,
    clear: clearDebugLog,
  };
}
