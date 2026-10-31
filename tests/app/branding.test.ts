import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from '../../src/state/store';
import { buildInitialState } from '../../src/state/contracts';
import { ChessService } from '../../src/chess/chessservice';
import { createBranding } from '../../src/app/branding';
import { CONTAINER_ID_BRAND } from '../../src/render/composer';
import {
  renderBlankBrandingImage,
  renderCapturedBrandingImage,
  renderCheckBrandingImage,
  renderCheckmateBrandingImage,
} from '../../src/render/branding';
import { getCapturedCounts } from '../../src/state/selectors';
import type { EvenHubBridge } from '../../src/evenhub/bridge';

interface FakeBridge {
  brandSends: Array<unknown>;
}

function makeFakeBridge(): EvenHubBridge & FakeBridge {
  const brandSends: Array<unknown> = [];
  const fake: Partial<EvenHubBridge> & FakeBridge = {
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

  it('sends the blank strip when nothing has been captured', () => {
    makeBranding().syncNow();
    expect(bridge.brandSends).toEqual([renderBlankBrandingImage()]);
  });

  it('sends the CHECK! banner while in check', () => {
    store = createStore({ ...buildInitialState(chess), inCheck: true });
    makeBranding().syncNow();
    expect(bridge.brandSends).toEqual([renderCheckBrandingImage()]);
  });

  it('sends the CHECKMATE! banner once the game ends in checkmate (even though inCheck is set too)', () => {
    store = createStore({ ...buildInitialState(chess), inCheck: true, gameOver: 'checkmate' });
    makeBranding().syncNow();
    expect(bridge.brandSends).toEqual([renderCheckmateBrandingImage()]);
  });

  it('goes normal → check → normal, sending the banner and then the strip again', () => {
    const branding = makeBranding();
    branding.syncNow();
    store.dispatch({ type: 'REFRESH', ...chess.getStateSnapshot(), inCheck: true });
    branding.syncNow();
    store.dispatch({ type: 'REFRESH', ...chess.getStateSnapshot(), inCheck: false });
    branding.syncNow();
    expect(bridge.brandSends).toEqual([renderBlankBrandingImage(), renderCheckBrandingImage(), renderBlankBrandingImage()]);
  });

  it('a capture re-sends the strip with the captured piece drawn', () => {
    const branding = makeBranding();
    branding.syncNow();
    for (const [from, to] of [['e2', 'e4'], ['d7', 'd5'], ['e4', 'd5']] as const) chess.makeMove(from, to);
    store.dispatch({ type: 'REFRESH', ...chess.getStateSnapshot() });
    branding.syncNow();
    // White has taken one black pawn. The signature argument only keys the cache.
    const { white, black } = getCapturedCounts(store.getState());
    expect(black).toEqual({ q: 0, r: 0, b: 0, n: 0, p: 1 });
    expect(bridge.brandSends).toEqual([renderBlankBrandingImage(), renderCapturedBrandingImage(black, white, 'expected')]);
  });

  it('cancel() prevents a pending debounced sync from firing', async () => {
    const branding = makeBranding();
    branding.schedule();
    branding.cancel();
    await vi.advanceTimersByTimeAsync(60);
    expect(bridge.brandSends).toHaveLength(0);
  });
});
