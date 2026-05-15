import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from '../../src/state/store';
import { buildInitialState } from '../../src/state/contracts';
import { ChessService } from '../../src/chess/chessservice';
import { createBranding } from '../../src/app/branding';
import { CONTAINER_ID_BRAND } from '../../src/render/composer';
import type { EvenHubBridge } from '../../src/evenhub/bridge';

interface FakeBridge {
  brandSends: Array<unknown>;
}

function makeFakeBridge(): EvenHubBridge & FakeBridge {
  const brandSends: Array<unknown> = [];
  const fake: Partial<EvenHubBridge> & FakeBridge = {
    kind: 'v2',
    brandSends,
    updateImage(id, _name, payload) {
      if (id === CONTAINER_ID_BRAND) brandSends.push(payload);
    },
  };
  return fake as unknown as EvenHubBridge & FakeBridge;
}

describe('createBranding', () => {
  let chess: ChessService;
  let bridge: EvenHubBridge & FakeBridge;
  let store: ReturnType<typeof createStore>;
  let imagesActive: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    chess = new ChessService();
    bridge = makeFakeBridge();
    store = createStore(buildInitialState(chess));
    imagesActive = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeBranding(): ReturnType<typeof createBranding> {
    return createBranding({ bridge, store, imageContainersActive: () => imagesActive });
  }

  it('schedule() coalesces multiple calls inside the debounce window into one send', async () => {
    const branding = makeBranding();
    branding.schedule();
    branding.schedule();
    branding.schedule();
    await vi.advanceTimersByTimeAsync(60);
    expect(bridge.brandSends).toHaveLength(1);
  });

  it('does not send when imageContainersActive is false', async () => {
    imagesActive = false;
    const branding = makeBranding();
    branding.schedule();
    await vi.advanceTimersByTimeAsync(60);
    expect(bridge.brandSends).toHaveLength(0);
  });

  it('no-op on second sync when mode unchanged', async () => {
    const branding = makeBranding();
    branding.syncNow();
    branding.syncNow();
    expect(bridge.brandSends).toHaveLength(1);
  });

  it('forceNextRefresh() forces a re-send even when mode unchanged', () => {
    const branding = makeBranding();
    branding.syncNow();
    expect(bridge.brandSends).toHaveLength(1);
    branding.forceNextRefresh();
    branding.syncNow();
    expect(bridge.brandSends).toHaveLength(2);
  });

  it('cancel() prevents a pending debounced sync from firing', async () => {
    const branding = makeBranding();
    branding.schedule();
    branding.cancel();
    await vi.advanceTimersByTimeAsync(60);
    expect(bridge.brandSends).toHaveLength(0);
  });
});
