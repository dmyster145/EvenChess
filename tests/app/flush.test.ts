/**
 * Tests for flush.ts — the single render function from store state to glasses containers.
 *
 * Strategy: a fake bridge records updateImage/updateText calls; a real Store + ChessService +
 * BoardRenderer are wired in (no mocking) so the test exercises the actual render pipeline. Fake
 * timers let us assert debounce/coalescing behavior precisely.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from '../../src/state/store';
import { buildInitialState } from '../../src/state/contracts';
import { ChessService } from '../../src/chess/chessservice';
import { BoardRenderer } from '../../src/render/boardimage';
import { createFlush } from '../../src/app/flush';
import { CONTAINER_ID_TEXT } from '../../src/render/composer';
import type { EvenHubBridge } from '../../src/evenhub/bridge';

// jsdom-style globals — the BoardRenderer touches `document.createElement('canvas')` for the PNG
// path. In a node-only test environment this returns undefined, which makes renderPngAsync return
// [] — exactly the BMP fallback path. That suffices for these tests; we assert the fallback works.

interface FakeBridge {
  imageCalls: Array<{ id: number; payload: { containerID?: number; imageData?: unknown } }>;
  textCalls: Array<{ id: number; content: string }>;
}

function makeFakeBridge(): EvenHubBridge & FakeBridge {
  const imageCalls: FakeBridge['imageCalls'] = [];
  const textCalls: FakeBridge['textCalls'] = [];
  const fake: Partial<EvenHubBridge> & FakeBridge = {
    kind: 'v2',
    imageCalls,
    textCalls,
    updateImage(id, _name, payload) {
      imageCalls.push({ id, payload });
    },
    updateText(id, _name, content) {
      textCalls.push({ id, content });
      return Promise.resolve(true);
    },
    clearPending() { /* not exercised here */ },
  };
  // Cast — only the methods flush.ts actually calls are needed.
  return fake as unknown as EvenHubBridge & FakeBridge;
}

describe('createFlush', () => {
  let chess: ChessService;
  let renderer: BoardRenderer;
  let bridge: EvenHubBridge & FakeBridge;
  let store: ReturnType<typeof createStore>;
  let wearing: boolean;
  let connected: boolean;
  let imagesActive: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    chess = new ChessService();
    renderer = new BoardRenderer({ largeGrid: false });
    bridge = makeFakeBridge();
    store = createStore(buildInitialState(chess));
    wearing = true;
    connected = true;
    imagesActive = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeFlush(): ReturnType<typeof createFlush> {
    return createFlush({
      bridge,
      store,
      chess,
      getRenderer: () => renderer,
      isWearingGlasses: () => wearing,
      isDeviceConnected: () => connected,
      imageContainersActive: () => imagesActive,
    });
  }

  it('schedule() coalesces multiple calls inside the debounce window into one flush', async () => {
    const flush = makeFlush();
    flush.schedule();
    flush.schedule();
    flush.schedule();
    expect(bridge.textCalls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(20);
    // Exactly one text send (the initial layout).
    expect(bridge.textCalls.length).toBe(1);
  });

  it('flushNow() bypasses the debounce', async () => {
    const flush = makeFlush();
    await flush.flushNow();
    expect(bridge.textCalls.length).toBe(1);
    expect(bridge.textCalls[0]?.id).toBe(CONTAINER_ID_TEXT);
  });

  it('wearing-gate skips when not wearing AND not forced', async () => {
    wearing = false;
    const flush = makeFlush();
    await flush.flushNow();
    expect(bridge.textCalls).toHaveLength(0);
    expect(bridge.imageCalls).toHaveLength(0);
  });

  it('wearing-gate is bypassed when force=true', async () => {
    wearing = false;
    const flush = makeFlush();
    await flush.flushNow({ force: true });
    expect(bridge.textCalls.length).toBe(1);
  });

  it('disconnected gate skips when force=false but bypasses when force=true', async () => {
    connected = false;
    const flush = makeFlush();
    await flush.flushNow();
    expect(bridge.textCalls).toHaveLength(0);
    await flush.flushNow({ force: true });
    expect(bridge.textCalls).toHaveLength(1);
  });

  it('text-only path (boardReady=false) sends text but NOT images', async () => {
    imagesActive = false;
    const flush = makeFlush();
    await flush.flushNow();
    expect(bridge.textCalls).toHaveLength(1);
    expect(bridge.imageCalls).toHaveLength(0);
  });

  it('full-layout path (boardReady=true) sends text + at least one image', async () => {
    imagesActive = true;
    const flush = makeFlush();
    // flush.ts yields with setTimeout(0) before rendering so a queued input can drain. Under fake
    // timers we must advance past that yield to let the render complete.
    const flushPromise = flush.flushNow({ force: true });
    await vi.advanceTimersByTimeAsync(1);
    await flushPromise;
    expect(bridge.textCalls.length).toBeGreaterThanOrEqual(1);
    expect(bridge.imageCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('text dedup is keyed on boardReady — flipping the layout always re-sends text (race #10)', async () => {
    const flush = makeFlush();
    imagesActive = false;
    await flush.flushNow();
    const textOnlyCount = bridge.textCalls.length;
    expect(textOnlyCount).toBe(1);

    // Flip to full layout — text content is identical but the cache key changes, so we expect a re-send.
    imagesActive = true;
    const flushPromise = flush.flushNow();
    await vi.advanceTimersByTimeAsync(1);
    await flushPromise;
    expect(bridge.textCalls.length).toBe(textOnlyCount + 1);
  });

  it('cancel() prevents a pending debounced flush from firing', async () => {
    const flush = makeFlush();
    flush.schedule();
    flush.cancel();
    await vi.advanceTimersByTimeAsync(50);
    expect(bridge.textCalls).toHaveLength(0);
  });

  it('setForceFullRefresh() makes the next scheduled flush bypass the wearing gate', async () => {
    wearing = false;
    const flush = makeFlush();
    flush.setForceFullRefresh();
    await flush.flushNow();
    expect(bridge.textCalls.length).toBe(1);
  });
});
