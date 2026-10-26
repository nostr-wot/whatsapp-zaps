/**
 * Keep a page's look in step with the person's theme choice (Settings) and
 * with light or dark mode: WhatsApp's own setting inside WhatsApp, the
 * system's on the extension's pages.
 */
import { THEME_KEY } from '../constants.ts';
import { parseThemeChoice, resolveTheme, type ThemeChoice, type ThemeId } from './themes.ts';

export interface ThemeView {
  choice: ThemeChoice;
  /** Whether the surroundings are dark: WhatsApp's theme, or the system's. */
  dark: boolean;
  id: ThemeId;
}

export interface DarkSignal {
  isDark(): boolean;
  subscribe(onChange: () => void): () => void;
}

export interface ChoiceSource {
  load(): Promise<unknown>;
  subscribe(onChange: (value: unknown) => void): () => void;
}

/** WhatsApp's dark theme is its own setting, shown as a class on <body>. */
export function whatsappDark(doc: Document = document): DarkSignal {
  return {
    isDark: () => !!doc.body?.classList.contains('dark'),
    subscribe: onChange => {
      if (!doc.body) return () => {};
      const observer = new MutationObserver(onChange);
      observer.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
      return () => observer.disconnect();
    },
  };
}

/** The system's light or dark mode. */
export function systemDark(win: Window = window): DarkSignal {
  const media = win.matchMedia?.('(prefers-color-scheme: dark)');
  return {
    isDark: () => !!media?.matches,
    subscribe: onChange => {
      media?.addEventListener('change', onChange);
      return () => media?.removeEventListener('change', onChange);
    },
  };
}

/** The choice kept in extension storage. */
export function storedChoice(): ChoiceSource {
  return {
    load: async () => (await chrome.storage.local.get(THEME_KEY))[THEME_KEY],
    subscribe: onChange => {
      const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === 'local' && THEME_KEY in changes) onChange(changes[THEME_KEY].newValue);
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },
  };
}

/**
 * Call `apply` now (with `initial`, a choice already known, if any), once the
 * stored choice has loaded, and whenever the choice or light/dark changes.
 */
export function watchTheme(
  source: ChoiceSource,
  dark: DarkSignal,
  apply: (view: ThemeView) => void,
  initial?: unknown,
): { current(): ThemeView; stop(): void } {
  let choice = parseThemeChoice(initial);
  let applied = '';
  const current = (): ThemeView => {
    const isDark = dark.isDark();
    return { choice, dark: isDark, id: resolveTheme(choice, isDark) };
  };
  const update = () => {
    const view = current();
    const key = `${view.id} ${view.dark} ${view.choice.palette} ${view.choice.appearance}`;
    if (key === applied) return;
    applied = key;
    apply(view);
  };
  update();
  // A change seen before the first load finished is newer than what it loads.
  let changed = false;
  const stops = [
    source.subscribe(value => { changed = true; choice = parseThemeChoice(value); update(); }),
    dark.subscribe(update),
  ];
  void source.load().then(value => {
    if (changed) return;
    choice = parseThemeChoice(value);
    update();
  }, () => { /* keep the default look */ });
  return { current, stop: () => { for (const stop of stops) stop(); } };
}
