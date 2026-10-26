import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.ts';
import {
  CONTACT_BUTTON_ATTR, addNostrButton, findActionRows, installContactInfoButton, phoneIdNear,
} from '../src/whatsapp/contactInfo.ts';

const FIXTURE = readFileSync(new URL('./fixtures/whatsapp-chat.html', import.meta.url), 'utf8');

/** Shaped like WhatsApp's contact info (the reported screenshot): Voice · Video · Search. */
const PANEL = `<section class="drawer">
  <div class="title"><span dir="auto">Ana Paula</span><span>+54 9 11 7777-1111</span></div>
  <div class="actions">
    <div class="item"><div role="button" aria-label="Voice call"><span data-icon="voice-call"><svg width="24" height="24"></svg></span></div><div><span>Voice</span></div></div>
    <div class="item"><div role="button" aria-label="Video call"><span data-icon="video-call"><svg width="24" height="24"></svg></span></div><div><span>Video</span></div></div>
    <div class="item"><div role="button" aria-label="Search"><span data-icon="search"><svg width="24" height="24"></svg></span></div><div><span>Search</span></div></div>
  </div>
  <div><span>About</span><span>courage is our own fountain of wisdom</span></div>
</section>`;

function panel(): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = PANEL;
  document.getElementById('app')!.append(host);
  return host;
}

describe('contact info Nostr button', () => {
  beforeEach(() => { installDom(FIXTURE); });

  it('finds the row of Voice / Video / Search buttons', () => {
    panel();
    const rows = findActionRows(document.body);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].className, 'actions');
  });

  it('adds a Nostr button shaped like WhatsApp’s, once, that opens the popup', () => {
    panel();
    let opened = 0;
    const row = findActionRows(document.body)[0];
    const button = addNostrButton(row, () => { opened++; })!;
    assert.equal(button.getAttribute(CONTACT_BUTTON_ATTR), 'contact-nostr');
    assert.equal(button.className, 'item', 'same look as WhatsApp’s buttons');
    assert.equal(row.lastElementChild, button);
    assert.equal(button.textContent, 'Nostr');
    assert.equal(button.querySelector('[data-icon]'), null, 'not mistaken for WhatsApp’s search');
    assert.ok(button.querySelector('svg path'), 'our bolt icon');
    assert.equal(button.querySelector('[role="button"]')!.getAttribute('aria-label'), 'Nostr profile');
    button.querySelector('[role="button"]')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(opened, 1);
    assert.equal(addNostrButton(row, () => {}), button, 'not added twice');
    assert.equal(row.querySelectorAll(`[${CONTACT_BUTTON_ATTR}]`).length, 1);
  });

  it('reads the phone number shown in the panel as a contact id', () => {
    panel();
    assert.equal(phoneIdNear(findActionRows(document.body)[0]), '5491177771111@c.us');
  });

  it('leaves the conversation alone: labels in messages do not count', () => {
    const inChat = document.createElement('div');
    inChat.innerHTML = '<div><span>Video</span></div><div><span>Voice</span></div>';
    document.getElementById('main')!.append(inChat);
    assert.deepEqual(findActionRows(document.body), []);
  });

  it('adds the button when the panel opens later', async () => {
    const shown: Array<string | null> = [];
    const stop = installContactInfoButton(id => shown.push(id));
    panel();
    await new Promise(r => setTimeout(r, 250));
    const button = document.querySelector(`[${CONTACT_BUTTON_ATTR}="contact-nostr"]`) as HTMLElement;
    assert.ok(button, 'button added');
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(shown, ['5491177771111@c.us']);
    stop();
  });
});
