/**
 * In-app debug log. Keeps the last MAX_ENTRIES entries in memory, mirrors the most recent ones into
 * the page's #debug-log-output element (batched), and exposes copy/clear for the page's debug
 * buttons via window.__evenChessDebugLog. Nothing leaves the device.
 */

const MAX_ENTRIES = 800;
const DEBUG_LOG_DOM_ENABLED = true;
const DEBUG_LOG_DOM_FLUSH_MS = 50;

interface DebugEntry {
  ts: number;
  msg: string;
  data: Record<string, unknown>;
  /** Short subsystem tag shown in brackets, e.g. 'LCY' for lifecycle. */
  tag?: string;
}

let entries: DebugEntry[] = [];
let pendingDomFlush: ReturnType<typeof setTimeout> | null = null;

function ensureEl(): HTMLPreElement | null {
  if (!DEBUG_LOG_DOM_ENABLED) return null;
  if (typeof document === 'undefined') return null;
  const el = document.getElementById('debug-log-output') as HTMLPreElement | null;
  return el;
}

function formatEntry(e: DebugEntry): string {
  const d = Object.keys(e.data).length ? ` ${JSON.stringify(e.data)}` : '';
  const h = e.tag ? ` [${e.tag}]` : '';
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

export function debugLog(
  msg: string,
  data: Record<string, unknown> = {},
  tag?: string,
): void {
  const entry: DebugEntry = { ts: Date.now(), msg, data, tag };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  scheduleDomFlush();
}

export function getDebugLogText(): string {
  return entries.map(formatEntry).join('\n');
}

export function copyDebugLog(): boolean {
  const text = getDebugLogText();
  if (!text) return false;
  // navigator.clipboard.writeText requires a secure context AND a fresh user-gesture permission
  // grant. On iOS WKWebView hosting an Even Hub plugin neither is reliably available — the API
  // exists but writeText() rejects silently (or the Promise never resolves), so the deprecated
  // execCommand('copy') path is the durable fallback. Try the modern API first, fall through
  // synchronously if it isn't usable.
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      const writePromise = navigator.clipboard.writeText(text);
      // Attach a catch handler so a rejection doesn't bubble to an unhandled rejection. If the
      // modern API fails, the fallback below has already run synchronously above.
      Promise.resolve(writePromise).catch(() => {});
    } catch {
      // fall through to execCommand
    }
  }
  return fallbackExecCommandCopy(text);
}

function fallbackExecCommandCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = document.createElement('textarea');
    textarea.value = text;
    // Position off-screen but keep it in the layout tree; some browsers refuse to copy from
    // display:none / visibility:hidden elements.
    textarea.style.position = 'fixed';
    textarea.style.left = '0';
    textarea.style.top = '0';
    textarea.style.opacity = '0';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    if (textarea && textarea.parentNode) textarea.parentNode.removeChild(textarea);
  }
}

export function clearDebugLog(): void {
  entries = [];
  if (pendingDomFlush) {
    clearTimeout(pendingDomFlush);
    pendingDomFlush = null;
  }
  flushToDom();
}

/** Marks app start in the log, so a copied log shows where this run began. */
export function markRunStart(): void {
  debugLog('App started');
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
