import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.ts';
import { installZapButton } from '../src/whatsapp/zapButton.ts';

const FIXTURE = readFileSync(new URL('./fixtures/whatsapp-chat.html', import.meta.url), 'utf8');
const rows = () => [...document.querySelectorAll<HTMLElement>('#main [data-id]')];

describe('installZapButton', () => {
  let zapped: HTMLElement[];
  let button: () => HTMLButtonElement;
  beforeEach(() => {
    installDom(FIXTURE);
    zapped = [];
    // jsdom lays nothing out; give messages a size so the button has a place.
    for (const el of document.querySelectorAll('[data-pre-plain-text]')) {
      (el as HTMLElement).getBoundingClientRect = () => ({ top: 100, left: 20, right: 220, bottom: 140, width: 200, height: 40, x: 20, y: 100, toJSON() {} });
    }
    installZapButton(row => zapped.push(row), { amount: () => 21, requireTrusted: false });
    button = () => document.querySelector('[data-whatsapp-zaps-ui="zap-button"]')!.shadowRoot!.querySelector('button')!;
  });

  it('appears beside someone else’s message on hover and zaps its author', () => {
    rows()[0].querySelector('span')!.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    assert.equal(button().hidden, false);
    assert.equal(button().getAttribute('aria-label'), 'Zap 21 sats to Ana Paula');
    assert.equal(button().textContent, '⚡21', 'shows the amount');
    assert.equal(button().style.left, '226px');
    button().click();
    assert.deepEqual(zapped, [rows()[0]]);
    assert.equal(button().hidden, true);
  });

  it('never appears on one’s own messages', () => {
    rows()[1].querySelector('span')!.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    assert.equal(button().hidden, true);
  });

  it('hides when the chat scrolls', () => {
    rows()[0].dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    document.dispatchEvent(new window.Event('scroll'));
    assert.equal(button().hidden, true);
  });
});
