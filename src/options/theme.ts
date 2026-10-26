/**
 * Runs first on the extension's pages, as a plain script in <head>: puts the
 * theme on <html> before anything is drawn (from the choice remembered by the
 * last visit), then keeps it in step with Settings and the system's light or
 * dark mode.
 */
import { storedChoice, systemDark, watchTheme } from '../ui/themeWatch.ts';

const CACHE_KEY = 'wz-theme';

let remembered: unknown;
try { remembered = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null'); } catch { /* first visit, or storage blocked */ }

watchTheme(storedChoice(), systemDark(), view => {
  document.documentElement.dataset.theme = view.id;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(view.choice)); } catch { /* only saves a flash of the default look */ }
}, remembered);
