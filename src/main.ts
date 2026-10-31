// DM Sans for the phone help page, bundled (Latin subset, the weights index.html uses) so the app
// needs no network permission.
import '@fontsource/dm-sans/latin-300.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import { initApp } from './app';

initApp().catch((err) => {
  console.error('[EvenChess] Failed to initialize:', err);
});
