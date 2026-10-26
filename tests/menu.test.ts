import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.ts';
import { MENU_ITEM_ATTR, MENU_ITEM_LABEL, addItemToOpenMenu, buildMenuItem, installMenuItem, installPersonMenuItem, personInMenu } from '../src/whatsapp/menu.ts';
import { findHeaderMenuButton } from '../src/whatsapp/dom.ts';

const CHAT = readFileSync(new URL('./fixtures/whatsapp-chat.html', import.meta.url), 'utf8');
const MENU = readFileSync(new URL('./fixtures/whatsapp-menu.html', import.meta.url), 'utf8');
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

function openMenu() {
  const host = document.createElement('div');
  host.innerHTML = MENU;
  document.getElementById('app')!.append(host);
}

describe('menu item', () => {
  beforeEach(() => { installDom(CHAT); });

  it('copies the look of a WhatsApp item but not its label or accessibility name', () => {
    openMenu();
    const template = document.querySelector('li[data-animate-dropdown-item]') as HTMLElement;
    let selected = 0;
    const item = buildMenuItem(template, () => { selected++; });
    assert.equal(item.className, 'x1item');
    assert.equal(item.textContent, MENU_ITEM_LABEL);
    assert.equal(item.querySelector('[aria-label]'), null);
    assert.equal(item.hasAttribute(MENU_ITEM_ATTR), true);
    item.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    item.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(selected, 2);
  });

  it('adds the item to the open menu only once', () => {
    assert.equal(addItemToOpenMenu(() => {}), false, 'no menu open');
    openMenu();
    assert.equal(addItemToOpenMenu(() => {}), true);
    assert.equal(addItemToOpenMenu(() => {}), true);
    assert.equal(document.querySelectorAll(`[${MENU_ITEM_ATTR}]`).length, 1);
  });

  it('adds the item when the header ⋮ menu opens, and opens the popup from it', async () => {
    let opened = 0;
    const escapes: string[] = [];
    document.addEventListener('keydown', e => escapes.push((e as KeyboardEvent).key));
    installMenuItem(() => { opened++; });
    const button = findHeaderMenuButton()!;
    assert.equal(button.getAttribute('aria-label'), 'Menu');
    button.querySelector('span')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    // WhatsApp renders the dropdown after the click.
    await tick(10);
    openMenu();
    await tick();
    const item = document.querySelector(`[${MENU_ITEM_ATTR}]`) as HTMLElement;
    assert.ok(item, 'item added');
    assert.equal(item.parentElement, document.querySelector('ul.x1menu'), 'appended to the list, after the others');
    assert.equal(item, document.querySelector('ul.x1menu')!.lastElementChild);
    assert.equal(item.querySelector('li')?.className, 'x1item', 'same look as WhatsApp’s items');
    item.click();
    assert.equal(opened, 1);
    assert.deepEqual(escapes, ['Escape'], 'menu closed');
  });

  it('leaves other menus alone', async () => {
    installMenuItem(() => {});
    document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    openMenu();
    await tick();
    assert.equal(document.querySelector(`[${MENU_ITEM_ATTR}]`), null);
  });

  it('uninstalls cleanly', async () => {
    const uninstall = installMenuItem(() => {});
    uninstall();
    findHeaderMenuButton()!.click();
    openMenu();
    await tick();
    assert.equal(document.querySelector(`[${MENU_ITEM_ATTR}]`), null);
  });
});

describe('findOpenMenu', () => {
  beforeEach(() => { installDom(CHAT); });

  it('works with unwrapped items too', async () => {
    const { findOpenMenu } = await import('../src/whatsapp/dom.ts');
    const host = document.createElement('div');
    host.innerHTML = '<ul role="menu"><li role="menuitem">A</li><li role="menuitem">B</li></ul>';
    document.body.append(host);
    const menu = findOpenMenu()!;
    assert.equal(menu.list.tagName, 'UL');
    assert.equal(menu.template.tagName, 'LI');
  });
});

/** A group member's menu, as WhatsApp shows one when a member is clicked. */
const MEMBER_MENU = `<div role="application" class="dropdown">
  <ul class="x1menu">
    <div><li tabindex="-1" class="x1item" data-animate-dropdown-item="true" role="button"><div class="x1label" role="button" aria-label="Message ~ Ana Paula">Message ~ Ana Paula</div></li></div>
    <div><li tabindex="-1" class="x1item" data-animate-dropdown-item="true" role="button"><div class="x1label" role="button" aria-label="Make group admin">Make group admin</div></li></div>
  </ul>
</div>`;

describe('menus about a person', () => {
  beforeEach(() => { installDom(CHAT); });

  it('reads who the menu is about from its "Message …" item, in several languages', () => {
    const list = (items: string[]) => {
      const ul = document.createElement('ul');
      for (const text of items) { const li = document.createElement('li'); li.textContent = text; ul.append(li); }
      return ul;
    };
    assert.equal(personInMenu(list(['Message ~ Ana Paula', 'Remove'])), 'Ana Paula');
    assert.equal(personInMenu(list(['Enviar mensaje a +54 9 11 7777-1111'])), '+54 9 11 7777-1111');
    assert.equal(personInMenu(list(['Envoyer un message à Bruno'])), 'Bruno');
    assert.equal(personInMenu(list(['Nachricht an Clara'])), 'Clara');
    assert.equal(personInMenu(list(['Contact info', 'Close chat'])), null);
    assert.equal(personInMenu(list(['Message'])), null);
  });

  it('adds “⚡ Nostr profile” to it, once, and opens the popup for that person', async () => {
    const opened: string[] = [];
    const escapes: string[] = [];
    document.addEventListener('keydown', e => escapes.push((e as KeyboardEvent).key));
    const stop = installPersonMenuItem(name => opened.push(name));
    const host = document.createElement('div');
    host.innerHTML = MEMBER_MENU;
    document.getElementById('app')!.append(host);
    await tick(60);
    const items = document.querySelectorAll(`[${MENU_ITEM_ATTR}]`);
    assert.equal(items.length, 1);
    assert.equal(items[0].textContent, MENU_ITEM_LABEL);
    (items[0] as HTMLElement).click();
    assert.deepEqual(opened, ['Ana Paula']);
    assert.deepEqual(escapes, ['Escape'], 'menu closed');
    stop();
  });

  it('leaves menus that are not about a person alone', async () => {
    const stop = installPersonMenuItem(() => {});
    openMenu();
    await tick(60);
    assert.equal(document.querySelector(`[${MENU_ITEM_ATTR}]`), null);
    stop();
  });
});
