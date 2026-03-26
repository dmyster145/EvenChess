/**
 * Input mapper — translates Even Hub SDK events into app-level Actions.
 */

import {
  OsEventTypeList,
  type EvenHubEvent,
  type List_ItemEvent,
  type Text_ItemEvent,
  type Sys_ItemEvent,
} from '@evenrealities/even_hub_sdk';
import type { Action, GameState } from '../state/contracts';

// G2 touch input can emit very short burst duplicates (raw event chatter + delayed duplicate swipes).
// We use a two-stage filter:
// 1) raw burst debounce (few ms)
// 2) accepted same-direction dedupe (phase-tuned)
const DEBOUNCE_MS = 8;
// Glasses can sometimes emit a duplicate same-direction scroll a few frames later.
// Use a smaller window while selecting on the board so fast swipes still feel responsive.
const SAME_DIRECTION_SCROLL_DEDUPE_MS_DEFAULT = 12;
const SAME_DIRECTION_SCROLL_DEDUPE_MS_SELECTION = 5;
let lastRawScrollEventTime = 0;
let lastAcceptedScrollTime = 0;
let lastAcceptedScrollDirection: 'up' | 'down' | null = null;

function isSelectionPhase(state: GameState): boolean {
  return state.phase === 'pieceSelect' || state.phase === 'destSelect' || state.phase === 'promotionSelect';
}

function sameDirectionScrollDedupeMs(state: GameState): number {
  return isSelectionPhase(state) ? SAME_DIRECTION_SCROLL_DEDUPE_MS_SELECTION : SAME_DIRECTION_SCROLL_DEDUPE_MS_DEFAULT;
}

function isScrollDebounced(direction: 'up' | 'down', state: GameState): boolean {
  const now = Date.now();
  const rawDt = now - lastRawScrollEventTime;
  lastRawScrollEventTime = now;
  if (rawDt < DEBOUNCE_MS) {
    return true;
  }
  const acceptedDt = now - lastAcceptedScrollTime;
  if (lastAcceptedScrollDirection === direction && acceptedDt < sameDirectionScrollDedupeMs(state)) {
    return true;
  }
  // Important: only accepted scrolls advance this timestamp. Suppressed duplicates should not "extend" stickiness.
  lastAcceptedScrollTime = now;
  lastAcceptedScrollDirection = direction;
  return false;
}

export function resetScrollDebounce(): void {
  lastRawScrollEventTime = 0;
  lastAcceptedScrollTime = 0;
  lastAcceptedScrollDirection = null;
}

/** Base cooldown after any tap (shorter = snappier, higher risk of accidental double-tap). */
export const TAP_COOLDOWN_MS = 220;
/** Extended cooldown when opening menu (prevents accidental first menu selection). */
export const TAP_COOLDOWN_MENU_MS = 500;
/** Extended cooldown when entering destSelect (prevents accidental move confirm). */
export const TAP_COOLDOWN_DESTSELECT_MS = 280;
let tapCooldownUntil = 0;

// Prevents accidental selections from continued tapping after menu opens
export function extendTapCooldown(durationMs: number = TAP_COOLDOWN_MS): void {
  const newCooldownUntil = Date.now() + durationMs;
  if (newCooldownUntil > tapCooldownUntil) {
    tapCooldownUntil = newCooldownUntil;
  }
}

function isInTapCooldown(): boolean {
  return Date.now() < tapCooldownUntil;
}

/** Returns false if tap was suppressed by cooldown; otherwise records tap and returns true.
 * Note: scroll-suppression currently uses raw tap attempts (accepted or suppressed) to avoid accidental swipe bleed-through. */
function tryConsumeTap(_intendedActionType: 'TAP' | 'DOUBLE_TAP'): boolean {
  recordTap();
  if (isInTapCooldown()) {
    return false;
  }
  return true;
}

export function resetTapCooldown(): void {
  tapCooldownUntil = 0;
}

export function resetScrollSuppression(): void {
  lastTapTime = 0;
}

// R1 ring can generate scroll events during double-tap
const SCROLL_SUPPRESS_AFTER_TAP_MS = 150;
let lastTapTime = 0;

function recordTap(): void {
  lastTapTime = Date.now();
}

function isScrollSuppressed(): boolean {
  return Date.now() - lastTapTime < SCROLL_SUPPRESS_AFTER_TAP_MS;
}

const DEBUG_EVENTS = false;

export function mapEvenHubEvent(event: EvenHubEvent, state: GameState): Action | null {
  if (!event) {
    console.warn('[InputMapper] Received null/undefined event');
    return null;
  }

  if (DEBUG_EVENTS) {
    console.log('[InputMapper] Raw event:', JSON.stringify(event));
  }

  try {
    let action: Action | null = null;
    if (event.listEvent) {
      if (DEBUG_EVENTS) {
        console.log('[InputMapper] listEvent:', event.listEvent.eventType, event.listEvent);
      }
      action = mapListEvent(event.listEvent, state);
    } else if (event.textEvent) {
      if (DEBUG_EVENTS) {
        console.log('[InputMapper] textEvent:', event.textEvent.eventType, event.textEvent);
      }
      action = mapTextEvent(event.textEvent, state);
    } else if (event.sysEvent) {
      if (DEBUG_EVENTS) {
        console.log('[InputMapper] sysEvent:', event.sysEvent.eventType, event.sysEvent);
      }
      action = mapSysEvent(event.sysEvent, state);
    }
    return action;
  } catch (err) {
    console.error('[InputMapper] Error processing event:', err);
    return null;
  }
}

// Simulator sends clicks without eventType - just currentSelectItemIndex
export function mapListEvent(event: List_ItemEvent, state: GameState): Action | null {
  if (!event) return null;
  const eventType = event.eventType;

  switch (eventType) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      if (isScrollDebounced('down', state)) return null;
      if (isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'down' };

    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      if (isScrollDebounced('up', state)) return null;
      if (isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'up' };

    case OsEventTypeList.CLICK_EVENT: {
      if (!tryConsumeTap('TAP')) return null;
      return {
        type: 'TAP',
        selectedIndex: event.currentSelectItemIndex ?? 0,
        selectedName: event.currentSelectItemName ?? '',
      };
    }

    case OsEventTypeList.DOUBLE_CLICK_EVENT: {
      if (!tryConsumeTap('DOUBLE_TAP')) return null;
      return { type: 'DOUBLE_TAP' };
    }

    default:
      if (event.currentSelectItemIndex != null) {
        if (!tryConsumeTap('TAP')) return null;
        return {
          type: 'TAP',
          selectedIndex: event.currentSelectItemIndex,
          selectedName: event.currentSelectItemName ?? '',
        };
      }
      return null;
  }
}

export function mapTextEvent(event: Text_ItemEvent, state: GameState): Action | null {
  if (!event) return null;
  const eventType = event.eventType;

  switch (eventType) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      if (isScrollDebounced('down', state)) return null;
      if (isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'down' };

    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      if (isScrollDebounced('up', state)) return null;
      if (isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'up' };

    case OsEventTypeList.CLICK_EVENT: {
      if (!tryConsumeTap('TAP')) return null;
      return { type: 'TAP', selectedIndex: 0, selectedName: '' };
    }

    case OsEventTypeList.DOUBLE_CLICK_EVENT: {
      if (!tryConsumeTap('DOUBLE_TAP')) return null;
      return { type: 'DOUBLE_TAP' };
    }

    default:
      // G2: SDK can normalize CLICK_EVENT (0) to undefined; treat as tap so menu clicks work on device
      if (eventType == null) {
        if (!tryConsumeTap('TAP')) return null;
        return { type: 'TAP', selectedIndex: 0, selectedName: '' };
      }
      return null;
  }
}

// Simulator sends clicks as empty sysEvents
export function mapSysEvent(event: Sys_ItemEvent, state: GameState): Action | null {
  if (!event) return null;
  switch (event.eventType) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      if (isScrollDebounced('down', state)) return null;
      if (isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'down' };

    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      if (isScrollDebounced('up', state)) return null;
      if (isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'up' };

    case OsEventTypeList.CLICK_EVENT: {
      if (!tryConsumeTap('TAP')) return null;
      return { type: 'TAP', selectedIndex: 0, selectedName: '' };
    }

    case OsEventTypeList.DOUBLE_CLICK_EVENT: {
      if (!tryConsumeTap('DOUBLE_TAP')) return null;
      return { type: 'DOUBLE_TAP' };
    }

    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      return { type: 'FOREGROUND_ENTER' };

    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      return { type: 'FOREGROUND_EXIT' };

    default:
      if (event.eventType == null) {
        if (!tryConsumeTap('TAP')) return null;
        return { type: 'TAP', selectedIndex: 0, selectedName: '' };
      }
      return null;
  }
}
