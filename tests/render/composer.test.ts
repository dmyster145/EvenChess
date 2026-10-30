import { describe, it, expect } from 'vitest';
import { validateEvenHubPageContainer } from '@evenrealities/even_hub_sdk';
import {
  composeStartupPage,
  composeTextOnlyStartupPage,
  composePageForState,
} from '../../src/render/composer';
import { buildInitialState } from '../../src/state/contracts';
import { ChessService } from '../../src/chess/chessservice';

describe('render/composer — page containers', () => {
  const state = buildInitialState(new ChessService());

  const pages = {
    'text-only startup': composeTextOnlyStartupPage(state),
    'full startup': composeStartupPage(state),
    rebuild: composePageForState(state),
  };

  for (const [name, page] of Object.entries(pages)) {
    it(`${name} passes SDK validation`, () => {
      expect(validateEvenHubPageContainer(page).valid).toBe(true);
    });

    it(`${name} registers no native OS menu (the menu is opened by double-tap)`, () => {
      expect(page.menuObject).toBeUndefined();
    });
  }
});
