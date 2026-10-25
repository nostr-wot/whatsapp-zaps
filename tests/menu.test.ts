import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.ts';
import { MENU_ITEM_ATTR, MENU_ITEM_LABEL, addItemToOpenMenu, buildMenuItem, installMenuItem } from '../src/whatsapp/menu.ts';
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
