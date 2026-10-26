import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.ts';
import {
  CONTACT_BUTTON_ATTR, addNostrButton, contactForShown, findActionRows, installContactInfoButton, isChatName, nameNear,
  paintBolts, phoneIdNear, phoneIdOf, shownNear,
} from '../src/whatsapp/contactInfo.ts';

const FIXTURE = readFileSync(new URL('./fixtures/whatsapp-chat.html', import.meta.url), 'utf8');

/** Shaped like WhatsApp's contact info (the reported screenshot): Voice · Video · Search. */
const PANEL = `<section class="drawer">
  <header><div role="button" aria-label="Close"><span data-icon="x"></span></div><h1>Contact info</h1></header>
  <div class="title"><span dir="auto">Ana Paula</span><span>+54 9 11 7777-1111</span></div>
  <div class="actions">
    <div class="item"><div role="button" aria-label="Voice call"><span data-icon="voice-call"><svg width="24" height="24"></svg></span></div><div><span>Voice</span></div></div>
    <div class="item"><div role="button" aria-label="Video call"><span data-icon="video-call"><svg width="24" height="24"></svg></span></div><div><span>Video</span></div></div>
    <div class="item"><div role="button" aria-label="Search"><span data-icon="search"><svg width="24" height="24"></svg></span></div><div><span>Search</span></div></div>
  </div>
  <div><span>About</span><span>courage is our own fountain of wisdom</span></div>
</section>`;

/** A profile preview: picture, name, and icon-only buttons with accessible names. */
const PREVIEW = `<div class="preview">
  <div class="photo"><img alt=""></div>
  <div class="caption"><span dir="auto">Bruno Díaz</span></div>
  <div class="icons">
    <div><div role="button" aria-label="Message"><span data-icon="chat"><svg width="20" height="20"></svg></span></div></div>
    <div><div role="button" aria-label="Voice call"><span data-icon="voice-call"><svg width="20" height="20"></svg></span></div></div>
    <div><button aria-label="Video call" title="Video call"><span data-icon="video-call"><svg width="20" height="20"></svg></span></button></div>
  </div>
</div>`;

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.getElementById('app')!.append(host);
  return host;
}

/** Icon buttons in the chat header, beside WhatsApp's ⋮ menu. */
function headerIcons(): HTMLElement {
  const header = document.querySelector('#main header')!;
  const icons = document.createElement('div');
  icons.className = 'header-actions';
  icons.innerHTML = '<div><div role="button" aria-label="Video call"><span data-icon="video-call"><svg width="24" height="24"></svg></span></div></div>'
    + '<div><div role="button" title="Search…" aria-label="Search…"><span data-icon="search-alt"><svg width="24" height="24"></svg></span></div></div>';
  icons.append(header.lastElementChild!);
  header.append(icons);
  return icons;
}

describe('⚡ Nostr buttons beside WhatsApp’s contact actions', () => {
  beforeEach(() => { installDom(FIXTURE); });

  it('finds the row of Voice / Video / Search buttons, not each button with its caption', () => {
    mount(PANEL);
    const rows = findActionRows(document.body);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].className, 'actions');
  });

  it('adds a Nostr button shaped like WhatsApp’s, once, that opens the popup', () => {
    mount(PANEL);
    let opened = 0;
    const row = findActionRows(document.body)[0];
    const button = addNostrButton(row, () => { opened++; }, '#6366f1')!;
    assert.equal(button.getAttribute(CONTACT_BUTTON_ATTR), 'contact-nostr');
    assert.equal(button.className, 'item', 'same look as WhatsApp’s buttons');
    assert.equal(row.lastElementChild, button);
    assert.equal(button.textContent, 'Nostr');
    assert.equal(button.querySelector('[data-icon]'), null, 'not mistaken for WhatsApp’s search');
    assert.equal((button.querySelector('svg[data-whatsapp-zaps-bolt]') as SVGElement).style.color, 'rgb(99, 102, 241)', 'the theme’s colour');
    assert.equal(button.querySelector('[role="button"]')!.getAttribute('aria-label'), 'Nostr profile');
    button.querySelector('[role="button"]')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(opened, 1);
    assert.equal(addNostrButton(row, () => {}), button, 'not added twice');
    assert.equal(row.querySelectorAll(`[${CONTACT_BUTTON_ATTR}]`).length, 1);
    assert.equal(findActionRows(document.body).length, 1, 'its own button does not make another row');
  });

  it('finds icon-only buttons by their accessible names: a profile preview', () => {
    mount(PREVIEW);
    const rows = findActionRows(document.body);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].className, 'icons');
    const button = addNostrButton(rows[0], () => {})!;
    assert.equal(rows[0].lastElementChild, button, 'after the last action');
    const clickable = button.querySelector('button')!;
    assert.equal(clickable.getAttribute('aria-label'), 'Nostr profile');
    assert.equal(clickable.getAttribute('title'), 'Nostr profile and Lightning Address');
    assert.equal(button.textContent, '', 'no caption to rename');
    assert.ok(button.querySelector('svg path'), 'our bolt icon');
  });

  it('adds one to the chat header, before WhatsApp’s ⋮ menu', () => {
    const icons = headerIcons();
    const rows = findActionRows(document.body);
    assert.deepEqual(rows, [icons]);
    const button = addNostrButton(icons, () => {})!;
    assert.equal(button.nextElementSibling?.querySelector('[aria-label="Menu"]') !== null, true, 'Menu stays last');
    assert.deepEqual(shownNear(icons), { inHeader: true, id: null, name: null });
  });

  it('leaves the conversation, the message box and lists alone', () => {
    const inChat = document.createElement('div');
    inChat.innerHTML = '<div><span>Video</span></div><div><span>Voice</span></div>'
      + '<div><div role="button" aria-label="Voice call"></div></div><div><div role="button" aria-label="Video call"></div></div>';
    document.querySelector('#main .copyable-area')!.append(inChat);
    // A list of calls: each entry has call buttons of its own.
    mount(`<div role="list">
      <div role="listitem"><span>Ana</span><div><div role="button" aria-label="Voice call"></div></div><div><div role="button" aria-label="Video call"></div></div></div>
      <div role="listitem"><span>Bruno</span><div><div role="button" aria-label="Voice call"></div></div><div><div role="button" aria-label="Video call"></div></div></div>
    </div>`);
    assert.deepEqual(findActionRows(document.body), []);
  });

  it('reads who a panel is about: the number and the name it shows', () => {
    mount(PANEL);
    const row = findActionRows(document.body)[0];
    assert.equal(phoneIdNear(row), '5491177771111@c.us');
    assert.equal(nameNear(row), 'Ana Paula', 'not the panel title, not the number');
    assert.deepEqual(shownNear(row), { inHeader: false, id: '5491177771111@c.us', name: 'Ana Paula' });
  });

  it('prefers a name WhatsApp shows for a chat over other text', () => {
    const preview = mount(PREVIEW.replace('<div class="icons">', '<div><span>Hey there! I am using WhatsApp.</span></div><div class="icons">'));
    const row = preview.querySelector('.icons')!;
    assert.equal(nameNear(row), 'Hey there! I am using WhatsApp.', 'nearest text without help');
    const list = document.createElement('div');
    list.id = 'pane-side';
    list.innerHTML = '<div role="listitem"><span title="Bruno Díaz">Bruno Díaz</span></div>';
    document.getElementById('app')!.append(list);
    assert.equal(isChatName('bruno diaz'), true, 'matched like WhatsApp names are');
    assert.equal(nameNear(row, name => isChatName(name)), 'Bruno Díaz');
  });

  it('reads names drawn with emoji pictures, and only numbers shown above the actions', () => {
    const group = mount(`<section>
      <div><span dir="auto">Friends <img alt="🌱" src="data:,"> Family</span></div>
      <div class="actions">
        <div><div role="button" aria-label="Voice call"></div><span>Audio</span></div>
        <div><div role="button" aria-label="Video call"></div><span>Video</span></div>
      </div>
      <div><span>Members</span><span>+54 9 11 5555-0000</span></div>
    </section>`);
    const row = group.querySelector('.actions')!;
    assert.equal(nameNear(row), 'Friends 🌱 Family');
    assert.equal(phoneIdNear(row), null, 'a member’s number below is not the panel’s');
  });

  it('reads phone numbers as contact ids', () => {
    assert.equal(phoneIdOf('+54 9 11 7777-1111'), '5491177771111@c.us');
    assert.equal(phoneIdOf('+1 (555) 010-9999'), '15550109999@c.us');
    assert.equal(phoneIdOf('Ana Paula'), null);
    assert.equal(phoneIdOf('+12'), null);
  });

  it('colours the bolts it added when the theme changes', () => {
    mount(PANEL);
    const button = addNostrButton(findActionRows(document.body)[0], () => {})!;
    paintBolts('#fc560e');
    assert.equal((button.querySelector('svg') as SVGElement).style.color, 'rgb(252, 86, 14)');
  });

  it('adds the button when a panel opens later, and when the chat header is redrawn', async () => {
    const opened: Element[] = [];
    const stop = installContactInfoButton(row => opened.push(row));
    mount(PANEL);
    await new Promise(r => setTimeout(r, 250));
    const button = document.querySelector(`[${CONTACT_BUTTON_ATTR}="contact-nostr"]`) as HTMLElement;
    assert.ok(button, 'button added');
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(opened.length, 1);
    assert.equal((opened[0] as HTMLElement).className, 'actions', 'the row, to read who it is about when clicked');
    // Opening another chat redraws #main, header and all.
    const main = document.getElementById('main')!;
    const fresh = main.cloneNode(true) as HTMLElement;
    main.replaceWith(fresh);
    headerIcons();
    await new Promise(r => setTimeout(r, 250));
    assert.ok(document.querySelector(`#main header [${CONTACT_BUTTON_ATTR}]`), 'header button added');
    stop();
  });
});

describe('who the Nostr popup is for', () => {
  const chat = { kind: 'contact' as const, id: '5491177771111@c.us', name: 'Ana Paula' };
  const group = { kind: 'group' as const, chatKey: 'jid:1203@g.us', title: 'Friends & Family' };

  it('the open chat, from its header or its own info panel', () => {
    assert.equal(contactForShown({ inHeader: true, id: null, name: null }, group), group);
    assert.equal(contactForShown({ inHeader: false, id: '5491177771111@c.us', name: 'Ana Paula' }, chat), chat);
    assert.equal(contactForShown({ inHeader: false, id: null, name: 'ana paula' }, chat), chat);
    assert.equal(contactForShown({ inHeader: false, id: null, name: 'Friends & Family' }, group), group, 'group info');
    assert.equal(contactForShown({ inHeader: false, id: null, name: null }, chat), chat, 'nothing to tell');
  });

  it('someone else: a group member, a chat from the list', () => {
    assert.deepEqual(contactForShown({ inHeader: false, id: '5491100000000@c.us', name: null }, group),
      { kind: 'contact', id: '5491100000000@c.us', name: '+5491100000000' });
    assert.deepEqual(contactForShown({ inHeader: false, id: '5491100000000@c.us', name: 'Ana Paula' }, group),
      { kind: 'contact', id: '5491100000000@c.us', name: 'Ana Paula' });
    assert.deepEqual(contactForShown({ inHeader: false, id: null, name: 'Bruno Díaz' }, chat),
      { kind: 'contact', id: null, name: 'Bruno Díaz' });
  });
});
