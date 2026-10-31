import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mapListEvent, mapTextEvent, mapSysEvent, mapEvenHubEvent, resetScrollDebounce, resetTapCooldown, resetScrollSuppression, resetInputDedup, extendTapCooldown, TAP_COOLDOWN_MENU_MS } from '../../src/input/actions';
import { OsEventTypeList, List_ItemEvent, Text_ItemEvent, Sys_ItemEvent, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { buildInitialState } from '../../src/state/contracts';
import { ChessService } from '../../src/chess/chessservice';

// The mappers read the current phase (selection phases dedupe scrolls more aggressively); the
// idle state is the neutral default for these tests.
const idle = buildInitialState(new ChessService());

describe('input/actions', () => {
  beforeEach(() => {
    resetScrollDebounce();
    resetTapCooldown();
    resetScrollSuppression();
    resetInputDedup();
  });

  describe('mapListEvent', () => {
    it('maps CLICK_EVENT to TAP', () => {
      const event = new List_ItemEvent({
        eventType: OsEventTypeList.CLICK_EVENT,
        currentSelectItemIndex: 2,
        currentSelectItemName: 'Nf3',
      });
      expect(mapListEvent(event, idle)).toEqual({ type: 'TAP' });
    });

    it('maps DOUBLE_CLICK_EVENT to DOUBLE_TAP', () => {
      const event = new List_ItemEvent({
        eventType: OsEventTypeList.DOUBLE_CLICK_EVENT,
      });
      const action = mapListEvent(event, idle);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('DOUBLE_TAP');
    });

    // Note: the app intentionally maps SCROLL_TOP_EVENT → 'down' and
    // SCROLL_BOTTOM_EVENT → 'up' (see 2f8a55c "Performance improvements"),
    // matching the G2 touchpad's physical gesture direction.
    it('maps SCROLL_TOP_EVENT to SCROLL down', () => {
      const event = new List_ItemEvent({
        eventType: OsEventTypeList.SCROLL_TOP_EVENT,
      });
      const action = mapListEvent(event, idle);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('SCROLL');
      if (action!.type === 'SCROLL') {
        expect(action.direction).toBe('down');
      }
    });

    it('maps SCROLL_BOTTOM_EVENT to SCROLL up', () => {
      const event = new List_ItemEvent({
        eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT,
      });
      const action = mapListEvent(event, idle);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('SCROLL');
      if (action!.type === 'SCROLL') {
        expect(action.direction).toBe('up');
      }
    });

    it('returns null for unknown event types', () => {
      const event = new List_ItemEvent({
        eventType: OsEventTypeList.ABNORMAL_EXIT_EVENT,
      });
      const action = mapListEvent(event, idle);
      expect(action).toBeNull();
    });
  });

  describe('mapTextEvent', () => {
    it('treats a missing eventType as CLICK_EVENT (protobuf omits the zero value)', () => {
      expect(mapTextEvent(new Text_ItemEvent({}), idle)).toEqual({ type: 'TAP' });
    });

    it('maps CLICK_EVENT to TAP', () => {
      const event = new Text_ItemEvent({
        eventType: OsEventTypeList.CLICK_EVENT,
      });
      const action = mapTextEvent(event, idle);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('TAP');
    });

    it('maps SCROLL_BOTTOM_EVENT to SCROLL up', () => {
      // SCROLL_BOTTOM_EVENT → 'up' matches the G2 physical gesture direction.
      const event = new Text_ItemEvent({
        eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT,
      });
      const action = mapTextEvent(event, idle);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('SCROLL');
      if (action!.type === 'SCROLL') {
        expect(action.direction).toBe('up');
      }
    });

    it('maps DOUBLE_CLICK_EVENT to DOUBLE_TAP', () => {
      const event = new Text_ItemEvent({
        eventType: OsEventTypeList.DOUBLE_CLICK_EVENT,
      });
      const action = mapTextEvent(event, idle);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('DOUBLE_TAP');
    });
  });

  describe('mapSysEvent', () => {
    it('maps FOREGROUND_ENTER_EVENT', () => {
      const event = new Sys_ItemEvent({
        eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT,
      });
      const action = mapSysEvent(event, idle);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('FOREGROUND_ENTER');
    });

    it('maps FOREGROUND_EXIT_EVENT', () => {
      const event = new Sys_ItemEvent({
        eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT,
      });
      const action = mapSysEvent(event, idle);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('FOREGROUND_EXIT');
    });
  });

  describe('firmware duplicate-event dedup (ER point 3)', () => {
    it('drops a duplicate DOUBLE_CLICK within the 600ms window', () => {
      const ev = () => new Sys_ItemEvent({ eventType: OsEventTypeList.DOUBLE_CLICK_EVENT });
      const first = mapSysEvent(ev(), idle);
      expect(first?.type).toBe('DOUBLE_TAP');
      // Firmware echoes the same physical double-tap ~50–100ms later — must be dropped, or one
      // double-tap from idle would open the menu and the echo would immediately close it.
      const echo = mapSysEvent(ev(), idle);
      expect(echo).toBeNull();
    });

    it('drops a duplicate CLICK within the 130ms window', () => {
      const ev = () => new Sys_ItemEvent({ eventType: OsEventTypeList.CLICK_EVENT });
      const first = mapSysEvent(ev(), idle);
      expect(first?.type).toBe('TAP');
      const echo = mapSysEvent(ev(), idle);
      expect(echo).toBeNull();
    });

    it('dedup is cross-channel (list CLICK then text CLICK echo is dropped)', () => {
      const listClick = mapListEvent(new List_ItemEvent({ eventType: OsEventTypeList.CLICK_EVENT }), idle);
      expect(listClick?.type).toBe('TAP');
      const textEcho = mapTextEvent(new Text_ItemEvent({ eventType: OsEventTypeList.CLICK_EVENT }), idle);
      expect(textEcho).toBeNull();
    });
  });


  describe('mapEvenHubEvent', () => {
    it('routes a listEvent through the list mapper', () => {
      const event = { listEvent: new List_ItemEvent({ eventType: OsEventTypeList.DOUBLE_CLICK_EVENT }) } as EvenHubEvent;
      expect(mapEvenHubEvent(event, idle)).toEqual({ type: 'DOUBLE_TAP' });
    });

    it('routes a textEvent through the text mapper', () => {
      const event = { textEvent: new Text_ItemEvent({ eventType: OsEventTypeList.DOUBLE_CLICK_EVENT }) } as EvenHubEvent;
      expect(mapEvenHubEvent(event, idle)).toEqual({ type: 'DOUBLE_TAP' });
    });

    it('routes a sysEvent through the sys mapper', () => {
      const event = { sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.DOUBLE_CLICK_EVENT }) } as EvenHubEvent;
      expect(mapEvenHubEvent(event, idle)).toEqual({ type: 'DOUBLE_TAP' });
    });

    it('returns null for an event with no list, text, or sys payload', () => {
      expect(mapEvenHubEvent({} as EvenHubEvent, idle)).toBeNull();
    });
  });

  describe('timing filters (one physical gesture = one action)', () => {
    let now = 1_000_000;
    const at = (ms: number) => { now = 1_000_000 + ms; };
    const rowSelect = { ...idle, phase: 'rowSelect' as const };
    const sys = (eventType: OsEventTypeList) => new Sys_ItemEvent({ eventType });

    beforeEach(() => {
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      at(0);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('during selection, a same-direction scroll within 500ms is the tail of one swipe', () => {
      expect(mapSysEvent(sys(OsEventTypeList.SCROLL_TOP_EVENT), rowSelect)).toEqual({ type: 'SCROLL', direction: 'down' });
      at(100);
      expect(mapSysEvent(sys(OsEventTypeList.SCROLL_TOP_EVENT), rowSelect)).toBeNull();
      at(600);
      expect(mapSysEvent(sys(OsEventTypeList.SCROLL_TOP_EVENT), rowSelect)).toEqual({ type: 'SCROLL', direction: 'down' });
    });

    it('outside selection, the same-direction window is short', () => {
      expect(mapSysEvent(sys(OsEventTypeList.SCROLL_TOP_EVENT), idle)).not.toBeNull();
      at(100);
      expect(mapSysEvent(sys(OsEventTypeList.SCROLL_TOP_EVENT), idle)).not.toBeNull();
    });

    it('a scroll within 150ms of a tap is ring bleed and is dropped', () => {
      expect(mapSysEvent(sys(OsEventTypeList.CLICK_EVENT), idle)?.type).toBe('TAP');
      at(100);
      expect(mapSysEvent(sys(OsEventTypeList.SCROLL_TOP_EVENT), idle)).toBeNull();
      at(200);
      expect(mapSysEvent(sys(OsEventTypeList.SCROLL_TOP_EVENT), idle)).not.toBeNull();
    });

    it('a scroll dropped after a tap does not block the next real swipe', () => {
      expect(mapSysEvent(sys(OsEventTypeList.CLICK_EVENT), rowSelect)?.type).toBe('TAP');
      at(100);
      expect(mapSysEvent(sys(OsEventTypeList.SCROLL_TOP_EVENT), rowSelect)).toBeNull(); // bleed
      at(300);
      expect(mapSysEvent(sys(OsEventTypeList.SCROLL_TOP_EVENT), rowSelect)).toEqual({ type: 'SCROLL', direction: 'down' });
    });

    it('taps are ignored during an extended cooldown (e.g. just after opening the menu)', () => {
      extendTapCooldown(TAP_COOLDOWN_MENU_MS);
      expect(mapSysEvent(sys(OsEventTypeList.CLICK_EVENT), idle)).toBeNull();
      at(TAP_COOLDOWN_MENU_MS + 10);
      expect(mapSysEvent(sys(OsEventTypeList.CLICK_EVENT), idle)?.type).toBe('TAP');
    });

    it('the sys channel (R1 ring) maps scroll directions like the list and text channels', () => {
      expect(mapSysEvent(sys(OsEventTypeList.SCROLL_TOP_EVENT), idle)).toEqual({ type: 'SCROLL', direction: 'down' });
      at(1000);
      expect(mapSysEvent(sys(OsEventTypeList.SCROLL_BOTTOM_EVENT), idle)).toEqual({ type: 'SCROLL', direction: 'up' });
    });
  });
});
