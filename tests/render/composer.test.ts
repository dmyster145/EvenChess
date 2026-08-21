import { describe, it, expect } from 'vitest';
import { validateEvenHubPageContainer } from '@evenrealities/even_hub_sdk';
import {
  composeStartupPage,
  composeTextOnlyStartupPage,
  composePageForState,
} from '../../src/render/composer';
import { buildInitialState } from '../../src/state/contracts';
import { ChessService } from '../../src/chess/chessservice';
import { NATIVE_MENU_LABELS } from '../../src/state/constants';

describe('render/composer — native menu (SDK 0.0.14 menuObject)', () => {
  const state = buildInitialState(new ChessService());

  const pages = {
    'text-only startup': composeTextOnlyStartupPage(state),
    'full startup': composeStartupPage(state),
    rebuild: composePageForState(state),
  };

  for (const [name, page] of Object.entries(pages)) {
    it(`${name} attaches a menuObject that passes SDK validation`, () => {
      // A rebuild that OMITS menuObject clears the registered menu, so every page must carry it.
      expect(page.menuObject).toBeDefined();
      const result = validateEvenHubPageContainer(page);
      expect(result.valid).toBe(true);
    });

    it(`${name} menu items match NATIVE_MENU_LABELS with 1-based non-zero itemIDs`, () => {
      const items = (page.menuObject as { menuItems: Array<{ itemName?: string; itemID?: number }> }).menuItems;
      expect(items.map((i) => i.itemName)).toEqual([...NATIVE_MENU_LABELS]);
      expect(items.map((i) => i.itemID)).toEqual(NATIVE_MENU_LABELS.map((_, i) => i + 1));
    });
  }

  it('excludes Exit — the OS menu supplies its own "close"', () => {
    expect(NATIVE_MENU_LABELS).not.toContain('Exit');
    expect(NATIVE_MENU_LABELS.length).toBe(6);
  });
});
