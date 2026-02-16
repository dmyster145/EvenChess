/**
 * Replay fixtures — canned event sequences for testing.
 */

import type { Action } from '../state/contracts';

export const QUICK_MOVE_FIXTURE: Action[] = [
  { type: 'SCROLL', direction: 'down' },
  { type: 'TAP', selectedIndex: 0, selectedName: '' },
  { type: 'TAP', selectedIndex: 0, selectedName: '' },
];

export const CANCEL_FIXTURE: Action[] = [
  { type: 'SCROLL', direction: 'down' },
  { type: 'DOUBLE_TAP' },
];

export const BROWSE_PIECES_FIXTURE: Action[] = [
  { type: 'SCROLL', direction: 'down' },
  { type: 'SCROLL', direction: 'down' },
  { type: 'SCROLL', direction: 'down' },
  { type: 'SCROLL', direction: 'up' },
  { type: 'DOUBLE_TAP' },
];

export const FULL_ROUND_FIXTURE: Action[] = [
  { type: 'SCROLL', direction: 'down' },
  { type: 'TAP', selectedIndex: 0, selectedName: '' },
  { type: 'TAP', selectedIndex: 0, selectedName: '' },
  { type: 'ENGINE_THINKING' },
  { type: 'ENGINE_MOVE', uci: 'e7e5', san: 'e5', fen: '', turn: 'w', pieces: [], inCheck: false },
];

export async function replayFixture(
  fixture: Action[],
  dispatch: (action: Action) => void,
  delayMs = 300,
): Promise<void> {
  for (const action of fixture) {
    dispatch(action);
    await new Promise((r) => setTimeout(r, delayMs));
  }
}
