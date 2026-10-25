import { JSDOM } from 'jsdom';

/** Install a fresh jsdom as the global DOM. Returns its window. */
export function installDom(html = '<!doctype html><html><body></body></html>') {
  const dom = new JSDOM(html, { url: 'https://web.whatsapp.com/', pretendToBeVisual: true });
  const g = globalThis as Record<string, unknown>;
  for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'KeyboardEvent', 'MouseEvent', 'Event', 'MessageEvent', 'MutationObserver']) {
    g[key] = key === 'window' ? dom.window : (dom.window as unknown as Record<string, unknown>)[key];
  }
  return dom.window;
}
