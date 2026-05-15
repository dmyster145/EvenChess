/**
 * branding.ts — owns the brand image (top of display) and its sync to game state.
 *
 * Replaces the v1 `pendingBrandingMode`/`lastQueuedBrandingMode`/`forceNextBrandingRefresh`/
 * `trySyncBrandingMode` machinery. The latest-wins bridge handles ordering and coalescing — this
 * module just decides which branding image (normal/check/checkmate) reflects the current state
 * and submits it. No fire-and-forget races with the board; both go through the same per-container
 * latest-wins slot.
 */

import type { Store } from '../state/store';
import type { GameState } from '../state/contracts';
import type { EvenHubBridge } from '../evenhub/bridge';
import { renderBrandingImage, renderCheckBrandingImage, renderCheckmateBrandingImage } from '../render/branding';
import { CONTAINER_ID_BRAND, CONTAINER_NAME_BRAND } from '../render/composer';

export type BrandingMode = 'normal' | 'check' | 'checkmate';

const SCHEDULE_DEBOUNCE_MS = 50;

export interface BrandingDeps {
  bridge: EvenHubBridge;
  store: Store;
  imageContainersActive: () => boolean;
}

export interface BrandingController {
  /** Schedule a debounced sync. Idempotent. */
  schedule(): void;
  /** Sync immediately without waiting for debounce. Used on layout upgrade and reinit. */
  syncNow(): void;
  /** Force the next sync to send even if the desired mode matches the cache. Used after layout change. */
  forceNextRefresh(): void;
  /** Cancel any pending sync. Used at shutdown. */
  cancel(): void;
}

export function createBranding(deps: BrandingDeps): BrandingController {
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSentMode: BrandingMode | null = null;
  let force = false;

  function schedule(): void {
    if (pendingTimer !== null) return;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      sync();
    }, SCHEDULE_DEBOUNCE_MS);
  }

  function syncNow(): void {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    sync();
  }

  function forceNextRefresh(): void {
    force = true;
  }

  function cancel(): void {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  function sync(): void {
    if (!deps.imageContainersActive()) return;
    const desired = desiredBrandingMode(deps.store.getState());
    const shouldSend = force || desired !== lastSentMode;
    force = false;
    if (!shouldSend) return;
    lastSentMode = desired;
    deps.bridge.updateImage(CONTAINER_ID_BRAND, CONTAINER_NAME_BRAND, renderBrandingPayload(desired));
  }

  return { schedule, syncNow, forceNextRefresh, cancel };
}

function desiredBrandingMode(state: GameState): BrandingMode {
  if (state.gameOver?.toLowerCase() === 'checkmate') return 'checkmate';
  if (state.inCheck) return 'check';
  return 'normal';
}

function renderBrandingPayload(mode: BrandingMode) {
  switch (mode) {
    case 'checkmate':
      return renderCheckmateBrandingImage();
    case 'check':
      return renderCheckBrandingImage();
    default:
      return renderBrandingImage();
  }
}
