/**
 * "⚡ Nostr" buttons wherever WhatsApp offers ways to reach someone: beside
 * the Voice / Video / Search buttons of contact and group info, the call and
 * search icons of the chat header, and the icons of profile previews. Each
 * opens the Nostr profile popup for whoever that place is about.
 *
 * Rows are found by what they offer, not by WhatsApp's markup: two or more
 * sibling actions named like WhatsApp's message, call, search and info
 * actions — by a caption under the icon ("Voice") or by the accessible name
 * of an icon-only button ("Video call") — in a few languages, outside the
 * conversation itself and outside lists. The button is a copy of the last of
 * them, so it takes WhatsApp's own look; its icon, label and click handler
 * are this extension's.
 */
import { normalizeText } from '../domain/command.ts';
import { normalizeName } from '../domain/mappings.ts';
import { readChatTitle, type ChatContact } from './dom.ts';

export const CONTACT_BUTTON_ATTR = 'data-whatsapp-zaps-ui';
export const CONTACT_BUTTON_VALUE = 'contact-nostr';

/** Captions under WhatsApp's contact action icons (English, Spanish, Portuguese, French, German, Italian). */
const CAPTION = /^(voice|audio|video|search|call|message|voz|llamada|llamar|vídeo|buscar|mensaje|chamada|ligar|pesquisar|mensagem|appel|vocal|vidéo|rechercher|recherche|anruf|sprachanruf|videoanruf|suche|suchen|nachricht|chiamata|voce|cerca|messaggio)$/i;

/** Accessible names of WhatsApp's icon-only contact actions, in the same languages. */
const ACTION_NAME = new RegExp(`^(${[
  'message', 'send message', 'chat', 'voice call', 'video call', 'audio call', 'call', 'start voice call', 'start video call',
  'search', 'search messages', 'info', 'contact info', 'group info', 'get the app for calling',
  'mensaje', 'enviar mensaje', 'llamada de voz', 'llamada de video', 'llamada de vídeo', 'videollamada', 'llamar', 'llamada',
  'buscar', 'buscar mensajes', 'info. del contacto', 'info. de contacto', 'info. del grupo',
  'mensagem', 'enviar mensagem', 'conversa', 'chamada de voz', 'chamada de vídeo', 'ligar', 'chamada', 'pesquisar',
  'pesquisar mensagens', 'dados do contato', 'dados do grupo',
  'envoyer un message', 'discussion', 'appel vocal', 'appel vidéo', 'appeler', 'appel', 'rechercher',
  'rechercher des messages', 'infos du contact', 'infos du groupe',
  'nachricht', 'nachricht senden', 'sprachanruf', 'videoanruf', 'anrufen', 'anruf', 'suchen', 'suche',
  'nachrichten durchsuchen', 'kontaktinfo', 'gruppeninfo',
  'messaggio', 'invia messaggio', 'chiamata vocale', 'videochiamata', 'chiama', 'chiamata', 'cerca', 'cerca messaggi',
  'info contatto', 'info gruppo',
].map(name => name.replace(/[.]/g, '\\.')).join('|')})$`, 'i');

/** Titles of WhatsApp's own panels, never a person's name. */
const PANEL_TITLE = /^(contact info|group info|business info|info\. del contacto|info\. de contacto|info\. del grupo|dados do contato|dados do grupo|infos du contact|infos du groupe|kontaktinfo|gruppeninfo|info contatto|info gruppo|about|info|nostr|media, links and docs)$/i;

/** Where no button goes: the conversation (except its header), the message box, lists, and this extension's own UI. */
const LIST_ITEM = '[role="listitem"], [role="row"], [role="gridcell"], [role="option"], [role="menuitem"], li';

const SVG = 'http://www.w3.org/2000/svg';

const clean = (text: string) => normalizeText(text).replace(/(\.\.\.|…)$/, '').trim();

function isCaption(el: Element): boolean {
  return el.children.length === 0 && CAPTION.test(clean(el.textContent ?? ''));
}

/** An icon-only button named like a contact action. */
function isNamedAction(el: Element): boolean {
  if (!el.matches('button, [role="button"]')) return false;
  const name = el.getAttribute('aria-label') || el.getAttribute('title') || '';
  return ACTION_NAME.test(clean(name));
}

function isAction(el: Element): boolean {
  return isCaption(el) || isNamedAction(el);
}

/** Outside the places a button never goes. */
export function isEligible(el: Element): boolean {
  if (el.closest('footer, [data-whatsapp-zaps], [data-whatsapp-zaps-ui]')) return false;
  if (el.closest('#main') && !el.closest('#main header')) return false;
  return !el.closest(LIST_ITEM);
}

/** The direct child of `row` that holds `el`. */
function childOf(row: Element, el: Element): Element | null {
  let node: Element | null = el;
  while (node && node.parentElement !== row) node = node.parentElement;
  return node;
}

/**
 * The rows of contact actions inside `root`: the nearest element with two or
 * more children holding WhatsApp's contact actions (at most eight children, so
 * a whole panel never counts as a row). Captions and icon buttons are counted
 * apart, so one action's icon and its caption are never taken for a row.
 */
export function findActionRows(root: ParentNode): Element[] {
  const all = Array.from(root.querySelectorAll('span, div, p, button, [role="button"]'));
  // The cheap tests first: most of WhatsApp is neither a caption nor a named button.
  const captions = all.filter(el => isCaption(el) && isEligible(el));
  const named = all.filter(el => isNamedAction(el) && isEligible(el));
  const holding = (children: Element[], actions: Element[]) =>
    children.filter(child => actions.some(a => child === a || child.contains(a))).length;
  const rows = new Set<Element>();
  for (const action of [...captions, ...named]) {
    for (let node = action.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
      if (node.children.length > 8) continue;
      const children = Array.from(node.children);
      if (holding(children, captions) >= 2 || holding(children, named) >= 2) { rows.add(node); break; }
    }
  }
  // Keep the innermost row where two were found one inside the other.
  return [...rows].filter(row => ![...rows].some(other => other !== row && row.contains(other)));
}

/** Whether WhatsApp shows `name` for a chat: the open chat's title, or one in the chat list. */
export function isChatName(name: string, doc: Document = document): boolean {
  const wanted = normalizeName(name);
  if (!wanted) return false;
  if (normalizeName(readChatTitle(doc) ?? '') === wanted) return true;
  return Array.from(doc.querySelectorAll('#pane-side [title]')).some(el => normalizeName(el.getAttribute('title') ?? '') === wanted);
}

/** WhatZaps's bolt, sized like the icon it replaces. */
function boltIcon(like: Element | null): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', like?.getAttribute('width') ?? '24');
  svg.setAttribute('height', like?.getAttribute('height') ?? '24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-whatsapp-zaps-bolt', '');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2L13.5 2z');
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

/** Colour every bolt this extension has added (the theme's mark colour). */
export function paintBolts(color: string, doc: Document = document): void {
  for (const bolt of Array.from(doc.querySelectorAll<SVGElement>('svg[data-whatsapp-zaps-bolt]'))) bolt.style.color = color;
}

/** Add the Nostr button to one action row, once. Returns it. */
export function addNostrButton(row: Element, onOpen: () => void, color?: string): HTMLElement | null {
  const existing = row.querySelector(`[${CONTACT_BUTTON_ATTR}="${CONTACT_BUTTON_VALUE}"]`);
  if (existing) return existing as HTMLElement;
  const actions = Array.from(row.querySelectorAll('*')).filter(isAction);
  const last = actions[actions.length - 1];
  const template = last ? childOf(row, last) : null;
  if (!template) return null;
  const button = template.cloneNode(true) as HTMLElement;
  button.setAttribute(CONTACT_BUTTON_ATTR, CONTACT_BUTTON_VALUE);
  for (const el of [button, ...button.querySelectorAll<HTMLElement>('*')]) {
    for (const attr of ['id', 'title', 'aria-label', 'data-icon', 'aria-expanded', 'aria-haspopup', 'aria-pressed', 'aria-describedby', 'data-testid']) {
      el.removeAttribute(attr);
    }
  }
  const icon = button.querySelector('svg');
  if (icon) {
    const bolt = boltIcon(icon);
    if (color) bolt.style.color = color;
    icon.replaceWith(bolt);
  }
  const caption = Array.from(button.querySelectorAll('*')).find(isCaption) ?? (isCaption(button) ? button : null);
  if (caption) caption.textContent = 'Nostr';
  const clickable = (button.matches('[role="button"], button') ? button : button.querySelector('[role="button"], button')) as HTMLElement | null ?? button;
  clickable.setAttribute('aria-label', 'Nostr profile');
  clickable.setAttribute('title', 'Nostr profile and Lightning Address');
  const open = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    onOpen();
  };
  button.addEventListener('click', open);
  button.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') open(event); });
  template.after(button);
  return button;
}

/** Who a row of actions is about, as far as the place it is in shows. */
export interface ShownContact {
  /** In the open chat's header: always about the open chat. */
  inHeader: boolean;
  /** A phone number shown nearby, as a contact id. */
  id: string | null;
  /** A name shown nearby. */
  name: string | null;
}

const PHONE = /^\+[\d\s().-]{7,}$/;

/** A phone number as WhatsApp shows it ("+54 9 11 7777-1111"), as a contact id. */
export function phoneIdOf(text: string): string | null {
  const shown = normalizeText(text);
  if (!PHONE.test(shown)) return null;
  const digits = shown.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? `${digits}@c.us` : null;
}

/** The ancestors of `row` that still belong to its panel: never the whole app. */
function panelAncestors(row: Element): Element[] {
  const out: Element[] = [];
  for (let node = row.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
    if (node.matches('body, #app') || node.querySelector('#main, #pane-side')) break;
    out.push(node);
  }
  return out;
}

/**
 * What an element shows as text: its title, or its text with emoji pictures
 * read as their characters (WhatsApp draws emoji in names as images).
 */
function shownText(el: Element): string {
  const title = el.getAttribute('title');
  if (title) return normalizeText(title);
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) text += node.textContent ?? '';
    else if ((node as Element).tagName === 'IMG') text += (node as Element).getAttribute('alt') ?? '';
  }
  return normalizeText(text);
}

/**
 * Texts above `row` inside `root`, nearest first: elements holding only text
 * (and emoji pictures), outside the row itself.
 */
function textsAbove(root: Element, row: Element): string[] {
  return Array.from(root.querySelectorAll('span, div, h1, h2, h3, p'))
    .filter(el => !row.contains(el) && Array.from(el.children).every(child => child.tagName === 'IMG')
      && !!(el.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING))
    .map(shownText)
    .filter(Boolean)
    .reverse();
}

/**
 * The phone number shown above the actions (contact info shows the person's
 * number there; a group's member list comes below), as a contact id.
 */
export function phoneIdNear(row: Element): string | null {
  for (const panel of panelAncestors(row)) {
    for (const text of textsAbove(panel, row)) {
      const id = phoneIdOf(text);
      if (id) return id;
    }
  }
  return null;
}

/**
 * The name shown with the actions: the nearest text above them that is not a
 * phone number, a caption or a panel title. A name WhatsApp shows elsewhere
 * (`isKnownName`: the open chat, the chat list) wins over other text.
 */
export function nameNear(row: Element, isKnownName: (name: string) => boolean = () => false): string | null {
  let fallback: string | null = null;
  for (const panel of panelAncestors(row)) {
    for (const text of textsAbove(panel, row)) {
      const name = text.replace(/^~\s*/, '');
      if (!name || name.length > 60 || PHONE.test(name) || CAPTION.test(clean(name)) || PANEL_TITLE.test(clean(name))) continue;
      if (isKnownName(name)) return name;
      fallback ??= name;
    }
  }
  return fallback;
}

export function shownNear(row: Element, isKnownName?: (name: string) => boolean): ShownContact {
  if (row.closest('#main header')) return { inHeader: true, id: null, name: null };
  return { inHeader: false, id: phoneIdNear(row), name: nameNear(row, isKnownName) };
}

/**
 * Who the popup should be for. The open chat, when the place is its header,
 * shows its name or number, or shows nothing to tell; otherwise the person
 * shown there (a member of a group, someone from the chat list).
 */
export function contactForShown(shown: ShownContact, chat: ChatContact | null): ChatContact | null {
  if (shown.inHeader || (!shown.id && !shown.name)) return chat;
  const chatName = chat ? (chat.kind === 'group' ? chat.title : chat.name) : null;
  const sameName = !!shown.name && !!chatName && normalizeName(shown.name) === normalizeName(chatName);
  const sameId = !!shown.id && chat?.kind === 'contact' && chat.id === shown.id;
  if (sameName || sameId) return chat;
  if (shown.id) return { kind: 'contact', id: shown.id, name: shown.name ?? `+${shown.id.replace(/@.*/, '')}` };
  return { kind: 'contact', id: null, name: shown.name! };
}

/**
 * Watch for rows of contact actions and add the button to each. `onOpen`
 * gets the row, to read who it is about when clicked (panels change while
 * open). `color` is the bolt's colour. Returns an uninstall function.
 */
export function installContactInfoButton(
  onOpen: (row: Element) => void,
  doc: Document = document,
  shouldHandle: () => boolean = () => true,
  color: () => string | undefined = () => undefined,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Element[] = [];
  const scan = () => {
    timer = undefined;
    if (!shouldHandle()) { pending = []; return; }
    const roots = pending.filter(r => r.isConnected);
    pending = [];
    for (const root of roots) {
      for (const row of findActionRows(root)) {
        addNostrButton(row, () => onOpen(row), color());
      }
    }
  };
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType !== 1) continue;
        const el = node as Element;
        if (el.closest('[data-whatsapp-zaps], [data-whatsapp-zaps-ui]') || el.closest(LIST_ITEM)) continue;
        // The conversation changes all the time; only its header has actions.
        if (el.closest('#main')) {
          const header = el.closest('#main header') ?? el.querySelector('header');
          if (header) pending.push(header);
          continue;
        }
        pending.push(el);
      }
    }
    if (pending.length && !timer) timer = setTimeout(scan, 150);
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  // Panels already open when the extension starts.
  pending.push(doc.body);
  timer = setTimeout(scan, 0);
  return () => { observer.disconnect(); clearTimeout(timer); };
}
