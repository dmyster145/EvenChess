/**
 * Tests for EvenHubBridge — the latest-wins, per-container serial sender.
 *
 * Strategy: bypass `init()` entirely and inject a fake EvenAppBridge via the test-only attach
 * helper. Each fake exposes call sequencing recorders so tests can assert the order and content
 * of SDK calls without mocking the entire SDK module.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EvenHubBridge } from '../../src/evenhub/bridge';
import {
  ImageRawDataUpdate,
  StartUpPageCreateResult,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';

type ImageCall = { containerID: number | undefined; payload: ImageRawDataUpdate };
type TextCall = { containerID: number | undefined; content: string | undefined };

interface FakeBridge extends EvenAppBridge {
  imageCalls: ImageCall[];
  textCalls: TextCall[];
  storageReads: string[];
  storageWrites: Array<{ key: string; value: string }>;
  storage: Map<string, string>;
  resolveNextImage: () => void;
  rejectNextImage: (err: unknown) => void;
  imageDelayMs: number;
  pendingImageResolvers: Array<() => void>;
  pendingImageRejectors: Array<(err: unknown) => void>;
  shutdownCalls: number[];
  setupCalls: number;
  setupResult: StartUpPageCreateResult;
}

function makeFakeBridge(): FakeBridge {
  const fake = {
    imageCalls: [] as ImageCall[],
    textCalls: [] as TextCall[],
    storageReads: [] as string[],
    storageWrites: [] as Array<{ key: string; value: string }>,
    storage: new Map<string, string>(),
    pendingImageResolvers: [] as Array<() => void>,
    pendingImageRejectors: [] as Array<(err: unknown) => void>,
    imageDelayMs: 0,
    shutdownCalls: [] as number[],
    setupCalls: 0,
    setupResult: StartUpPageCreateResult.success,

    resolveNextImage(): void {
      const r = fake.pendingImageResolvers.shift();
      if (r) r();
    },
    rejectNextImage(err: unknown): void {
      const r = fake.pendingImageRejectors.shift();
      if (r) r(err);
    },
  } as FakeBridge;

  // Cast shape — we only stub the methods the bridge actually invokes.
  fake.updateImageRawData = vi.fn(async (data: ImageRawDataUpdate) => {
    fake.imageCalls.push({ containerID: data.containerID, payload: data });
    if (fake.imageDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, fake.imageDelayMs));
    } else {
      // Tests that want to control timing push to the queues and call resolveNextImage.
      await new Promise<void>((resolve, reject) => {
        fake.pendingImageResolvers.push(resolve);
        fake.pendingImageRejectors.push(reject);
      });
    }
    return 'success' as never;
  }) as never;

  fake.textContainerUpgrade = vi.fn(async (data: { containerID?: number; content?: string }) => {
    fake.textCalls.push({ containerID: data.containerID, content: data.content });
    return true;
  }) as never;

  fake.getLocalStorage = vi.fn(async (key: string) => {
    fake.storageReads.push(key);
    return fake.storage.get(key) ?? '';
  }) as never;

  fake.setLocalStorage = vi.fn(async (key: string, value: string) => {
    fake.storageWrites.push({ key, value });
    fake.storage.set(key, value);
    return true;
  }) as never;

  fake.shutDownPageContainer = vi.fn(async (mode?: number) => {
    fake.shutdownCalls.push(mode ?? 0);
    return true;
  }) as never;

  fake.createStartUpPageContainer = vi.fn(async () => {
    fake.setupCalls += 1;
    return fake.setupResult;
  }) as never;

  fake.rebuildPageContainer = vi.fn(async () => true) as never;

  fake.onEvenHubEvent = vi.fn(() => () => {}) as never;
  fake.onDeviceStatusChanged = vi.fn(() => () => {}) as never;
  fake.onLaunchSource = vi.fn(() => () => {}) as never;
  fake.getDeviceInfo = vi.fn(async () => null) as never;

  return fake;
}

/** Attaches a fake bridge without going through `init()`/`waitForEvenAppBridge`. */
function attach(bridge: EvenHubBridge, fake: FakeBridge): void {
  // Reach through the private field. The alternative — mocking the SDK module's
  // `waitForEvenAppBridge` — pollutes the module graph for the rest of the test file.
  (bridge as unknown as { bridge: EvenAppBridge }).bridge = fake;
}

function flushMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function makeImagePayload(containerID: number, marker: string): ImageRawDataUpdate {
  return new ImageRawDataUpdate({
    containerID,
    containerName: `c${containerID}`,
    imageData: marker,
  });
}

/**
 * Map-backed localStorage polyfill — vitest's default node environment doesn't provide one, and
 * the bridge's storage path uses it as the durable layer.
 */
function installLocalStoragePolyfill(): void {
  const store = new Map<string, string>();
  const polyfill = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as unknown as { localStorage: typeof polyfill }).localStorage = polyfill;
}

installLocalStoragePolyfill();

describe('EvenHubBridge', () => {
  let bridge: EvenHubBridge;
  let fake: FakeBridge;

  beforeEach(() => {
    bridge = new EvenHubBridge();
    fake = makeFakeBridge();
    attach(bridge, fake);
    // Ensure localStorage doesn't leak across tests.
    localStorage.clear();
  });

  it('latest-wins per container: rapid updates to the same container collapse', async () => {
    bridge.updateImage(2, 'top', makeImagePayload(2, 'A'));
    bridge.updateImage(2, 'top', makeImagePayload(2, 'B'));
    bridge.updateImage(2, 'top', makeImagePayload(2, 'C'));

    // The sender starts after the first updateImage and immediately picks up the entry, which by
    // then has been overwritten to 'C' (the synchronous calls all run before the async sender awaits).
    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(1);
    expect(fake.imageCalls[0]?.payload.imageData).toBe('C');

    // Resolve the in-flight call; nothing more should fire.
    fake.resolveNextImage();
    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(1);
  });

  it('independent containers coalesce independently and both deliver', async () => {
    bridge.updateImage(2, 'top', makeImagePayload(2, 'A'));
    bridge.updateImage(3, 'bot', makeImagePayload(3, 'X'));
    bridge.updateImage(2, 'top', makeImagePayload(2, 'B'));
    bridge.updateImage(3, 'bot', makeImagePayload(3, 'Y'));

    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(1);
    // Insertion order: TOP slot was inserted first, so it sends first.
    expect(fake.imageCalls[0]?.containerID).toBe(2);
    expect(fake.imageCalls[0]?.payload.imageData).toBe('B');

    fake.resolveNextImage();
    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(2);
    expect(fake.imageCalls[1]?.containerID).toBe(3);
    expect(fake.imageCalls[1]?.payload.imageData).toBe('Y');

    fake.resolveNextImage();
    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(2);
  });

  it('image sends are serialized — second call waits for first to resolve', async () => {
    bridge.updateImage(2, 'top', makeImagePayload(2, 'A'));
    bridge.updateImage(3, 'bot', makeImagePayload(3, 'X'));

    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(1);

    // Even after additional ticks, the second send doesn't start until we resolve the first.
    await flushMicrotasks();
    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(1);

    fake.resolveNextImage();
    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(2);
  });

  it('clearPending drops all queued slots; later updates resume normally', async () => {
    bridge.updateImage(2, 'top', makeImagePayload(2, 'A'));
    bridge.updateImage(3, 'bot', makeImagePayload(3, 'X'));
    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(1); // first one in flight

    bridge.clearPending();
    fake.resolveNextImage();
    await flushMicrotasks();
    // Second slot was cleared before it could send.
    expect(fake.imageCalls).toHaveLength(1);

    bridge.updateImage(2, 'top', makeImagePayload(2, 'NEW'));
    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(2);
    expect(fake.imageCalls[1]?.payload.imageData).toBe('NEW');
  });

  it('sender restarts after drain when a new payload arrives later', async () => {
    bridge.updateImage(2, 'top', makeImagePayload(2, 'A'));
    await flushMicrotasks();
    fake.resolveNextImage();
    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(1);

    bridge.updateImage(2, 'top', makeImagePayload(2, 'B'));
    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(2);
    fake.resolveNextImage();
    await flushMicrotasks();
  });

  it('text and image SDK calls are serialized — text waits for in-flight image', async () => {
    // Per ER guidance ("Serialize all bridge calls, not just images"), the bleChain serializes
    // text and image SDK calls against each other. A text update enqueued while an image is
    // in-flight waits for the image to complete before the text SDK call fires.
    bridge.updateImage(2, 'top', makeImagePayload(2, 'A'));
    bridge.updateText(1, 'hud', 'hello');

    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(1);
    expect(fake.textCalls).toHaveLength(0);

    fake.resolveNextImage();
    await flushMicrotasks();
    expect(fake.textCalls).toHaveLength(1);
    expect(fake.textCalls[0]?.content).toBe('hello');
  });

  it('a failed image send does not wedge subsequent sends', async () => {
    bridge.updateImage(2, 'top', makeImagePayload(2, 'A'));
    await flushMicrotasks();
    fake.rejectNextImage(new Error('BLE error'));
    await flushMicrotasks();

    bridge.updateImage(2, 'top', makeImagePayload(2, 'B'));
    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(2);
    expect(fake.imageCalls[1]?.payload.imageData).toBe('B');
    fake.resolveNextImage();
  });

  it('storageSet writes localStorage synchronously and the SDK best-effort', async () => {
    await bridge.storageSet('foo', 'bar');
    expect(localStorage.getItem('foo')).toBe('bar');
    expect(fake.storageWrites).toEqual([{ key: 'foo', value: 'bar' }]);
  });

  it('storageGet prefers localStorage when present, falls back to SDK', async () => {
    localStorage.setItem('local-only', 'local-value');
    fake.storage.set('sdk-only', 'sdk-value');

    expect(await bridge.storageGet('local-only')).toBe('local-value');
    expect(fake.storageReads).not.toContain('local-only');

    expect(await bridge.storageGet('sdk-only')).toBe('sdk-value');
    expect(fake.storageReads).toContain('sdk-only');

    expect(await bridge.storageGet('missing')).toBeNull();
  });

  it('shutdown clears pending sends and calls shutDownPageContainer(0)', async () => {
    bridge.updateImage(2, 'top', makeImagePayload(2, 'A'));
    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(1);

    const shutdownPromise = bridge.shutdown();
    fake.resolveNextImage();
    await shutdownPromise;

    expect(fake.shutdownCalls).toEqual([0]);
    // After shutdown, further updates do not enqueue (pending was cleared) but the next update
    // still attempts to send because the bridge ref is still attached. The lifecycle is expected
    // to detach/replace the bridge after shutdown — we just verify shutDownPageContainer fired.
  });

  it('setupPage is one-shot: second call returns false and does not call the SDK again', async () => {
    const container = { containerTotalNum: 1 } as never;
    const first = await bridge.setupPage(container);
    expect(first).toBe(true);
    expect(fake.setupCalls).toBe(1);

    const second = await bridge.setupPage(container);
    expect(second).toBe(false);
    expect(fake.setupCalls).toBe(1);
  });

  it('a hung image send is abandoned after the timeout and the next pending image proceeds', async () => {
    vi.useFakeTimers();
    try {
      bridge.updateImage(2, 'top', makeImagePayload(2, 'A'));
      bridge.updateImage(3, 'bot', makeImagePayload(3, 'B'));

      // Drain the initial microtask yield in runImageSender.
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.imageCalls).toHaveLength(1);
      expect(fake.imageCalls[0]?.containerID).toBe(2);

      // Don't resolve A. Advance timers past the 4s timeout. The sender abandons A and
      // continues to B.
      await vi.advanceTimersByTimeAsync(5000);
      expect(fake.imageCalls).toHaveLength(2);
      expect(fake.imageCalls[1]?.containerID).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fires onPersistentImageFailure after 3 consecutive non-success results', async () => {
    // Make the fake SDK return a non-success result for every send.
    (fake.updateImageRawData as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return 'sendFailed' as never;
    });

    const failures: number[] = [];
    bridge.onPersistentImageFailure((count) => {
      failures.push(count);
    });

    // Three sends, all fail → callback fires once (after the third).
    bridge.updateImage(2, 'top', makeImagePayload(2, 'A'));
    await flushMicrotasks();
    bridge.updateImage(2, 'top', makeImagePayload(2, 'B'));
    await flushMicrotasks();
    bridge.updateImage(2, 'top', makeImagePayload(2, 'C'));
    await flushMicrotasks();

    expect(failures.length).toBeGreaterThanOrEqual(1);
    expect(failures[0]).toBeGreaterThanOrEqual(3);
  });

  it('a successful send resets the consecutive-failure counter', async () => {
    // Two failures, then a success, then two more failures → callback should NOT fire (counter reset).
    let nextResult: string = 'sendFailed';
    (fake.updateImageRawData as ReturnType<typeof vi.fn>).mockImplementation(async () => nextResult as never);

    const failures: number[] = [];
    bridge.onPersistentImageFailure((count) => failures.push(count));

    bridge.updateImage(2, 'top', makeImagePayload(2, 'A'));
    await flushMicrotasks();
    bridge.updateImage(2, 'top', makeImagePayload(2, 'B'));
    await flushMicrotasks();
    nextResult = 'success';
    bridge.updateImage(2, 'top', makeImagePayload(2, 'C'));
    await flushMicrotasks();
    nextResult = 'sendFailed';
    bridge.updateImage(2, 'top', makeImagePayload(2, 'D'));
    await flushMicrotasks();
    bridge.updateImage(2, 'top', makeImagePayload(2, 'E'));
    await flushMicrotasks();

    expect(failures).toHaveLength(0);
  });

  it('forceResetImageTransport invalidates a stuck sender so a fresh runner can start', async () => {
    bridge.updateImage(2, 'top', makeImagePayload(2, 'STUCK'));
    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(1);

    // Don't resolve the in-flight send. Force-reset the bridge — the prior sender's
    // `await updateImageRawData` is still pending but is now invalidated by the bumped
    // runner sequence. A new updateImage starts a fresh sender.
    bridge.forceResetImageTransport('test');
    bridge.updateImage(2, 'top', makeImagePayload(2, 'FRESH'));
    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(2);
    expect(fake.imageCalls[1]?.payload.imageData).toBe('FRESH');

    // Resolve the abandoned in-flight call; it shouldn't trigger any further activity (the
    // superseded runner returns early instead of looping).
    fake.resolveNextImage();
    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(2);
    fake.resolveNextImage(); // settle the FRESH send
  });

  it('updatePage waits for the image sender to drain before issuing rebuildPageContainer', async () => {
    bridge.updateImage(2, 'top', makeImagePayload(2, 'A'));
    await flushMicrotasks();
    expect(fake.imageCalls).toHaveLength(1);
    expect((fake.rebuildPageContainer as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);

    const updatePromise = bridge.updatePage({ containerTotalNum: 1 } as never);
    // Rebuild is gated; resolve the in-flight image so the gate releases.
    await flushMicrotasks();
    expect((fake.rebuildPageContainer as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);

    fake.resolveNextImage();
    await updatePromise;
    expect((fake.rebuildPageContainer as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});
