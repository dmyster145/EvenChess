import { initApp } from './app';

initApp().catch((err) => {
  console.error('[EvenChess] Failed to initialize:', err);
});
