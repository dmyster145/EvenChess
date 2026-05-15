/**
 * bridge-reinit.ts — manual bridge reinit, exposed for the debug menu only.
 *
 * Replaces the v1 `attemptBridgeReinit`/`fireEarlyShutdown`/`pageReloadCount`/`inSlowRetryMode`
 * machinery with a simple sequence: shutdown → settle → init → setupPage → resubscribe → flush.
 * No automatic reinit on heuristic — the user (or a future explicit "tap to reset" affordance)
 * triggers this. Most v1 reinit fires came from misdiagnosed iOS lock/unlock cycles, not from
 * actual BLE wedges; eliminating them removes the failure mode where a normal phone lock killed
 * the app.
 */

import type { Store } from '../state/store';
import type { EvenHubBridge } from '../evenhub/bridge';
import type { FlushController } from './flush';
import type { BrandingController } from './branding';
import type { LifecycleController, DeviceStatusUpdate } from './lifecycle';
import { composePageForState, composeStartupPage, composeTextOnlyStartupPage } from '../render/composer';
import type { EvenHubEvent } from '@evenrealities/even_hub_sdk';

const SHUTDOWN_SETTLE_MS = 1500;

export interface ReinitDeps {
  bridge: EvenHubBridge;
  store: Store;
  flush: FlushController;
  branding: BrandingController;
  lifecycle: LifecycleController;
  imageContainersActive: () => boolean;
  setImageContainersActive: (active: boolean) => void;
  /** Pulled in so reinit can re-subscribe events after the new bridge is up. */
  hubEventHandler: (event: EvenHubEvent) => void;
  deviceStatusHandler: (status: DeviceStatusUpdate) => void;
  /** Track the last device-status unsubscribe so reinit replaces it without leaking. */
  setDeviceStatusUnsubscribe: (fn: (() => void) | null) => void;
  setLaunchSourceUnsubscribe: (fn: (() => void) | null) => void;
}

export interface ReinitController {
  reinit(reason: string): Promise<void>;
}

export function createReinit(deps: ReinitDeps): ReinitController {
  let inProgress = false;

  async function reinit(reason: string): Promise<void> {
    if (inProgress) return;
    inProgress = true;
    console.log(`[bridge-reinit] starting (${reason})`);
    try {
      deps.flush.cancel();
      deps.branding.cancel();

      try {
        await deps.bridge.shutdown();
      } catch (err) {
        console.error('[bridge-reinit] shutdown error', err);
      }

      await new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_SETTLE_MS));
      await deps.bridge.init();

      // Resubscribe — old subscriptions are gone after shutdown.
      deps.bridge.subscribeEvents(deps.hubEventHandler);

      const newDeviceStatus = deps.bridge.subscribeDeviceStatus(deps.deviceStatusHandler);
      deps.setDeviceStatusUnsubscribe(newDeviceStatus);

      const newLaunchSource = deps.bridge.subscribeLaunchSource(() => {
        // Launch source after reinit is informational only.
      });
      deps.setLaunchSourceUnsubscribe(newLaunchSource);

      const startupPage = deps.imageContainersActive()
        ? composeStartupPage(deps.store.getState())
        : composeTextOnlyStartupPage(deps.store.getState());
      const ok = await deps.bridge.setupPage(startupPage);
      if (!ok) {
        // setupPage is one-shot per bridge instance; if the new bridge already had setupPage
        // called, fall back to rebuildPageContainer.
        await deps.bridge.updatePage(composePageForState(deps.store.getState()));
      }

      deps.flush.setForceFullRefresh();
      deps.branding.forceNextRefresh();
      await deps.flush.flushNow({ force: true });
      deps.branding.syncNow();
      console.log(`[bridge-reinit] done (${reason})`);
    } catch (err) {
      console.error('[bridge-reinit] failed', err);
    } finally {
      inProgress = false;
    }
  }

  return { reinit };
}
