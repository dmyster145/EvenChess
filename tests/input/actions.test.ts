import { describe, it, expect, beforeEach } from 'vitest';
import { mapListEvent, mapTextEvent, mapSysEvent, resetScrollDebounce, resetTapCooldown, resetScrollSuppression, resetInputDedup } from '../../src/input/actions';
import { OsEventTypeList, List_ItemEvent, Text_ItemEvent, Sys_ItemEvent } from '@evenrealities/even_hub_sdk';

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
      const action = mapListEvent(event);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('TAP');
      if (action!.type === 'TAP') {
        expect(action.selectedIndex).toBe(2);
        expect(action.selectedName).toBe('Nf3');
      }
    });

    it('maps DOUBLE_CLICK_EVENT to DOUBLE_TAP', () => {
      const event = new List_ItemEvent({
        eventType: OsEventTypeList.DOUBLE_CLICK_EVENT,
      });
      const action = mapListEvent(event);
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
      const action = mapListEvent(event);
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
      const action = mapListEvent(event);
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
      const action = mapListEvent(event);
      expect(action).toBeNull();
    });
  });

  describe('mapTextEvent', () => {
    it('maps CLICK_EVENT to TAP', () => {
      const event = new Text_ItemEvent({
        eventType: OsEventTypeList.CLICK_EVENT,
      });
      const action = mapTextEvent(event);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('TAP');
    });

    it('maps SCROLL_BOTTOM_EVENT to SCROLL up', () => {
      // SCROLL_BOTTOM_EVENT → 'up' matches the G2 physical gesture direction.
      const event = new Text_ItemEvent({
        eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT,
      });
      const action = mapTextEvent(event);
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
      const action = mapTextEvent(event);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('DOUBLE_TAP');
    });
  });

  describe('mapSysEvent', () => {
    it('maps FOREGROUND_ENTER_EVENT', () => {
      const event = new Sys_ItemEvent({
        eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT,
      });
      const action = mapSysEvent(event);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('FOREGROUND_ENTER');
    });

    it('maps FOREGROUND_EXIT_EVENT', () => {
      const event = new Sys_ItemEvent({
        eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT,
      });
      const action = mapSysEvent(event);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('FOREGROUND_EXIT');
    });
  });

  describe('firmware duplicate-event dedup (ER point 3)', () => {
    it('drops a duplicate DOUBLE_CLICK within the 600ms window', () => {
      const ev = () => new Sys_ItemEvent({ eventType: OsEventTypeList.DOUBLE_CLICK_EVENT });
      const first = mapSysEvent(ev());
      expect(first?.type).toBe('DOUBLE_TAP');
      // Firmware echoes the same physical double-tap ~50–100ms later — must be dropped so the
      // menu→exit-dialog short-circuit only fires shutDownPageContainer(1) once.
      const echo = mapSysEvent(ev());
      expect(echo).toBeNull();
    });

    it('drops a duplicate CLICK within the 130ms window', () => {
      const ev = () => new Sys_ItemEvent({ eventType: OsEventTypeList.CLICK_EVENT });
      const first = mapSysEvent(ev());
      expect(first?.type).toBe('TAP');
      const echo = mapSysEvent(ev());
      expect(echo).toBeNull();
    });

    it('dedup is cross-channel (list CLICK then text CLICK echo is dropped)', () => {
      const listClick = mapListEvent(new List_ItemEvent({ eventType: OsEventTypeList.CLICK_EVENT }));
      expect(listClick?.type).toBe('TAP');
      const textEcho = mapTextEvent(new Text_ItemEvent({ eventType: OsEventTypeList.CLICK_EVENT }));
      expect(textEcho).toBeNull();
    });
  });
});
