import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './helpers/dom.ts';
import { attachStyles } from '../src/ui/styles.ts';

describe('attachStyles', () => {
  beforeEach(() => { installDom(); });

  it('attaches to a shadow root and removes again', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const before = shadow.adoptedStyleSheets?.length ?? 0;
    const detach = attachStyles(shadow, '.x { color: red; }');
    const count = () => (shadow.adoptedStyleSheets?.length ?? 0) - before + shadow.querySelectorAll('style').length;
    assert.equal(count(), 1);
    detach();
    assert.equal(count(), 0);
  });

  it('falls back to a <style> element without constructable stylesheets', () => {
    const win = window as unknown as { CSSStyleSheet?: unknown };
    const saved = win.CSSStyleSheet;
    win.CSSStyleSheet = undefined;
    try {
      const detach = attachStyles(document, '.y { color: blue; }');
      const style = document.head.querySelector('style[data-whatsapp-zaps]')!;
      assert.equal(style.textContent, '.y { color: blue; }');
      detach();
      assert.equal(document.head.querySelector('style[data-whatsapp-zaps]'), null);
    } finally {
      win.CSSStyleSheet = saved;
    }
  });
});
