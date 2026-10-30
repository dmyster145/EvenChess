import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('activateKeepAlive', () => {
  let contexts: number;
  let lockRequests: number;

  beforeEach(() => {
    vi.resetModules(); // fresh module state per test
    contexts = 0;
    lockRequests = 0;
    vi.stubGlobal('window', {
      AudioContext: class {
        constructor() {
          contexts += 1;
          throw new Error('AudioContext blocked'); // e.g. a WebView that refuses audio
        }
      },
    });
    vi.stubGlobal('navigator', {
      locks: { request: () => { lockRequests += 1; return new Promise(() => {}); } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tries once: repeated input events never pile up AudioContexts or lock requests', async () => {
    const { activateKeepAlive } = await import('../../src/utils/keep-alive');
    activateKeepAlive();
    activateKeepAlive();
    activateKeepAlive();
    expect(contexts).toBe(1);
    expect(lockRequests).toBe(1);
  });
});
