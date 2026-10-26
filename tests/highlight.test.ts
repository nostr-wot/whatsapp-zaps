import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.ts';
import { ZAP_ATTR, ZAP_COLOR, highlightStyle, installCommandHighlight, updateHighlight } from '../src/whatsapp/highlight.ts';
import { findComposer } from '../src/whatsapp/dom.ts';

const FIXTURE = readFileSync(new URL('./fixtures/whatsapp-chat.html', import.meta.url), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));

describe('command highlight', () => {
  beforeEach(() => { installDom(FIXTURE); });

  it('marks the composer while it holds a /zap command', () => {
    const composer = findComposer()!;
    updateHighlight();
    assert.equal(composer.hasAttribute(ZAP_ATTR), true);
    composer.innerHTML = '<p><span>hello</span></p>';
    updateHighlight();
    assert.equal(composer.hasAttribute(ZAP_ATTR), false);
  });

  it('installs the theme’s zap colour and follows typing', async () => {
    assert.equal(ZAP_COLOR, '#6366f1', 'Nostr WoT’s indigo until a theme is known');
    assert.match(highlightStyle(ZAP_COLOR), new RegExp(`\\[${ZAP_ATTR}\\].*color: ${ZAP_COLOR}`));
    const before = document.adoptedStyleSheets?.length ?? 0;
    const { uninstall } = installCommandHighlight();
    const attached = () => (document.adoptedStyleSheets?.length ?? 0) > before || !!document.querySelector('style[data-whatsapp-zaps]');
    assert.ok(attached(), 'styles attached');
    const composer = findComposer()!;
    composer.innerHTML = '<p><span>/zap 21</span></p>';
    composer.dispatchEvent(new window.Event('input', { bubbles: true }));
    await tick();
    assert.equal(composer.hasAttribute(ZAP_ATTR), true);
    composer.innerHTML = '<p><span>/za</span></p>';
    composer.dispatchEvent(new window.Event('input', { bubbles: true }));
    await tick();
    assert.equal(composer.hasAttribute(ZAP_ATTR), false);
    uninstall();
    assert.equal(attached(), false, 'styles removed');
  });

  it('repaints in another theme’s colour', () => {
    const sheets = () => [...(document.adoptedStyleSheets ?? [])].map(sheet => [...sheet.cssRules].map(r => r.cssText).join(' ')).join(' ')
      + [...document.querySelectorAll('style[data-whatsapp-zaps]')].map(s => s.textContent).join(' ');
    const highlight = installCommandHighlight(document, '#fc560e');
    assert.match(sheets(), /#fc560e|rgb\(252, 86, 14\)/);
    highlight.setColor('#c7ff5b');
    assert.doesNotMatch(sheets(), /#fc560e|rgb\(252, 86, 14\)/);
    assert.match(sheets(), /#c7ff5b|rgb\(199, 255, 91\)/);
    highlight.uninstall();
  });
});
