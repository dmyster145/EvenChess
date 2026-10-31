import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mapListEvent,
  mapTextEvent,
  mapSysEvent,
  mapEvenHubEvent,
  resetScrollDebounce,
  resetTapCooldown,
  resetScrollSuppression,
  resetInputDedup,
  extendTapCooldown,
  TAP_COOLDOWN_MS,
  TAP_COOLDOWN_MENU_MS,
} from '../../src/input/actions';
import { OsEventTypeList, List_ItemEvent, Text_ItemEvent, Sys_ItemEvent, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import type { GameState } from '../../src/state/contracts';
import { baseGameState } from '../helpers/game-state';

// The mappers read the current phase (selection phases dedupe scrolls more aggressively); the
// idle state is the neutral default for these tests.
const idle = baseGameState();
const rowSelect: GameState = { ...idle, phase: 'rowSelect' };

const list = (eventType: OsEventTypeList) => new List_ItemEvent({ eventType });
const text = (eventType: OsEventTypeList) => new Text_ItemEvent({ eventType });
const sys = (eventType: OsEventTypeList) => new Sys_ItemEvent({ eventType });

const { SCROLL_TOP_EVENT, SCROLL_BOTTOM_EVENT, CLICK_EVENT, DOUBLE_CLICK_EVENT } = OsEventTypeList;
const DOWN = { type: 'SCROLL', direction: 'down' } as const;
const UP = { type: 'SCROLL', direction: 'up' } as const;
const TAP = { type: 'TAP' } as const;
const DOUBLE_TAP = { type: 'DOUBLE_TAP' } as const;

// Every filter in the mapper is time-based, so the clock is frozen for every test and moved
// explicitly with `at(ms)` (milliseconds since the test started).
const T0 = 1_000_000;
const at = (ms: number) => vi.setSystemTime(T0 + ms);

describe('input/actions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    at(0);
    resetScrollDebounce();
    resetTapCooldown();
    resetScrollSuppression();
    resetInputDedup();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('mapListEvent', () => {
    it('maps CLICK_EVENT to TAP', () => {
      const event = new List_ItemEvent({
        eventType: CLICK_EVENT,
        currentSelectItemIndex: 2,
        currentSelectItemName: 'Nf3',
      });
      expect(mapListEvent(event, idle)).toEqual(TAP);
    });

    it('maps DOUBLE_CLICK_EVENT to DOUBLE_TAP', () => {
      expect(mapListEvent(list(DOUBLE_CLICK_EVENT), idle)).toEqual(DOUBLE_TAP);
    });

    // Note: the app intentionally maps SCROLL_TOP_EVENT → 'down' and
    // SCROLL_BOTTOM_EVENT → 'up' (see 2f8a55c "Performance improvements"),
    // matching the G2 touchpad's physical gesture direction.
    it('maps SCROLL_TOP_EVENT to SCROLL down', () => {
      expect(mapListEvent(list(SCROLL_TOP_EVENT), idle)).toEqual(DOWN);
    });

    it('maps SCROLL_BOTTOM_EVENT to SCROLL up', () => {
      expect(mapListEvent(list(SCROLL_BOTTOM_EVENT), idle)).toEqual(UP);
    });

    it('returns null for unknown event types', () => {
      expect(mapListEvent(list(OsEventTypeList.ABNORMAL_EXIT_EVENT), idle)).toBeNull();
    });
  });

  describe('mapTextEvent', () => {
    it('treats a missing eventType as CLICK_EVENT (protobuf omits the zero value)', () => {
      expect(mapTextEvent(new Text_ItemEvent({}), idle)).toEqual(TAP);
    });

    it('maps CLICK_EVENT to TAP', () => {
      expect(mapTextEvent(text(CLICK_EVENT), idle)).toEqual(TAP);
    });

    it('maps SCROLL_TOP_EVENT to SCROLL down', () => {
      expect(mapTextEvent(text(SCROLL_TOP_EVENT), idle)).toEqual(DOWN);
    });

    it('maps SCROLL_BOTTOM_EVENT to SCROLL up', () => {
      expect(mapTextEvent(text(SCROLL_BOTTOM_EVENT), idle)).toEqual(UP);
    });

    it('maps DOUBLE_CLICK_EVENT to DOUBLE_TAP', () => {
      expect(mapTextEvent(text(DOUBLE_CLICK_EVENT), idle)).toEqual(DOUBLE_TAP);
    });
  });

  describe('mapSysEvent', () => {
    it('maps FOREGROUND_ENTER_EVENT', () => {
      expect(mapSysEvent(sys(OsEventTypeList.FOREGROUND_ENTER_EVENT), idle)).toEqual({ type: 'FOREGROUND_ENTER' });
    });

    it('maps FOREGROUND_EXIT_EVENT', () => {
      expect(mapSysEvent(sys(OsEventTypeList.FOREGROUND_EXIT_EVENT), idle)).toEqual({ type: 'FOREGROUND_EXIT' });
    });

    // The R1 ring reports gestures on the sys channel; directions must match list and text.
    it('maps SCROLL_TOP_EVENT to SCROLL down', () => {
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), idle)).toEqual(DOWN);
    });

    it('maps SCROLL_BOTTOM_EVENT to SCROLL up', () => {
      expect(mapSysEvent(sys(SCROLL_BOTTOM_EVENT), idle)).toEqual(UP);
    });

    it('maps CLICK_EVENT and DOUBLE_CLICK_EVENT to TAP and DOUBLE_TAP', () => {
      expect(mapSysEvent(sys(CLICK_EVENT), idle)).toEqual(TAP);
      expect(mapSysEvent(sys(DOUBLE_CLICK_EVENT), idle)).toEqual(DOUBLE_TAP);
    });
  });

  describe('mapEvenHubEvent', () => {
    it('routes a listEvent through the list mapper', () => {
      const event = { listEvent: list(SCROLL_TOP_EVENT) } as EvenHubEvent;
      expect(mapEvenHubEvent(event, idle)).toEqual(DOWN);
    });

    it('routes a textEvent through the text mapper', () => {
      const event = { textEvent: text(SCROLL_BOTTOM_EVENT) } as EvenHubEvent;
      expect(mapEvenHubEvent(event, idle)).toEqual(UP);
    });

    it('routes a sysEvent through the sys mapper', () => {
      const event = { sysEvent: sys(OsEventTypeList.FOREGROUND_EXIT_EVENT) } as EvenHubEvent;
      expect(mapEvenHubEvent(event, idle)).toEqual({ type: 'FOREGROUND_EXIT' });
    });

    it('returns null for an event with no list, text, or sys payload', () => {
      expect(mapEvenHubEvent({} as EvenHubEvent, idle)).toBeNull();
    });
  });

  // Per ER guidance the firmware sends each physical tap twice, ~50–100ms apart.
  describe('firmware duplicate tap dedup', () => {
    it('drops a CLICK 129ms after the first and accepts one at 130ms', () => {
      expect(mapSysEvent(sys(CLICK_EVENT), idle)).toEqual(TAP);
      at(129);
      expect(mapSysEvent(sys(CLICK_EVENT), idle)).toBeNull();
      at(130);
      expect(mapSysEvent(sys(CLICK_EVENT), idle)).toEqual(TAP);
    });

    it('drops a DOUBLE_CLICK 599ms after the first and accepts one at 600ms', () => {
      // Without this, one double-tap from idle would open the menu and its echo would close it.
      expect(mapSysEvent(sys(DOUBLE_CLICK_EVENT), idle)).toEqual(DOUBLE_TAP);
      at(599);
      expect(mapSysEvent(sys(DOUBLE_CLICK_EVENT), idle)).toBeNull();
      at(600);
      expect(mapSysEvent(sys(DOUBLE_CLICK_EVENT), idle)).toEqual(DOUBLE_TAP);
    });

    it('dedups across channels: a text CLICK echo of a list CLICK is dropped', () => {
      expect(mapListEvent(list(CLICK_EVENT), idle)).toEqual(TAP);
      at(50);
      expect(mapTextEvent(text(CLICK_EVENT), idle)).toBeNull();
    });
  });

  describe('tap cooldown', () => {
    it('drops taps until an extended cooldown (e.g. after opening the menu) has passed', () => {
      extendTapCooldown(TAP_COOLDOWN_MENU_MS);
      expect(mapSysEvent(sys(CLICK_EVENT), idle)).toBeNull();
      at(TAP_COOLDOWN_MENU_MS - 1);
      expect(mapSysEvent(sys(DOUBLE_CLICK_EVENT), idle)).toBeNull();
      at(TAP_COOLDOWN_MENU_MS);
      expect(mapSysEvent(sys(CLICK_EVENT), idle)).toEqual(TAP);
    });

    it('a shorter extendTapCooldown does not cut an active longer cooldown short', () => {
      extendTapCooldown(TAP_COOLDOWN_MENU_MS);
      extendTapCooldown(TAP_COOLDOWN_MS);
      at(TAP_COOLDOWN_MS + 50);
      expect(mapSysEvent(sys(CLICK_EVENT), idle)).toBeNull();
    });
  });

  describe('scroll filters (one physical swipe = one SCROLL)', () => {
    it('in rowSelect, a same-direction scroll within 500ms is the tail of the same swipe', () => {
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), rowSelect)).toEqual(DOWN);
      at(450);
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), rowSelect)).toBeNull();
      at(500);
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), rowSelect)).toEqual(DOWN);
    });

    it.each(['rowSelect', 'pieceSelect', 'destSelect', 'promotionSelect'] as const)(
      '%s uses the 500ms same-direction window',
      (phase) => {
        const state: GameState = { ...idle, phase };
        expect(mapListEvent(list(SCROLL_BOTTOM_EVENT), state)).toEqual(UP);
        at(300);
        expect(mapListEvent(list(SCROLL_BOTTOM_EVENT), state)).toBeNull();
      },
    );

    it('outside selection phases, the same-direction window is 12ms', () => {
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), idle)).toEqual(DOWN);
      at(11);
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), idle)).toBeNull();
      at(30);
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), idle)).toEqual(DOWN);
    });

    it('a dropped tail event does not extend the window: the next swipe is timed from the accepted one', () => {
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), rowSelect)).toEqual(DOWN);
      at(400);
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), rowSelect)).toBeNull();
      at(550);
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), rowSelect)).toEqual(DOWN);
    });

    it('in rowSelect, an opposite-direction scroll is accepted at once (not deduped)', () => {
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), rowSelect)).toEqual(DOWN);
      at(100);
      expect(mapSysEvent(sys(SCROLL_BOTTOM_EVENT), rowSelect)).toEqual(UP);
    });

    it('drops any scroll within 8ms of the previous raw scroll event, even in the other direction', () => {
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), idle)).toEqual(DOWN);
      at(7);
      expect(mapSysEvent(sys(SCROLL_BOTTOM_EVENT), idle)).toBeNull();
      at(20);
      expect(mapSysEvent(sys(SCROLL_BOTTOM_EVENT), idle)).toEqual(UP);
    });
  });

  describe('scroll suppression after a tap (R1 ring bleed)', () => {
    it('drops a scroll within 150ms of a tap and accepts one at 150ms', () => {
      expect(mapSysEvent(sys(CLICK_EVENT), idle)).toEqual(TAP);
      at(149);
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), idle)).toBeNull();
      at(150);
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), idle)).toEqual(DOWN);
    });

    it('a scroll dropped after a tap does not start the 500ms selection window', () => {
      expect(mapSysEvent(sys(CLICK_EVENT), rowSelect)).toEqual(TAP);
      at(100);
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), rowSelect)).toBeNull(); // bleed
      at(300);
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), rowSelect)).toEqual(DOWN);
    });

    it('a tap dropped by the cooldown still suppresses scrolls right after it', () => {
      extendTapCooldown(TAP_COOLDOWN_MENU_MS);
      expect(mapSysEvent(sys(CLICK_EVENT), idle)).toBeNull();
      at(100);
      expect(mapSysEvent(sys(SCROLL_TOP_EVENT), idle)).toBeNull();
    });
  });
});
