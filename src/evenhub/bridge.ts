/**
 * EvenHubBridge — SDK lifecycle and container operations.
 */

import {
  waitForEvenAppBridge,
  TextContainerUpgrade,
  type EvenAppBridge as EvenAppBridgeType,
  type CreateStartUpPageContainer,
  type RebuildPageContainer,
  type ImageRawDataUpdate,
  type EvenHubEvent,
  ImageRawDataUpdateResult,
} from '@evenrealities/even_hub_sdk';
import { perfLogLazyIfEnabled } from '../perf/log';

export type EvenHubEventHandler = (event: EvenHubEvent) => void;
export type BridgeSystemLifecycleEvent = 'foreground-enter' | 'foreground-exit' | 'abnormal-exit';
export type BoardSendHealthSnapshot = {
  avgQueueWaitMs: number;
  avgSendMs: number;
  boardBusy: boolean;
  backlogged: boolean;
  linkSlow: boolean;
  interrupted: boolean;
  wedged: boolean;
  survivalMode: boolean;
  degraded: boolean;
  maxQueueWaitMs: number;
  sampleCount: number;
};

export type ImageTransportSnapshot = {
  hasInFlight: boolean;
  inFlightAgeMs: number;
  queueDepth: number;
  busy: boolean;
  interrupted: boolean;
  backlogged: boolean;
  linkSlow: boolean;
  wedged: boolean;
  consecutiveNonOkSends: number;
  lastSuccessfulSendAtMs: number;
};

type ImageUpdatePriority = 'high' | 'low';

type ImageUpdateKind = 'board' | 'branding' | 'other';

interface QueuedImageUpdate {
  data: ImageRawDataUpdate;
  enqueuedAtMs: number;
  priority: ImageUpdatePriority;
  kind: ImageUpdateKind;
  interruptProtected: boolean;
}

interface InFlightImageSend {
  queued: QueuedImageUpdate;
  runnerId: number;
  abandoned: boolean;
  sendStartedAtMs: number;
  queueWaitMs: number;
}

interface QueuedTextUpdate {
  key: string;
  containerID: number;
  containerName: string;
  content: string;
  enqueuedAtMs: number;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function imagePayloadBytes(imageData: ImageRawDataUpdate['imageData']): number {
  if (imageData == null) return 0;
  if (typeof imageData === 'string') return imageData.length;
  if (typeof (imageData as ArrayBuffer).byteLength === 'number') {
    return (imageData as ArrayBuffer).byteLength;
  }
  if (typeof (imageData as { length?: number }).length === 'number') {
    return (imageData as { length: number }).length;
  }
  return 0;
}

// Off by default. Enable only for transport profiling (bytes/qwait/send timings) because logging itself adds overhead.
const PERF_BRIDGE_ENABLED = false;
const PERF_BRIDGE_LOG_SLOW_IMAGE_MS = 200;
const PERF_BRIDGE_SUMMARY_EVERY_IMAGES = 20;

// Rolling board-link health model used by app.ts to choose quality-vs-responsiveness send strategies.
// Thresholds are intentionally conservative and use hysteresis + confirmation to avoid startup false positives.
const BOARD_HEALTH_WINDOW_SAMPLES = 8;
const BOARD_HEALTH_MIN_SAMPLES = 3;
const BOARD_HEALTH_IGNORE_INITIAL_SAMPLES = 2;
const BOARD_DEGRADED_CONFIRM_WINDOWS = 2;
const BOARD_DEGRADED_AVG_SEND_MS = 1500;
const BOARD_DEGRADED_AVG_QWAIT_MS = 150;
const BOARD_DEGRADED_MAX_QWAIT_MS = 200;
const BOARD_RECOVER_AVG_SEND_MS = 1200;
const BOARD_RECOVER_AVG_QWAIT_MS = 80;
const BOARD_RECOVER_MAX_QWAIT_MS = 100;
const BOARD_LINK_SLOW_DEGRADED_MAX_SEND_MS = 1800;
const BOARD_LINK_SLOW_RECOVER_MAX_SEND_MS = 1400;
const BOARD_BACKLOG_DEGRADED_QUEUE_DEPTH = 2;
const BOARD_BACKLOG_RECOVER_QUEUE_DEPTH = 1;

// Resilience stack for interrupted / stalled SDK sends.
const IMAGE_INTERRUPTION_TRIGGER_SEND_MS = 2500;
const IMAGE_INTERRUPTION_TRIGGER_TOTAL_MS = 3500;
const IMAGE_INTERRUPTION_RECOVER_MAX_SEND_MS = 1100;
const IMAGE_INTERRUPTION_RECOVER_MAX_QWAIT_MS = 1200;
const IMAGE_INTERRUPTION_RECOVER_GOOD_SENDS = 3;
const IMAGE_INTERRUPTION_MAX_QUEUED_IMAGES = 1;
const IMAGE_INTERRUPTION_MAX_PROTECTED_IMAGES = 3;
const IMAGE_SEND_WATCHDOG_TRIGGER_MS = 2500;
const IMAGE_SEND_HARD_WEDGE_TRIGGER_MS = 8000;
const IMAGE_SURVIVAL_MODE_TRIGGER_WATCHDOG_TRIPS = 3;
const IMAGE_SURVIVAL_MODE_WATCHDOG_WINDOW_MS = 15000;
const IMAGE_SURVIVAL_MODE_RECOVER_QUIET_MS = 10000;
const IMAGE_CONSECUTIVE_STALL_THRESHOLD_MS = 3000;
const IMAGE_CONSECUTIVE_STALL_COUNT = 2;
const TEXT_UPDATE_SEND_TIMEOUT_MS = 1200;
const TEXT_UPDATE_RETRY_COOLDOWN_MS = 600;
const TEXT_SURVIVAL_GATE_RETRY_MS = 500;
const IMAGE_DEFAULT_POST_SEND_GAP_MS = 40;

export class EvenHubBridge {
  private bridge: EvenAppBridgeType | null = null;
  private imageQueue: Array<QueuedImageUpdate | null> = [];
  private imageQueueHead = 0;
  private isSendingImage = false;
  private activeImageQueueRunnerId = 0;
  private nextImageQueueRunnerId = 0;
  private activeSendKind: ImageUpdateKind | null = null;
  private inFlightImage: InFlightImageSend | null = null;
  private unsubscribeEvents: (() => void) | null = null;

  private perfWindowStartMs = nowMs();
  private perfImageCount = 0;
  private perfTotalBytes = 0;
  private perfTotalQueueWaitMs = 0;
  private perfTotalSendMs = 0;
  private perfMaxQueueDepth = 0;
  private perfCoalesced = 0;
  private perfInterruptedDrops = 0;
  private perfWatchdogTrips = 0;
  private perfHardWedgeTrips = 0;
  private perfBleGapCount = 0;
  private perfBleGapTotalMs = 0;
  private perfTextGateBlocks = 0;
  private perfTextGateTotalMs = 0;

  private recentBoardSendMs: number[] = [];
  private recentBoardQueueWaitMs: number[] = [];
  private boardHealthIgnoredSamplesRemaining = BOARD_HEALTH_IGNORE_INITIAL_SAMPLES;
  private boardDegradedConfirmWindows = 0;
  private boardLinkDegraded = false;
  private boardLinkSlow = false;
  private boardQueueBacklogged = false;

  private imageInterrupted = false;
  private imageSendWedged = false;
  private imageSurvivalMode = false;
  private imageInterruptedRecoveryGoodSends = 0;
  private recentWatchdogTripAtMs: number[] = [];
  private imageInterruptionListeners = new Set<(active: boolean) => void>();
  private consecutiveStallCount = 0;
  private consecutiveNonOkSendCount = 0;
  private lastSuccessfulImageSendAtMs = 0;

  private inFlightImageWatchdog: ReturnType<typeof setTimeout> | null = null;
  private inFlightImageWatchdogSeq = 0;
  private inFlightImageWatchdogTriggered = false;
  private inFlightImageHardTimeout: ReturnType<typeof setTimeout> | null = null;
  private inFlightImageHardTimeoutSeq = 0;
  private inFlightImageHardTimeoutTriggered = false;

  private textQueue = new Map<string, QueuedTextUpdate>();
  private isSendingText = false;
  private textSendBlocked = false;
  private textResumeTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlightTextUpdate: QueuedTextUpdate | null = null;
  private lastSentTextByKey = new Map<string, string>();
  private textGateActiveStartMs = 0;

  async init(): Promise<void> {
    try {
      this.bridge = await waitForEvenAppBridge();
      console.log('[EvenHubBridge] Bridge ready.');
    } catch (err) {
      console.warn('[EvenHubBridge] Bridge init failed (running outside Even Hub?):', err);
      this.bridge = null;
    }
  }

  async setupPage(container: CreateStartUpPageContainer): Promise<boolean> {
    if (!this.bridge) {
      console.log('[EvenHubBridge] No bridge — skipping setupPage.');
      return false;
    }

    try {
      const result = await this.bridge.createStartUpPageContainer(container);
      const success = result === 0;
      if (!success) {
        console.error('[EvenHubBridge] createStartUpPageContainer failed:', result);
      }
      return success;
    } catch (err) {
      console.error('[EvenHubBridge] createStartUpPageContainer error:', err);
      return false;
    }
  }

  async updatePage(container: RebuildPageContainer): Promise<boolean> {
    if (!this.bridge) {
      console.log('[EvenHubBridge] No bridge — skipping updatePage.');
      return false;
    }

    try {
      const success = await this.bridge.rebuildPageContainer(container);
      if (!success) {
        console.warn('[EvenHubBridge] rebuildPageContainer returned false.');
      }
      return success;
    } catch (err) {
      console.error('[EvenHubBridge] rebuildPageContainer error:', err);
      return false;
    }
  }

  async updateText(containerID: number, containerName: string, content: string): Promise<boolean> {
    if (!this.bridge) return false;
    const key = `${containerID}:${containerName}`;
    if (this.lastSentTextByKey.get(key) === content && !this.textQueue.has(key) && this.inFlightTextUpdate?.key !== key) {
      return true;
    }
    if (this.inFlightTextUpdate?.key === key && this.inFlightTextUpdate.content === content) {
      return true;
    }
    const existingQueued = this.textQueue.get(key);
    if (existingQueued && existingQueued.content === content) {
      return true;
    }
    if (existingQueued) {
      this.textQueue.delete(key);
    }
    this.textQueue.set(key, {
      key,
      containerID,
      containerName,
      content,
      enqueuedAtMs: nowMs(),
    });
    void this.processTextQueue();
    // Non-blocking by design: text sends are serialized/coalesced and should not stall flush loops.
    return true;
  }

  private async processTextQueue(): Promise<void> {
    if (this.isSendingText || !this.bridge || this.textSendBlocked) return;
    this.isSendingText = true;
    try {
      while (this.textQueue.size > 0) {
        if (!this.bridge || this.textSendBlocked) break;
        if (this.imageInterrupted || (this.imageSurvivalMode && this.boardLinkSlow)) {
          const isNewBlock = this.textGateActiveStartMs === 0;
          this.textSendBlocked = true;
          if (isNewBlock) {
            this.perfTextGateBlocks += 1;
            this.textGateActiveStartMs = nowMs();
          }
          if (!this.textResumeTimer) {
            this.textResumeTimer = setTimeout(() => {
              this.textResumeTimer = null;
              this.textSendBlocked = false;
              void this.processTextQueue();
            }, TEXT_SURVIVAL_GATE_RETRY_MS);
          }
          break;
        }
        if (this.textGateActiveStartMs > 0) {
          const totalGateMs = nowMs() - this.textGateActiveStartMs;
          this.perfTextGateTotalMs += totalGateMs;
          this.textGateActiveStartMs = 0;
        }

        const next = this.textQueue.entries().next();
        if (next.done) break;
        const [key, queued] = next.value;
        this.textQueue.delete(key);
        this.inFlightTextUpdate = queued;

        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let timedOut = false;
        const sendPromise = this.bridge
          .textContainerUpgrade(
            new TextContainerUpgrade({
              containerID: queued.containerID,
              containerName: queued.containerName,
              content: queued.content,
            }),
          )
          .catch((err) => {
            console.error('[EvenHubBridge] textContainerUpgrade error:', err);
            return false;
          });
        const timeoutPromise = new Promise<boolean>((resolve) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            resolve(false);
          }, TEXT_UPDATE_SEND_TIMEOUT_MS);
        });
        const updated = await Promise.race<boolean>([sendPromise, timeoutPromise]);
        if (timeoutId) clearTimeout(timeoutId);

        if (timedOut) {
          this.textSendBlocked = true;
          void sendPromise.finally(() => {
            this.textSendBlocked = false;
            this.inFlightTextUpdate = null;
            if (this.textResumeTimer) {
              clearTimeout(this.textResumeTimer);
            }
            this.textResumeTimer = setTimeout(() => {
              this.textResumeTimer = null;
              void this.processTextQueue();
            }, TEXT_UPDATE_RETRY_COOLDOWN_MS);
          });
          break;
        }

        this.inFlightTextUpdate = null;
        if (updated) {
          this.lastSentTextByKey.set(key, queued.content);
        }
      }
    } finally {
      this.isSendingText = false;
      if (!this.textSendBlocked && this.textQueue.size > 0) {
        void this.processTextQueue();
      }
    }
  }

  hasPendingBoardImageWork(): boolean {
    if (this.activeSendKind === 'board') return true;
    if (this.inFlightImage?.queued.kind === 'board') return true;
    for (let i = this.imageQueueHead; i < this.imageQueue.length; i++) {
      const queued = this.imageQueue[i];
      if (queued && queued.kind === 'board') return true;
    }
    return false;
  }

  /** Any image work (board/branding/other) in-flight or queued. */
  hasPendingImageWork(): boolean {
    if (this.isSendingImage || this.inFlightImage) return true;
    return this.getImageQueueDepth() > 0;
  }

  getImageTransportSnapshot(): ImageTransportSnapshot {
    const inFlight = this.inFlightImage;
    const inFlightAgeMs = inFlight ? Math.max(0, nowMs() - inFlight.sendStartedAtMs) : 0;
    return {
      hasInFlight: inFlight != null,
      inFlightAgeMs,
      queueDepth: this.getImageQueueDepth(),
      busy: this.hasPendingImageWork(),
      interrupted: this.imageInterrupted,
      backlogged: this.boardQueueBacklogged || this.getImageQueueDepth() >= BOARD_BACKLOG_DEGRADED_QUEUE_DEPTH,
      linkSlow: this.boardLinkSlow,
      wedged: this.imageSendWedged,
      consecutiveNonOkSends: this.consecutiveNonOkSendCount,
      lastSuccessfulSendAtMs: this.lastSuccessfulImageSendAtMs,
    };
  }

  forceResetImageTransport(reason: string): void {
    // Caller is forcing a fresh start regardless of current queue state.
    this.consecutiveNonOkSendCount = 0;
    const inFlight = this.inFlightImage;
    if (
      this.getImageQueueDepth() <= 0 &&
      !inFlight &&
      !this.isSendingImage &&
      !this.imageSendWedged &&
      !this.imageInterrupted
    ) {
      return;
    }
    if (inFlight) {
      inFlight.abandoned = true;
      if (this.activeImageQueueRunnerId === inFlight.runnerId) {
        this.activeImageQueueRunnerId += 1;
      }
    }
    this.dropQueuedImagesForHardWedge();
    this.disarmImageSendHardTimeout();
    this.disarmImageSendWatchdog();
    this.inFlightImage = null;
    this.isSendingImage = false;
    this.activeSendKind = null;
    this.consecutiveStallCount = 0;
    this.consecutiveNonOkSendCount = 0;
    if (this.textResumeTimer) {
      clearTimeout(this.textResumeTimer);
      this.textResumeTimer = null;
    }
    this.textSendBlocked = false;
    this.inFlightTextUpdate = null;
    this.setImageSendWedged(false, `force-reset:${reason}`);
    this.setImageInterrupted(false, `force-reset:${reason}`);
    this.setImageSurvivalMode(false, `force-reset:${reason}`);
    if (this.textQueue.size > 0) {
      void this.processTextQueue();
    }
  }

  /** Current image queue depth (for debug instrumentation). */
  getImageQueueDepth(): number {
    let count = 0;
    for (let i = this.imageQueueHead; i < this.imageQueue.length; i++) {
      if (this.imageQueue[i]) count++;
    }
    return count;
  }

  getBoardSendHealth(): BoardSendHealthSnapshot {
    const sampleCount = Math.min(this.recentBoardSendMs.length, this.recentBoardQueueWaitMs.length);
    const boardBusy = this.hasPendingBoardImageWork();
    const backlogged = this.boardQueueBacklogged || this.getImageQueueDepth() >= BOARD_BACKLOG_DEGRADED_QUEUE_DEPTH;
    const linkSlow = this.boardLinkSlow;
    const interrupted = this.imageInterrupted;
    const wedged = this.imageSendWedged;
    const survivalMode = this.imageSurvivalMode;
    const degraded = this.boardLinkDegraded || backlogged || linkSlow || interrupted || wedged;
    if (sampleCount === 0) {
      return {
        avgQueueWaitMs: 0,
        avgSendMs: 0,
        boardBusy,
        backlogged,
        linkSlow,
        interrupted,
        wedged,
        survivalMode,
        degraded,
        maxQueueWaitMs: 0,
        sampleCount: 0,
      };
    }

    const sendSamples = this.recentBoardSendMs.slice(-sampleCount);
    const qwaitSamples = this.recentBoardQueueWaitMs.slice(-sampleCount);
    const avgSendMs = sendSamples.reduce((sum, ms) => sum + ms, 0) / sampleCount;
    const avgQueueWaitMs = qwaitSamples.reduce((sum, ms) => sum + ms, 0) / sampleCount;
    const maxQueueWaitMs = qwaitSamples.reduce((max, ms) => Math.max(max, ms), 0);

    return {
      avgQueueWaitMs,
      avgSendMs,
      boardBusy,
      backlogged,
      linkSlow,
      interrupted,
      wedged,
      survivalMode,
      degraded,
      maxQueueWaitMs,
      sampleCount,
    };
  }

  subscribeImageInterruption(handler: (active: boolean) => void): () => void {
    this.imageInterruptionListeners.add(handler);
    return () => {
      this.imageInterruptionListeners.delete(handler);
    };
  }

  notifySystemLifecycleEvent(event: BridgeSystemLifecycleEvent): void {
    if (PERF_BRIDGE_ENABLED) {
      const q = this.getImageQueueDepth();
      perfLogLazyIfEnabled?.(
        () =>
          `[Perf][Bridge][Lifecycle] event=${event} q=${q} busy=${this.hasPendingImageWork() ? 'y' : 'n'} ` +
          `intr=${this.imageInterrupted ? 'y' : 'n'} wedged=${this.imageSendWedged ? 'y' : 'n'} survival=${this.imageSurvivalMode ? 'y' : 'n'}`,
      );
    }

    switch (event) {
      case 'foreground-exit':
      case 'abnormal-exit':
        this.setImageInterrupted(true, `sys-${event}`);
        return;
      case 'foreground-enter':
        if (this.imageSendWedged) {
          this.setImageSendWedged(false, 'sys-foreground-enter');
        }
        if (!this.hasPendingImageWork()) {
          this.setImageInterrupted(false, 'sys-foreground-enter');
        }
        void this.processImageQueue();
        return;
      default:
        return;
    }
  }

  // SDK/device path effectively requires serial image sends.
  // Promise resolves after queue drain *attempt*, not necessarily after this specific image was physically sent
  // if another caller is already draining. Callers use this as flow control, not exact completion semantics.
  async updateBoardImage(
    data: ImageRawDataUpdate,
    options?: {
      priority?: ImageUpdatePriority;
      kind?: ImageUpdateKind;
      interruptProtected?: boolean;
    }
  ): Promise<void> {
    if (!this.bridge) return;
    this.enqueueImageUpdate(data, options);
    await this.processImageQueue();
  }

  // Startup / full-frame helpers can enqueue both halves first, then pay the queue-drain overhead once.
  // Actual transport remains serial inside processImageQueue().
  async updateBoardImages(
    images: ImageRawDataUpdate[],
    options?: {
      priority?: ImageUpdatePriority;
      kind?: ImageUpdateKind;
      interruptProtected?: boolean;
    }
  ): Promise<void> {
    if (!this.bridge || images.length === 0) return;
    for (const image of images) {
      this.enqueueImageUpdate(image, options);
    }
    await this.processImageQueue();
  }

  private async processImageQueue(): Promise<void> {
    // Single drain loop for all image traffic. This preserves ordering across board/branding updates.
    if (this.isSendingImage || !this.bridge || this.imageSendWedged) return;
    this.isSendingImage = true;
    const runnerId = ++this.nextImageQueueRunnerId;
    this.activeImageQueueRunnerId = runnerId;

    try {
      let firstIteration = true;
      while (true) {
        if (runnerId !== this.activeImageQueueRunnerId || this.imageSendWedged) break;
        if (!firstIteration && !this.imageSendWedged && runnerId === this.activeImageQueueRunnerId) {
          const gapMs = this.boardLinkSlow ? 80 : IMAGE_DEFAULT_POST_SEND_GAP_MS;
          this.perfBleGapCount += 1;
          this.perfBleGapTotalMs += gapMs;
          await new Promise<void>((resolve) => setTimeout(resolve, gapMs));
        }
        firstIteration = false;
        if (this.imageInterrupted) this.pruneQueuedImagesForInterruption();
        const queued = this.dequeueNextQueuedImage();
        if (!queued) break;

        const sendStartedAtMs = nowMs();
        const queueWaitMs = sendStartedAtMs - queued.enqueuedAtMs;
        this.activeSendKind = queued.kind;
        const inFlight: InFlightImageSend = {
          queued,
          runnerId,
          abandoned: false,
          sendStartedAtMs,
          queueWaitMs,
        };
        this.inFlightImage = inFlight;
        this.armImageSendWatchdog(inFlight);
        this.armImageSendHardTimeout(inFlight);

        try {
          const result = await this.bridge.updateImageRawData(queued.data);
          const sendMs = nowMs() - sendStartedAtMs;
          this.disarmImageSendHardTimeout({ cid: queued.data.containerID, sendMs, abandoned: inFlight.abandoned });
          this.disarmImageSendWatchdog({ cid: queued.data.containerID, sendMs });

          if (inFlight.abandoned || runnerId !== this.activeImageQueueRunnerId) {
            const lateOk = ImageRawDataUpdateResult.isSuccess(result);
            if (PERF_BRIDGE_ENABLED) {
              perfLogLazyIfEnabled?.(
                () =>
                  `[Perf][Bridge][Wedge] late-return cid=${queued.data.containerID ?? -1} send=${sendMs.toFixed(1)}ms ` +
                  `result=${lateOk ? 'ok' : 'non-ok'}`,
              );
            }
            if (!lateOk) {
              this.consecutiveNonOkSendCount += 1;
            } else {
              this.consecutiveNonOkSendCount = 0;
            }
            this.setImageSendWedged(false, 'late-return');
            void this.processImageQueue();
          } else {
            const sendOk = ImageRawDataUpdateResult.isSuccess(result);
            this.recordImagePerf(queued.data, queued.kind, queueWaitMs, sendMs, sendOk);
            if (!sendOk) {
              console.warn('[EvenHubBridge] Image update not successful:', result);
            }
          }
        } catch (err) {
          const sendMs = nowMs() - sendStartedAtMs;
          this.disarmImageSendHardTimeout({ cid: queued.data.containerID, sendMs, abandoned: inFlight.abandoned });
          this.disarmImageSendWatchdog({ cid: queued.data.containerID, sendMs });

          if (inFlight.abandoned || runnerId !== this.activeImageQueueRunnerId) {
            if (PERF_BRIDGE_ENABLED) {
              perfLogLazyIfEnabled?.(
                () => `[Perf][Bridge][Wedge] late-error cid=${queued.data.containerID ?? -1} send=${sendMs.toFixed(1)}ms`,
              );
            }
            this.consecutiveNonOkSendCount += 1;
            this.setImageSendWedged(false, 'late-error');
            void this.processImageQueue();
          } else {
            this.recordImagePerf(queued.data, queued.kind, queueWaitMs, sendMs, false);
            console.error('[EvenHubBridge] Image update error:', err);
          }
        } finally {
          this.disarmImageSendHardTimeout();
          this.disarmImageSendWatchdog();
          if (this.inFlightImage === inFlight) {
            this.inFlightImage = null;
          }
          if (!inFlight.abandoned && runnerId === this.activeImageQueueRunnerId) {
            this.activeSendKind = null;
          }
        }
      }
    } finally {
      if (runnerId === this.activeImageQueueRunnerId) {
        this.isSendingImage = false;
        this.activeSendKind = null;
      }

      this.compactQueueIfNeeded();

      // Drain any images enqueued during the handoff window after the loop exited.
      if (!this.isSendingImage && !this.imageSendWedged && this.getImageQueueDepth() > 0) {
        void this.processImageQueue();
      }
    }
  }

  private dequeueNextQueuedImage(): QueuedImageUpdate | null {
    while (this.imageQueueHead < this.imageQueue.length) {
      const queued = this.imageQueue[this.imageQueueHead++];
      if (queued) return queued;
    }
    return null;
  }

  private compactQueueIfNeeded(): void {
    if (this.imageQueueHead === this.imageQueue.length) {
      this.imageQueue = [];
      this.imageQueueHead = 0;
      return;
    }

    // Coalescing and interruption pruning leave tombstones; compact periodically to keep scans cheap.
    if (this.imageQueueHead > 32) {
      this.imageQueue = this.imageQueue.slice(this.imageQueueHead);
      this.imageQueueHead = 0;
    }
  }

  private armImageSendWatchdog(inFlight: InFlightImageSend): void {
    this.disarmImageSendWatchdog();
    this.inFlightImageWatchdogTriggered = false;
    const watchdogSeq = ++this.inFlightImageWatchdogSeq;
    this.inFlightImageWatchdog = setTimeout(() => {
      if (watchdogSeq !== this.inFlightImageWatchdogSeq) return;
      if (!this.isSendingImage) return;
      if (this.inFlightImage !== inFlight) return;
      this.inFlightImageWatchdogTriggered = true;
      this.perfWatchdogTrips += 1;
      this.recordWatchdogTripForSurvival();
      const elapsedMs = nowMs() - inFlight.sendStartedAtMs;
      if (PERF_BRIDGE_ENABLED) {
        perfLogLazyIfEnabled?.(
          () =>
            `[Perf][Bridge][Watchdog] active=y cid=${inFlight.queued.data.containerID ?? -1} ` +
            `elapsed=${elapsedMs.toFixed(1)}ms qwait=${inFlight.queueWaitMs.toFixed(1)}ms pending=${this.getImageQueueDepth()}`,
        );
      }
      this.setImageInterrupted(true, 'watchdog-send');
      // While the SDK call is still in flight, keep trimming stale queued work.
      this.pruneQueuedImagesForInterruption();
    }, IMAGE_SEND_WATCHDOG_TRIGGER_MS);
  }

  private armImageSendHardTimeout(inFlight: InFlightImageSend): void {
    this.disarmImageSendHardTimeout();
    this.inFlightImageHardTimeoutTriggered = false;
    const timeoutSeq = ++this.inFlightImageHardTimeoutSeq;
    this.inFlightImageHardTimeout = setTimeout(() => {
      if (timeoutSeq !== this.inFlightImageHardTimeoutSeq) return;
      if (!this.isSendingImage) return;
      if (this.inFlightImage !== inFlight) return;
      this.inFlightImageHardTimeoutTriggered = true;
      this.perfHardWedgeTrips += 1;
      inFlight.abandoned = true;
      const elapsedMs = nowMs() - inFlight.sendStartedAtMs;
      if (PERF_BRIDGE_ENABLED) {
        perfLogLazyIfEnabled?.(
          () =>
            `[Perf][Bridge][Wedge] active=y cid=${inFlight.queued.data.containerID ?? -1} ` +
            `elapsed=${elapsedMs.toFixed(1)}ms qwait=${inFlight.queueWaitMs.toFixed(1)}ms pending=${this.getImageQueueDepth()}`,
        );
      }
      this.setImageInterrupted(true, 'hard-wedge-send');
      this.setImageSendWedged(true, 'hard-wedge-send');
      this.dropQueuedImagesForHardWedge();
      this.pruneQueuedImagesForInterruption();

      // Detach the current runner so the app does not stay permanently "busy".
      if (this.activeImageQueueRunnerId === inFlight.runnerId) {
        this.activeImageQueueRunnerId += 1;
      }
      this.isSendingImage = false;
      this.activeSendKind = null;
      this.disarmImageSendWatchdog();
    }, IMAGE_SEND_HARD_WEDGE_TRIGGER_MS);
  }

  private disarmImageSendWatchdog(completed?: { cid: number | null | undefined; sendMs: number }): void {
    if (this.inFlightImageWatchdog) {
      clearTimeout(this.inFlightImageWatchdog);
      this.inFlightImageWatchdog = null;
    }
    this.inFlightImageWatchdogSeq += 1;
    if (this.inFlightImageWatchdogTriggered && completed && PERF_BRIDGE_ENABLED) {
      perfLogLazyIfEnabled?.(
        () => `[Perf][Bridge][Watchdog] active=n cid=${completed.cid ?? -1} send=${completed.sendMs.toFixed(1)}ms`,
      );
    }
    this.inFlightImageWatchdogTriggered = false;
  }

  private disarmImageSendHardTimeout(completed?: { cid: number | null | undefined; sendMs: number; abandoned?: boolean }): void {
    if (this.inFlightImageHardTimeout) {
      clearTimeout(this.inFlightImageHardTimeout);
      this.inFlightImageHardTimeout = null;
    }
    this.inFlightImageHardTimeoutSeq += 1;
    if (this.inFlightImageHardTimeoutTriggered && completed && PERF_BRIDGE_ENABLED) {
      perfLogLazyIfEnabled?.(
        () =>
          `[Perf][Bridge][Wedge] active=n cid=${completed.cid ?? -1} send=${completed.sendMs.toFixed(1)}ms ` +
          `abandoned=${completed.abandoned ? 'y' : 'n'}`,
      );
    }
    this.inFlightImageHardTimeoutTriggered = false;
  }

  private dropQueuedImagesForHardWedge(): void {
    let dropped = 0;
    for (let i = this.imageQueueHead; i < this.imageQueue.length; i++) {
      if (this.imageQueue[i]) {
        this.imageQueue[i] = null;
        dropped++;
      }
    }
    this.perfInterruptedDrops += dropped;
  }

  private shouldDropQueuedImageDuringInterruption(
    priority: ImageUpdatePriority,
    kind: ImageUpdateKind,
    interruptProtected: boolean,
  ): boolean {
    if (!this.imageInterrupted) return false;
    if (interruptProtected) return false;
    if (priority === 'high' && kind === 'board') return false;
    return priority !== 'high';
  }

  private pruneQueuedImagesForInterruption(): void {
    if (!this.imageInterrupted) return;

    let keptHighBudget = IMAGE_INTERRUPTION_MAX_QUEUED_IMAGES;
    let keptProtectedBudget = IMAGE_INTERRUPTION_MAX_PROTECTED_IMAGES;

    for (let i = this.imageQueueHead; i < this.imageQueue.length; i++) {
      const queued = this.imageQueue[i];
      if (!queued) continue;

      if (queued.interruptProtected && keptProtectedBudget > 0) {
        keptProtectedBudget--;
        if (queued.priority === 'high' && keptHighBudget > 0) {
          keptHighBudget--;
        }
        continue;
      }

      const isHigh = queued.priority === 'high';
      if (isHigh && keptHighBudget > 0) {
        keptHighBudget--;
        continue;
      }

      // Drop non-critical work while interrupted to keep the queue recoverable.
      if (!isHigh || queued.kind !== 'board') {
        this.imageQueue[i] = null;
        this.perfInterruptedDrops += 1;
        continue;
      }

      // Fallback: preserve at least one head item even if budgets are exhausted.
      if (i === this.imageQueueHead) {
        continue;
      }
      this.imageQueue[i] = null;
      this.perfInterruptedDrops += 1;
    }
  }

  private trimRecentWatchdogTrips(now: number): void {
    while (
      this.recentWatchdogTripAtMs.length > 0 &&
      now - (this.recentWatchdogTripAtMs[0] ?? 0) > IMAGE_SURVIVAL_MODE_WATCHDOG_WINDOW_MS
    ) {
      this.recentWatchdogTripAtMs.shift();
    }
  }

  private recordWatchdogTripForSurvival(): void {
    const now = nowMs();
    this.recentWatchdogTripAtMs.push(now);
    this.trimRecentWatchdogTrips(now);
    if (
      !this.imageSurvivalMode &&
      this.recentWatchdogTripAtMs.length >= IMAGE_SURVIVAL_MODE_TRIGGER_WATCHDOG_TRIPS &&
      (this.boardLinkSlow || this.imageInterrupted)
    ) {
      this.setImageSurvivalMode(true, 'watchdog-burst');
    }
  }

  private updateSurvivalMode(): void {
    const now = nowMs();
    this.trimRecentWatchdogTrips(now);
    if (!this.imageSurvivalMode) {
      if (
        this.recentWatchdogTripAtMs.length >= IMAGE_SURVIVAL_MODE_TRIGGER_WATCHDOG_TRIPS &&
        (this.boardLinkSlow || this.imageInterrupted)
      ) {
        this.setImageSurvivalMode(true, 'watchdog-burst');
      }
      return;
    }
    const lastTripAtMs = this.recentWatchdogTripAtMs[this.recentWatchdogTripAtMs.length - 1] ?? 0;
    const quietLongEnough = lastTripAtMs === 0 || now - lastTripAtMs >= IMAGE_SURVIVAL_MODE_RECOVER_QUIET_MS;
    if (!this.boardLinkSlow && !this.imageInterrupted && this.getImageQueueDepth() <= 0 && quietLongEnough) {
      this.setImageSurvivalMode(false, 'recovered');
    }
  }

  private setImageInterrupted(active: boolean, reason: string): void {
    if (this.imageInterrupted === active) return;
    this.imageInterrupted = active;
    this.imageInterruptedRecoveryGoodSends = 0;
    if (active) {
      this.pruneQueuedImagesForInterruption();
    }
    if (PERF_BRIDGE_ENABLED) {
      perfLogLazyIfEnabled?.(() => `[Perf][Bridge][Interrupt] active=${active ? 'y' : 'n'} reason=${reason}`);
    }
    for (const listener of this.imageInterruptionListeners) {
      try {
        listener(active);
      } catch {
        // Best-effort listener notification only.
      }
    }
  }

  private setImageSendWedged(active: boolean, reason: string): void {
    if (this.imageSendWedged === active) return;
    this.imageSendWedged = active;
    if (PERF_BRIDGE_ENABLED) {
      perfLogLazyIfEnabled?.(() => `[Perf][Bridge][Wedge] active=${active ? 'y' : 'n'} reason=${reason}`);
    }
  }

  private setImageSurvivalMode(active: boolean, reason: string): void {
    if (this.imageSurvivalMode === active) return;
    this.imageSurvivalMode = active;
    if (PERF_BRIDGE_ENABLED) {
      perfLogLazyIfEnabled?.(
        () =>
          `[Perf][Bridge][Survival] active=${active ? 'y' : 'n'} reason=${reason} watchdogs=${this.recentWatchdogTripAtMs.length}`,
      );
    }
  }

  private updateInterruptionState(queueWaitMs: number, sendMs: number): void {
    const totalMs = queueWaitMs + sendMs;
    const slowSend = sendMs >= IMAGE_INTERRUPTION_TRIGGER_SEND_MS;
    const slowTotal = totalMs >= IMAGE_INTERRUPTION_TRIGGER_TOTAL_MS;

    if (slowSend || slowTotal) {
      this.imageInterruptedRecoveryGoodSends = 0;
      this.setImageInterrupted(true, slowSend ? 'slow-send' : 'slow-total');
      this.updateSurvivalMode();
      return;
    }

    if (!this.imageInterrupted) {
      this.updateSurvivalMode();
      return;
    }

    const good =
      sendMs <= IMAGE_INTERRUPTION_RECOVER_MAX_SEND_MS &&
      queueWaitMs <= IMAGE_INTERRUPTION_RECOVER_MAX_QWAIT_MS;
    this.imageInterruptedRecoveryGoodSends = good ? this.imageInterruptedRecoveryGoodSends + 1 : 0;

    if (this.imageInterruptedRecoveryGoodSends >= IMAGE_INTERRUPTION_RECOVER_GOOD_SENDS && this.getImageQueueDepth() <= 1) {
      this.setImageInterrupted(false, 'recovered');
    }
    this.updateSurvivalMode();
  }

  private recordImagePerf(
    data: ImageRawDataUpdate,
    kind: ImageUpdateKind,
    queueWaitMs: number,
    sendMs: number,
    resultOk: boolean,
  ): void {
    this.updateInterruptionState(queueWaitMs, sendMs);
    if (kind === 'board') {
      this.updateBoardHealth(queueWaitMs, sendMs);
    }

    // Consecutive non-ok BLE results are a strong dead-link signal.
    if (!resultOk) {
      this.consecutiveNonOkSendCount += 1;
    } else {
      this.consecutiveNonOkSendCount = 0;
      this.lastSuccessfulImageSendAtMs = nowMs();
    }

    // If the link enters repeated long stalls, clear stale queue work so recovery can repaint fresh state.
    if (sendMs >= IMAGE_CONSECUTIVE_STALL_THRESHOLD_MS) {
      this.consecutiveStallCount += 1;
      if (this.consecutiveStallCount >= IMAGE_CONSECUTIVE_STALL_COUNT) {
        this.consecutiveStallCount = 0;
        this.dropQueuedImagesForHardWedge();
        this.pruneQueuedImagesForInterruption();
      }
    } else {
      this.consecutiveStallCount = 0;
    }

    if (!PERF_BRIDGE_ENABLED) return;

    const bytes = imagePayloadBytes(data.imageData);
    this.perfImageCount++;
    this.perfTotalBytes += bytes;
    this.perfTotalQueueWaitMs += queueWaitMs;
    this.perfTotalSendMs += sendMs;

    const totalMs = queueWaitMs + sendMs;
    const pendingDepth = this.getImageQueueDepth();
    if (totalMs >= PERF_BRIDGE_LOG_SLOW_IMAGE_MS || pendingDepth > 0) {
      perfLogLazyIfEnabled?.(
        () =>
          `[Perf][Bridge][Image] cid=${data.containerID} bytes=${bytes} qwait=${queueWaitMs.toFixed(1)}ms ` +
          `send=${sendMs.toFixed(1)}ms total=${totalMs.toFixed(1)}ms pending=${pendingDepth}`,
      );
    }

    if (this.perfImageCount % PERF_BRIDGE_SUMMARY_EVERY_IMAGES !== 0) return;

    const elapsedMs = Math.max(1, nowMs() - this.perfWindowStartMs);
    const avgQueueWaitMs = this.perfTotalQueueWaitMs / this.perfImageCount;
    const avgSendMs = this.perfTotalSendMs / this.perfImageCount;
    const avgBytes = Math.round(this.perfTotalBytes / this.perfImageCount);
    const throughputKbps = (this.perfTotalBytes / elapsedMs) * 1000 / 1024;

    perfLogLazyIfEnabled?.(
      () =>
        `[Perf][Bridge][Summary] images=${this.perfImageCount} avgBytes=${avgBytes} ` +
        `avgQueueWait=${avgQueueWaitMs.toFixed(1)}ms avgSend=${avgSendMs.toFixed(1)}ms ` +
        `throughput=${throughputKbps.toFixed(1)}KB/s maxQueue=${this.perfMaxQueueDepth} coalesced=${this.perfCoalesced}` +
        (this.perfInterruptedDrops > 0 ? ` dropped=${this.perfInterruptedDrops}` : '') +
        (this.perfWatchdogTrips > 0 ? ` watchdog=${this.perfWatchdogTrips}` : '') +
        (this.perfHardWedgeTrips > 0 ? ` hardWedge=${this.perfHardWedgeTrips}` : '') +
        ` backlog=${this.boardQueueBacklogged ? 'y' : 'n'} linkSlow=${this.boardLinkSlow ? 'y' : 'n'} ` +
        `interrupted=${this.imageInterrupted ? 'y' : 'n'} wedged=${this.imageSendWedged ? 'y' : 'n'} survival=${this.imageSurvivalMode ? 'y' : 'n'}` +
        (this.perfBleGapCount > 0 ? ` bleGaps=${this.perfBleGapCount}/${this.perfBleGapTotalMs.toFixed(0)}ms` : '') +
        (this.perfTextGateBlocks > 0 ? ` textGate=${this.perfTextGateBlocks}/${this.perfTextGateTotalMs.toFixed(0)}ms` : ''),
    );

    this.perfWindowStartMs = nowMs();
    this.perfImageCount = 0;
    this.perfTotalBytes = 0;
    this.perfTotalQueueWaitMs = 0;
    this.perfTotalSendMs = 0;
    this.perfMaxQueueDepth = 0;
    this.perfCoalesced = 0;
    this.perfInterruptedDrops = 0;
    this.perfWatchdogTrips = 0;
    this.perfHardWedgeTrips = 0;
    this.perfBleGapCount = 0;
    this.perfBleGapTotalMs = 0;
    this.perfTextGateBlocks = 0;
    this.perfTextGateTotalMs = 0;
  }

  private enqueueImageUpdate(
    data: ImageRawDataUpdate,
    options?: {
      priority?: ImageUpdatePriority;
      kind?: ImageUpdateKind;
      interruptProtected?: boolean;
    }
  ): void {
    const kind =
      options?.kind ??
      (data.containerID === 4
        ? 'branding'
        : (data.containerID === 2 || data.containerID === 3)
          ? 'board'
          : 'other');
    const priority = options?.priority === 'low' ? 'low' : 'high';
    const interruptProtected = options?.interruptProtected === true;

    if (this.shouldDropQueuedImageDuringInterruption(priority, kind, interruptProtected)) {
      this.perfInterruptedDrops += 1;
      return;
    }

    const queuedEntry: QueuedImageUpdate = {
      data,
      enqueuedAtMs: nowMs(),
      priority,
      kind,
      interruptProtected,
    };

    // Coalesce stale pending frames per container (keep newest unsent image only).
    // This matters most for rapid board selection updates on slow links.
    this.coalescePendingForEnqueue(queuedEntry);

    if (queuedEntry.priority === 'low') {
      this.imageQueue.push(queuedEntry);
    } else {
      // Insert high-priority board images ahead of pending low-priority branding/tail work.
      let insertAt = this.imageQueue.length;
      for (let i = this.imageQueueHead; i < this.imageQueue.length; i++) {
        const queued = this.imageQueue[i];
        if (queued && queued.priority === 'low') {
          insertAt = i;
          break;
        }
      }
      if (insertAt === this.imageQueue.length) {
        this.imageQueue.push(queuedEntry);
      } else {
        this.imageQueue.splice(insertAt, 0, queuedEntry);
      }
    }

    if (this.imageInterrupted) {
      this.pruneQueuedImagesForInterruption();
    }

    this.perfMaxQueueDepth = Math.max(this.perfMaxQueueDepth, this.getImageQueueDepth());
  }

  private updateBoardHealth(queueWaitMs: number, sendMs: number): void {
    this.recentBoardQueueWaitMs.push(queueWaitMs);
    this.recentBoardSendMs.push(sendMs);
    if (this.recentBoardQueueWaitMs.length > BOARD_HEALTH_WINDOW_SAMPLES) {
      this.recentBoardQueueWaitMs.shift();
    }
    if (this.recentBoardSendMs.length > BOARD_HEALTH_WINDOW_SAMPLES) {
      this.recentBoardSendMs.shift();
    }

    const pendingDepth = this.getImageQueueDepth();
    const sampleCount = Math.min(this.recentBoardSendMs.length, this.recentBoardQueueWaitMs.length);
    if (sampleCount < BOARD_HEALTH_MIN_SAMPLES) {
      if (pendingDepth >= BOARD_BACKLOG_DEGRADED_QUEUE_DEPTH) {
        this.boardQueueBacklogged = true;
      }
      this.boardLinkDegraded = this.boardQueueBacklogged || this.boardLinkSlow || this.imageInterrupted || this.imageSendWedged;
      this.updateSurvivalMode();
      return;
    }

    const avgSendMs = this.recentBoardSendMs.reduce((sum, ms) => sum + ms, 0) / sampleCount;
    const maxSendMs = this.recentBoardSendMs.reduce((max, ms) => Math.max(max, ms), 0);
    const avgQueueWaitMs = this.recentBoardQueueWaitMs.reduce((sum, ms) => sum + ms, 0) / sampleCount;
    const maxQueueWaitMs = this.recentBoardQueueWaitMs.reduce((max, ms) => Math.max(max, ms), 0);

    if (this.boardHealthIgnoredSamplesRemaining > 0) {
      this.boardHealthIgnoredSamplesRemaining -= 1;
      // Do not let cold-start outliers flip the degraded/linkSlow latch, but still track queue pressure baseline.
      this.boardQueueBacklogged = pendingDepth >= BOARD_BACKLOG_DEGRADED_QUEUE_DEPTH;
      this.boardLinkDegraded = this.boardQueueBacklogged || this.boardLinkSlow || this.imageInterrupted || this.imageSendWedged;
      this.updateSurvivalMode();
      return;
    }

    const nextLinkSlow = this.boardLinkSlow
      ? !(avgSendMs <= BOARD_RECOVER_AVG_SEND_MS && maxSendMs <= BOARD_LINK_SLOW_RECOVER_MAX_SEND_MS)
      : avgSendMs >= BOARD_DEGRADED_AVG_SEND_MS || maxSendMs >= BOARD_LINK_SLOW_DEGRADED_MAX_SEND_MS;
    this.boardLinkSlow = nextLinkSlow;

    const nextBacklogged = this.boardQueueBacklogged
      ? !(
          pendingDepth <= BOARD_BACKLOG_RECOVER_QUEUE_DEPTH &&
          avgQueueWaitMs <= BOARD_RECOVER_AVG_QWAIT_MS &&
          maxQueueWaitMs <= BOARD_RECOVER_MAX_QWAIT_MS
        )
      : (
          pendingDepth >= BOARD_BACKLOG_DEGRADED_QUEUE_DEPTH ||
          avgQueueWaitMs >= BOARD_DEGRADED_AVG_QWAIT_MS ||
          maxQueueWaitMs >= BOARD_DEGRADED_MAX_QWAIT_MS
        );
    this.boardQueueBacklogged = nextBacklogged;

    const healthWantsDegraded =
      this.boardLinkSlow ||
      this.boardQueueBacklogged ||
      avgSendMs >= BOARD_DEGRADED_AVG_SEND_MS ||
      avgQueueWaitMs >= BOARD_DEGRADED_AVG_QWAIT_MS ||
      maxQueueWaitMs >= BOARD_DEGRADED_MAX_QWAIT_MS;

    if (healthWantsDegraded) {
      this.boardDegradedConfirmWindows = Math.min(BOARD_DEGRADED_CONFIRM_WINDOWS, this.boardDegradedConfirmWindows + 1);
    } else {
      this.boardDegradedConfirmWindows = 0;
    }

    const confirmedDegraded = this.boardLinkDegraded
      ? !(avgSendMs <= BOARD_RECOVER_AVG_SEND_MS && avgQueueWaitMs <= BOARD_RECOVER_AVG_QWAIT_MS && maxQueueWaitMs <= BOARD_RECOVER_MAX_QWAIT_MS) || this.boardQueueBacklogged || this.boardLinkSlow
      : this.boardDegradedConfirmWindows >= BOARD_DEGRADED_CONFIRM_WINDOWS;

    this.boardLinkDegraded = confirmedDegraded || this.imageInterrupted || this.imageSendWedged;
    this.updateSurvivalMode();
  }

  private coalescePendingForEnqueue(next: QueuedImageUpdate): void {
    // Only drop the newest older frame for the same container. We keep relative ordering across containers.
    // This avoids sending stale top/bottom frames while preserving "board before branding tail" behavior.
    let sameContainerDropped = false;
    for (let i = this.imageQueue.length - 1; i >= this.imageQueueHead; i--) {
      const queued = this.imageQueue[i];
      if (!queued) continue;

      if (!sameContainerDropped && queued.data.containerID === next.data.containerID) {
        // Keep the newer state, and preserve stronger priority / interruption protection on the replacement.
        if (queued.priority === 'high') next.priority = 'high';
        if (queued.interruptProtected) next.interruptProtected = true;
        this.imageQueue[i] = null; // preserve relative order of newer enqueues
        this.perfCoalesced++;
        sameContainerDropped = true;
      }
    }
  }

  subscribeEvents(handler: EvenHubEventHandler): void {
    this.unsubscribeEvents?.();

    if (!this.bridge) {
      console.log('[EvenHubBridge] No bridge — skipping event subscription.');
      return;
    }

    try {
      this.unsubscribeEvents = this.bridge.onEvenHubEvent((event) => {
        handler(event);
      });
    } catch (err) {
      console.error('[EvenHubBridge] Event subscription error:', err);
      this.unsubscribeEvents = null;
    }
  }

  async shutdown(): Promise<void> {
    this.disarmImageSendWatchdog();
    this.disarmImageSendHardTimeout();
    this.forceResetImageTransport('shutdown');
    if (this.textResumeTimer) {
      clearTimeout(this.textResumeTimer);
      this.textResumeTimer = null;
    }
    this.textQueue.clear();
    this.isSendingText = false;
    this.textSendBlocked = false;
    this.inFlightTextUpdate = null;
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;

    if (this.bridge) {
      try {
        await this.bridge.shutDownPageContainer(0);
      } catch (err) {
        console.error('[EvenHubBridge] shutDown error:', err);
      }
    }
  }
}
