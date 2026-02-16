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

const DEBOUNCE_MS = 15;
let lastScrollTime = 0;

function isScrollDebounced(): boolean {
  const now = Date.now();
  if (now - lastScrollTime < DEBOUNCE_MS) {
    return true;
  }
  lastScrollTime = now;
  return false;
}

export function resetScrollDebounce(): void {
  lastScrollTime = 0;
}

const TAP_COOLDOWN_MS = 400;
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

export function mapEvenHubEvent(event: EvenHubEvent, _state: GameState): Action | null {
  if (!event) {
    console.warn('[InputMapper] Received null/undefined event');
    return null;
  }

  if (DEBUG_EVENTS) {
    console.log('[InputMapper] Raw event:', JSON.stringify(event));
  }

  try {
    if (event.listEvent) {
      if (DEBUG_EVENTS) {
        console.log('[InputMapper] listEvent:', event.listEvent.eventType, event.listEvent);
      }
      return mapListEvent(event.listEvent);
    }
    if (event.textEvent) {
      if (DEBUG_EVENTS) {
        console.log('[InputMapper] textEvent:', event.textEvent.eventType, event.textEvent);
      }
      return mapTextEvent(event.textEvent);
    }
    if (event.sysEvent) {
      if (DEBUG_EVENTS) {
        console.log('[InputMapper] sysEvent:', event.sysEvent.eventType, event.sysEvent);
      }
      return mapSysEvent(event.sysEvent);
    }
    return null;
  } catch (err) {
    console.error('[InputMapper] Error processing event:', err);
    return null;
  }
}

// Simulator sends clicks without eventType - just currentSelectItemIndex
export function mapListEvent(event: List_ItemEvent): Action | null {
  if (!event) return null;
  const eventType = event.eventType;

  switch (eventType) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      if (isScrollDebounced()) return null;
      if (isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'up' };

    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      if (isScrollDebounced()) return null;
      if (isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'down' };

    case OsEventTypeList.CLICK_EVENT: {
      recordTap();
      if (isInTapCooldown()) return null;
      return {
        type: 'TAP',
        selectedIndex: event.currentSelectItemIndex ?? 0,
        selectedName: event.currentSelectItemName ?? '',
      };
    }

    case OsEventTypeList.DOUBLE_CLICK_EVENT: {
      recordTap();
      if (isInTapCooldown()) return null;
      return { type: 'DOUBLE_TAP' };
    }

    default:
      if (event.currentSelectItemIndex != null) {
        recordTap();
        if (isInTapCooldown()) return null;
        return {
          type: 'TAP',
          selectedIndex: event.currentSelectItemIndex,
          selectedName: event.currentSelectItemName ?? '',
        };
      }
      return null;
  }
}

export function mapTextEvent(event: Text_ItemEvent): Action | null {
  if (!event) return null;
  const eventType = event.eventType;

  switch (eventType) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      if (isScrollDebounced()) return null;
      if (isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'up' };

    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      if (isScrollDebounced()) return null;
      if (isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'down' };

    case OsEventTypeList.CLICK_EVENT: {
      recordTap();
      if (isInTapCooldown()) return null;
      return { type: 'TAP', selectedIndex: 0, selectedName: '' };
    }

    case OsEventTypeList.DOUBLE_CLICK_EVENT: {
      recordTap();
      if (isInTapCooldown()) return null;
      return { type: 'DOUBLE_TAP' };
    }

    default:
      return null;
  }
}

// Simulator sends clicks as empty sysEvents
export function mapSysEvent(event: Sys_ItemEvent): Action | null {
  if (!event) return null;
  switch (event.eventType) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      if (isScrollDebounced()) return null;
      if (isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'up' };

    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      if (isScrollDebounced()) return null;
      if (isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'down' };

    case OsEventTypeList.CLICK_EVENT: {
      recordTap();
      if (isInTapCooldown()) return null;
      return { type: 'TAP', selectedIndex: 0, selectedName: '' };
    }

    case OsEventTypeList.DOUBLE_CLICK_EVENT: {
      recordTap();
      if (isInTapCooldown()) return null;
      return { type: 'DOUBLE_TAP' };
    }

    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      return { type: 'FOREGROUND_ENTER' };

    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      return { type: 'FOREGROUND_EXIT' };

    default:
      if (event.eventType == null) {
        recordTap();
        if (isInTapCooldown()) return null;
        return { type: 'TAP', selectedIndex: 0, selectedName: '' };
      }
      return null;
  }
}
