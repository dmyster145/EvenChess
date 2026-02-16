import { describe, it, expect, beforeEach } from 'vitest';
import { mapListEvent, mapTextEvent, mapSysEvent, resetScrollDebounce, resetTapCooldown, resetScrollSuppression } from '../../src/input/actions';
import { OsEventTypeList, List_ItemEvent, Text_ItemEvent, Sys_ItemEvent } from '@evenrealities/even_hub_sdk';

describe('input/actions', () => {
  beforeEach(() => {
    resetScrollDebounce();
    resetTapCooldown();
    resetScrollSuppression();
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

    it('maps SCROLL_TOP_EVENT to SCROLL up', () => {
      const event = new List_ItemEvent({
        eventType: OsEventTypeList.SCROLL_TOP_EVENT,
      });
      const action = mapListEvent(event);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('SCROLL');
      if (action!.type === 'SCROLL') {
        expect(action.direction).toBe('up');
      }
    });

    it('maps SCROLL_BOTTOM_EVENT to SCROLL down', () => {
      const event = new List_ItemEvent({
        eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT,
      });
      const action = mapListEvent(event);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('SCROLL');
      if (action!.type === 'SCROLL') {
        expect(action.direction).toBe('down');
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

    it('maps SCROLL_BOTTOM_EVENT to SCROLL down', () => {
      const event = new Text_ItemEvent({
        eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT,
      });
      const action = mapTextEvent(event);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('SCROLL');
      if (action!.type === 'SCROLL') {
        expect(action.direction).toBe('down');
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
});
