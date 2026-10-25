/**
 * Add "Nostr profile" to the chat header's ⋮ menu.
 *
 * WhatsApp builds the dropdown when the button is clicked, so the item is
 * added each time a dropdown appears right after a click on that button. The
 * item copies an existing item's markup for its look, but it is our own node
 * with our own listener: React never sees it.
 */
import { findOpenMenu, isHeaderMenuButton } from './dom.ts';

export const MENU_ITEM_ATTR = 'data-whatsapp-zaps-item';
export const MENU_ITEM_LABEL = '⚡ Nostr profile';

/** How long after the ⋮ click to wait for the dropdown to appear. */
const MENU_WAIT_MS = 2_000;

/** Build our item from a copy of one of WhatsApp's. */
export function buildMenuItem(template: HTMLElement, onSelect: () => void): HTMLElement {
  const item = template.cloneNode(true) as HTMLElement;
  item.setAttribute(MENU_ITEM_ATTR, '');
  for (const el of [item, ...item.querySelectorAll<HTMLElement>('*')]) {
    el.removeAttribute('aria-label');
    el.removeAttribute('title');
    el.removeAttribute('id');
  }
  // Put the label in the innermost element that held text, keeping its styling.
  const textHolder = [...item.querySelectorAll<HTMLElement>('*')].reverse().find(el => el.textContent?.trim()) ?? item;
  textHolder.textContent = MENU_ITEM_LABEL;
  const select = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
  };
  item.addEventListener('click', select);
  item.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') select(event); });
  return item;
}

/** Add our item to the open dropdown, once. Returns true when it is there. */
export function addItemToOpenMenu(onSelect: () => void, doc: Document = document): boolean {
  const menu = findOpenMenu(doc);
  if (!menu) return false;
  if (menu.list.querySelector(`[${MENU_ITEM_ATTR}]`)) return true;
  menu.list.append(buildMenuItem(menu.template, onSelect));
  return true;
}

/** Close WhatsApp's dropdown the way a person would. */
function closeMenu(doc: Document) {
  doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
}

/**
 * Watch for the header ⋮ menu opening and add our item to it.
 * Returns an uninstall function.
 */
export function installMenuItem(
  onOpen: () => void,
  doc: Document = document,
  /** False makes this copy leave the menu alone (another copy adds the item). */
  shouldHandle: () => boolean = () => true,
): () => void {
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stopWatching = () => {
    observer?.disconnect();
    observer = null;
    clearTimeout(timer);
  };
  const onSelect = () => {
    stopWatching();
    closeMenu(doc);
    onOpen();
  };

  const onClick = (event: Event) => {
    if (!isHeaderMenuButton(event.target, doc) || !shouldHandle()) return;
    stopWatching();
    // The dropdown renders after this click; it may already be there next tick.
    if (addItemToOpenMenu(onSelect, doc)) return;
    observer = new MutationObserver(() => { if (addItemToOpenMenu(onSelect, doc)) stopWatching(); });
    observer.observe(doc.body, { childList: true, subtree: true });
    timer = setTimeout(stopWatching, MENU_WAIT_MS);
  };

  doc.addEventListener('click', onClick, true);
  return () => {
    stopWatching();
    doc.removeEventListener('click', onClick, true);
  };
}
