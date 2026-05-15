/**
 * EvenHubBridge — minimal, latest-wins per-container serial sender.
 *
 * Public surface:
 *   - init() / setupPage() / updatePage()
 *   - updateImage(id, name, payload) and updateText(id, name, content) — fire-and-forget,
 *     latest-wins per container; the bridge collapses fast updates to the freshest payload
 *   - clearPending() — drop every pending slot (e.g. on visibility-hide before the WebView pauses)
 *   - subscribeEvents/subscribeDeviceStatus/subscribeLaunchSource — SDK passthroughs
 *   - storageGet/storageSet/rawSdkGet — dual-write (localStorage authoritative, SDK best-effort)
 *   - requestSystemExit() — surface the system "End this feature?" dialog
 *   - shutdown() — graceful teardown
 *   - forceResetImageTransport(reason) — hard reset for the image sender (used by recovery code)
 *   - onPersistentImageFailure(handler) — callback fired after consecutive non-success results so
 *     the app can attempt recovery
 *
 * Design notes:
 *   - One serial sender loop per "kind" (image, text). Each loop drains its pending Map.
 *   - All SDK calls — image, text, page rebuild, storage, device-info, shutdown — are serialized
 *     through a single Promise chain (`bleChain`). Per ER glasses-ui guidance: "Serialize all
 *     bridge calls, not just images — concurrent render + storage calls can crash the connection."
 *   - Each serialized call is wrapped in Promise.race against a per-call timeout so a hung BLE hop
 *     can't permanently wedge the chain. Per ER guidance: "Add a per-call timeout to BLE calls."
 *   - Non-success result enums (sendFailed, etc.) are detected explicitly via
 *     `ImageRawDataUpdateResult.isSuccess` and counted toward the persistent-failure threshold.
 */

import {
  waitForEvenAppBridge,
  TextContainerUpgrade,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  type EvenAppBridge as EvenAppBridgeType,
  type CreateStartUpPageContainer,
  type RebuildPageContainer,
  type EvenHubEvent,
  type DeviceStatus,
  type DeviceInfo,
  type LaunchSource,
  StartUpPageCreateResult,
} from '@evenrealities/even_hub_sdk';
import { debugLog } from '../debug/logger';

const SHUTDOWN_HARD_CAP_MS = 4000;

/**
 * Per-image-send timeout. Above typical G2 latency (~0.7–3s on a slow link) and well below user
 * patience for a frozen display. The original SDK Promise is left to settle naturally; if it
 * eventually completes after we've moved on, the result is ignored.
 */
const IMAGE_SEND_TIMEOUT_MS = 4000;

/**
 * Consecutive non-success image send results before firing onPersistentImageFailure. 3 absorbs
 * a transient blip but escalates quickly when the SDK transport is genuinely wedged.
 */
const IMAGE_PERSISTENT_FAILURE_THRESHOLD = 3;

/** Cooldown between consecutive `onPersistentImageFailure` invocations to avoid recovery loops. */
const IMAGE_PERSISTENT_FAILURE_COOLDOWN_MS = 5000;

const BLE_STORAGE_TIMEOUT_MS = 4000;
const BLE_PAGE_TIMEOUT_MS = 6000;
const BLE_DEVICE_INFO_TIMEOUT_MS = 4000;
const BLE_TEXT_TIMEOUT_MS = 4000;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

interface PendingImage {
  name: string;
  payload: ImageRawDataUpdate;
}

interface PendingText {
  name: string;
  content: string;
}

export class EvenHubBridge {
  private bridge: EvenAppBridgeType | null = null;
  private startupCalled = false;

  private pendingImageByContainer = new Map<number, PendingImage>();
  private pendingTextByContainer = new Map<number, PendingText>();
  private imageSenderRunning = false;
  private textSenderRunning = false;
  private cleared = false;

  // Image-sender runner sequence number. Each runImageSender invocation captures the current seq;
  // if forceResetImageTransport bumps the active seq mid-loop, the in-flight runner returns
  // without acting on its (possibly hung) SDK await result. Lets a stuck sender be replaced.
  private imageSenderRunnerSeq = 0;
  private activeImageSenderRunnerSeq = 0;

  // Consecutive non-success result counter. The persistent-failure callback fires when this
  // crosses IMAGE_PERSISTENT_FAILURE_THRESHOLD. The "last fired" marker uses null (never fired)
  // rather than 0 — otherwise the cooldown check vs nowMs() (which starts in the hundreds of ms
  // in a fresh page context) blocks the very first invocation.
  private consecutiveImageSendFailures = 0;
  private lastPersistentFailureFiredAtMs: number | null = null;
  private onPersistentImageFailureCallback: ((failureCount: number) => void) | null = null;

  // Single Promise chain that serializes EVERY SDK call. Per ER guidance, concurrent SDK calls
  // can crash the BLE link; this guarantees the SDK never sees overlapping calls regardless of
  // which sender (image, text, page, storage) issued them.
  private bleChain: Promise<unknown> = Promise.resolve();

  private unsubscribeEvents: (() => void) | null = null;

  async init(): Promise<void> {
    try {
      this.bridge = await waitForEvenAppBridge();
      console.log('[EvenHubBridge] Bridge ready.');
    } catch (err) {
      console.warn('[EvenHubBridge] Bridge init failed (running outside Even Hub?):', err);
      this.bridge = null;
    }
  }

  /**
   * Serialize an SDK call through the single bleChain. fn runs after any previous chained call
   * settles; concurrent callers queue. Errors and rejections inside fn are caught and resolved
   * to `fallback` so one failure can't break the chain. A per-call timeout race lets us abandon
   * a hung call and unblock the chain — the abandoned SDK call is left to settle on its own and
   * its result is ignored.
   */
  private serializeBleCall<T>(label: string, fn: () => Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
    const run = async (): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let timedOut = false;
      const timeoutPromise = new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          resolve(fallback);
        }, timeoutMs);
      });
      try {
        const result = await Promise.race([fn(), timeoutPromise]);
        if (timedOut) {
          debugLog('ble call timeout', { label, ms: timeoutMs }, 'BRG');
        }
        return result;
      } catch (err) {
        debugLog('ble call error', { label, err: String(err) }, 'BRG');
        return fallback;
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    const next = this.bleChain.then(run, run);
    this.bleChain = next.catch(() => {});
    return next;
  }

  // ---------------------------------------------------------------------------
  // Storage — dual-write (localStorage authoritative, SDK best-effort).
  // localStorage is durable in WKWebView on iOS; the SDK store has been observed to silently drop
  // settings writes across iOS app restarts.
  // ---------------------------------------------------------------------------

  async rawSdkGet(key: string): Promise<string | null> {
    if (!this.bridge) return null;
    const bridge = this.bridge;
    const value = await this.serializeBleCall(`getLocalStorage(${key})`, () => bridge.getLocalStorage(key), '', BLE_STORAGE_TIMEOUT_MS);
    return value === '' ? null : value;
  }

  async storageGet(key: string): Promise<string | null> {
    let localValue: string | null = null;
    try {
      localValue = localStorage.getItem(key);
    } catch {
      // localStorage unavailable in some test environments.
    }
    if (localValue !== null) return localValue;
    if (!this.bridge) return null;
    const bridge = this.bridge;
    const value = await this.serializeBleCall(`getLocalStorage(${key})`, () => bridge.getLocalStorage(key), '', BLE_STORAGE_TIMEOUT_MS);
    return value === '' ? null : value;
  }

  async storageSet(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      debugLog('storage SET local failed', { key, err: String(err) }, 'STG');
    }
    if (!this.bridge) return;
    const bridge = this.bridge;
    await this.serializeBleCall(`setLocalStorage(${key})`, () => bridge.setLocalStorage(key, value), false, BLE_STORAGE_TIMEOUT_MS);
  }

  // ---------------------------------------------------------------------------
  // Page setup / rebuild
  // ---------------------------------------------------------------------------

  async setupPage(container: CreateStartUpPageContainer): Promise<boolean> {
    if (!this.bridge) return false;
    if (this.startupCalled) {
      console.warn('[EvenHubBridge] setupPage called twice; ignoring (use updatePage instead).');
      return false;
    }
    const bridge = this.bridge;
    const result = await this.serializeBleCall(
      'createStartUpPageContainer',
      () => bridge.createStartUpPageContainer(container),
      StartUpPageCreateResult.invalid,
      BLE_PAGE_TIMEOUT_MS,
    );
    const success = result === StartUpPageCreateResult.success;
    if (success) {
      this.startupCalled = true;
    } else {
      console.error('[EvenHubBridge] createStartUpPageContainer failed:', result);
    }
    return success;
  }

  async updatePage(container: RebuildPageContainer): Promise<boolean> {
    if (!this.bridge) return false;
    const bridge = this.bridge;
    return await this.serializeBleCall(
      'rebuildPageContainer',
      () => bridge.rebuildPageContainer(container),
      false,
      BLE_PAGE_TIMEOUT_MS,
    );
  }

  // ---------------------------------------------------------------------------
  // Image + text sends — latest-wins per container, serialized via bleChain.
  // ---------------------------------------------------------------------------

  /**
   * Schedule an image send for `containerID`. If a prior payload for the same container is still
   * pending, it is dropped — the latest payload wins. Returns void; callers do NOT await.
   */
  updateImage(containerID: number, containerName: string, payload: ImageRawDataUpdate): void {
    if (!this.bridge) return;
    if (containerID === undefined || containerID === null) return;
    this.pendingImageByContainer.set(containerID, { name: containerName, payload });
    void this.runImageSender();
  }

  /**
   * Schedule a text send for `containerID`. Latest-wins per container, identical model to images.
   */
  updateText(containerID: number, containerName: string, content: string): void {
    if (!this.bridge) return;
    this.pendingTextByContainer.set(containerID, { name: containerName, content });
    void this.runTextSender();
  }

  private async runImageSender(): Promise<void> {
    if (this.imageSenderRunning || !this.bridge) return;
    this.imageSenderRunning = true;
    const myRunnerSeq = ++this.imageSenderRunnerSeq;
    this.activeImageSenderRunnerSeq = myRunnerSeq;
    try {
      // Yield once before reading the pending map so all synchronous updateImage calls in this
      // tick get a chance to overwrite the slot. Without this yield, the very first call would
      // capture the slot value before subsequent calls in the same tick replace it — defeating
      // the latest-wins guarantee. After the first SDK await, subsequent loop iterations already
      // see any later overwrites naturally.
      await Promise.resolve();
      while (this.pendingImageByContainer.size > 0) {
        if (!this.bridge) break;
        if (myRunnerSeq !== this.activeImageSenderRunnerSeq) return;

        const it = this.pendingImageByContainer.entries().next();
        if (it.done) break;
        const [containerID, { payload }] = it.value;
        this.pendingImageByContainer.delete(containerID);

        const bridge = this.bridge;
        const sendStartMs = nowMs();
        const result = await this.serializeBleCall(
          'updateImageRawData',
          () => bridge.updateImageRawData(payload),
          ImageRawDataUpdateResult.sendFailed,
          IMAGE_SEND_TIMEOUT_MS,
        );
        const ms = Math.round(nowMs() - sendStartMs);

        // The SDK reports failures via the result enum, not Promise rejection. After the
        // exit-dialog cancel on iOS, every call resolves in 2–30ms with `sendFailed`. Treat
        // anything other than `success` as a real failure.
        if (ImageRawDataUpdateResult.isSuccess(result)) {
          this.consecutiveImageSendFailures = 0;
          debugLog('image send ok', { containerID, ms }, 'BRG');
        } else {
          this.consecutiveImageSendFailures += 1;
          debugLog('image send non-success', {
            containerID,
            result: String(result),
            ms,
            consecutive: this.consecutiveImageSendFailures,
          }, 'BRG');
          this.maybeFirePersistentImageFailure();
        }

        if (myRunnerSeq !== this.activeImageSenderRunnerSeq) return;
        if (this.cleared) {
          this.cleared = false;
          break;
        }
      }
    } finally {
      // Only the active runner should reset state and re-trigger; superseded runners just exit.
      if (myRunnerSeq === this.activeImageSenderRunnerSeq) {
        this.imageSenderRunning = false;
        if (this.pendingImageByContainer.size > 0 && !this.cleared) {
          void this.runImageSender();
        }
      }
    }
  }

  private async runTextSender(): Promise<void> {
    if (this.textSenderRunning || !this.bridge) return;
    this.textSenderRunning = true;
    try {
      // Same microtask-yield rationale as runImageSender.
      await Promise.resolve();
      while (this.pendingTextByContainer.size > 0) {
        if (!this.bridge) break;
        const it = this.pendingTextByContainer.entries().next();
        if (it.done) break;
        const [containerID, { name, content }] = it.value;
        this.pendingTextByContainer.delete(containerID);
        const bridge = this.bridge;
        await this.serializeBleCall(
          'textContainerUpgrade',
          () => bridge.textContainerUpgrade(
            new TextContainerUpgrade({ containerID, containerName: name, content }),
          ),
          false,
          BLE_TEXT_TIMEOUT_MS,
        );
        if (this.cleared) {
          this.cleared = false;
          break;
        }
      }
    } finally {
      this.textSenderRunning = false;
      if (this.pendingTextByContainer.size > 0 && !this.cleared) {
        void this.runTextSender();
      }
    }
  }

  /**
   * Drop every pending image and text slot. Used on visibility hide so payloads don't try to
   * deliver on a paused WebView. The currently-in-flight SDK call (if any) still runs to
   * completion — we can't cancel that — but no new sends are dispatched until the next
   * updateImage/updateText.
   */
  clearPending(): void {
    this.pendingImageByContainer.clear();
    this.pendingTextByContainer.clear();
    this.cleared = true;
  }

  /**
   * Hard reset for the image transport. Invalidates any in-flight runImageSender so its abandoned
   * `await updateImageRawData` becomes a no-op when the SDK Promise eventually settles. Drops
   * pending image payloads and resets the bleChain so subsequent SDK calls don't queue behind a
   * possibly-hung previous call. Used by recovery code.
   */
  forceResetImageTransport(reason: string): void {
    debugLog('forceResetImageTransport', { reason }, 'BRG');
    this.activeImageSenderRunnerSeq = ++this.imageSenderRunnerSeq;
    this.imageSenderRunning = false;
    this.cleared = false;
    this.pendingImageByContainer.clear();
    this.consecutiveImageSendFailures = 0;
    this.bleChain = Promise.resolve();
  }

  /**
   * Register a callback fired when consecutive image send failures cross
   * IMAGE_PERSISTENT_FAILURE_THRESHOLD. Returns an unsubscribe function. The callback is
   * debounced internally — successive failures don't fire it in a tight loop.
   */
  onPersistentImageFailure(handler: (failureCount: number) => void): () => void {
    this.onPersistentImageFailureCallback = handler;
    return () => {
      if (this.onPersistentImageFailureCallback === handler) {
        this.onPersistentImageFailureCallback = null;
      }
    };
  }

  private maybeFirePersistentImageFailure(): void {
    if (this.consecutiveImageSendFailures < IMAGE_PERSISTENT_FAILURE_THRESHOLD) return;
    if (!this.onPersistentImageFailureCallback) return;
    const now = nowMs();
    if (
      this.lastPersistentFailureFiredAtMs !== null &&
      now - this.lastPersistentFailureFiredAtMs < IMAGE_PERSISTENT_FAILURE_COOLDOWN_MS
    ) {
      return;
    }
    this.lastPersistentFailureFiredAtMs = now;
    debugLog('persistent image failure — invoking recovery handler', {
      consecutive: this.consecutiveImageSendFailures,
    }, 'BRG');
    try {
      this.onPersistentImageFailureCallback(this.consecutiveImageSendFailures);
    } catch (err) {
      console.error('[EvenHubBridge] onPersistentImageFailure handler threw', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Subscriptions & device info
  // ---------------------------------------------------------------------------

  subscribeEvents(handler: (event: EvenHubEvent) => void): void {
    this.unsubscribeEvents?.();
    if (!this.bridge) return;
    try {
      this.unsubscribeEvents = this.bridge.onEvenHubEvent((event) => {
        handler(event);
      });
    } catch (err) {
      console.error('[EvenHubBridge] Event subscription error:', err);
      this.unsubscribeEvents = null;
    }
  }

  subscribeDeviceStatus(handler: (status: DeviceStatus) => void): () => void {
    if (!this.bridge) return () => {};
    try {
      return this.bridge.onDeviceStatusChanged(handler);
    } catch (err) {
      console.error('[EvenHubBridge] onDeviceStatusChanged error:', err);
      return () => {};
    }
  }

  subscribeLaunchSource(handler: (source: LaunchSource) => void): () => void {
    if (!this.bridge) return () => {};
    try {
      return this.bridge.onLaunchSource(handler);
    } catch (err) {
      console.error('[EvenHubBridge] onLaunchSource error:', err);
      return () => {};
    }
  }

  async getDeviceInfo(): Promise<DeviceInfo | null> {
    if (!this.bridge) return null;
    const bridge = this.bridge;
    return await this.serializeBleCall('getDeviceInfo', () => bridge.getDeviceInfo(), null, BLE_DEVICE_INFO_TIMEOUT_MS);
  }

  /**
   * Surface the system "End this feature?" confirmation dialog. Per ER guidance this is true
   * fire-and-forget — no await, no timeout, no result inspection. The bridge does not own UX
   * cooldowns; if double-firing becomes a problem the caller should debounce.
   */
  requestSystemExit(): void {
    if (!this.bridge) return;
    try {
      this.bridge.shutDownPageContainer(1).catch((err) => {
        console.error('[EvenHubBridge] shutDownPageContainer(1) rejected:', err);
      });
    } catch (err) {
      console.error('[EvenHubBridge] requestSystemExit synchronous error:', err);
    }
  }

  async shutdown(): Promise<void> {
    this.clearPending();
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    if (!this.bridge) return;
    const bridge = this.bridge;
    await this.serializeBleCall('shutDownPageContainer(0)', () => bridge.shutDownPageContainer(0), false, SHUTDOWN_HARD_CAP_MS);
  }
}
