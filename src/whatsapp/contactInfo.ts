/**
 * A "⚡ Nostr" button in WhatsApp's contact info — next to its own Voice,
 * Video and Search buttons, in the full panel and in the compact preview —
 * opening the Nostr profile popup for that contact.
 *
 * The row is found by what it shows, not by WhatsApp's markup: two or more
 * sibling buttons labelled like WhatsApp's call and search actions (in a few
 * languages), outside the conversation itself. The button is a copy of the
 * last of them, so it takes WhatsApp's own look; its icon, label and click
 * handler are this extension's.
 */
import { normalizeText } from '../domain/command.ts';

export const CONTACT_BUTTON_ATTR = 'data-whatsapp-zaps-ui';
export const CONTACT_BUTTON_VALUE = 'contact-nostr';

/** Labels of WhatsApp's contact actions (English, Spanish, Portuguese, French, German, Italian). */
const ACTION_LABEL = /^(voice|audio|video|search|call|voz|llamada|llamar|vídeo|buscar|chamada|ligar|pesquisar|appel|vocal|vidéo|rechercher|recherche|anruf|sprachanruf|videoanruf|suche|suchen|chiamata|voce|cerca)$/i;

const SVG = 'http://www.w3.org/2000/svg';

function isLabel(el: Element): boolean {
  return el.children.length === 0 && ACTION_LABEL.test(normalizeText(el.textContent ?? ''));
}

/** The direct child of `row` that holds `el`. */
function childOf(row: Element, el: Element): Element | null {
  let node: Element | null = el;
  while (node && node.parentElement !== row) node = node.parentElement;
  return node;
}

/**
 * The rows of contact actions inside `root`: an element whose children are
 * two or more of WhatsApp's labelled action buttons.
 */
export function findActionRows(root: ParentNode): Element[] {
  const rows = new Set<Element>();
  for (const label of Array.from(root.querySelectorAll('span, div, p'))) {
    if (!isLabel(label)) continue;
    if (label.closest('#main, #pane-side, footer, [data-whatsapp-zaps], [data-whatsapp-zaps-ui]')) continue;
    // Climb from the label to the row: the first ancestor with two or more
    // children that each carry an action label.
    for (let node = label.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
      const actions = Array.from(node.children).filter(c => Array.from(c.querySelectorAll('*')).some(isLabel) || isLabel(c));
      if (actions.length >= 2 && node.children.length <= 6) { rows.add(node); break; }
    }
  }
  return [...rows];
}

/** WhatZaps's bolt, sized like the icon it replaces. */
function boltIcon(like: Element | null): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', like?.getAttribute('width') ?? '24');
  svg.setAttribute('height', like?.getAttribute('height') ?? '24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2L13.5 2z');
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

/** Add the Nostr button to one action row, once. Returns it. */
export function addNostrButton(row: Element, onOpen: () => void): HTMLElement | null {
  const existing = row.querySelector(`[${CONTACT_BUTTON_ATTR}="${CONTACT_BUTTON_VALUE}"]`);
  if (existing) return existing as HTMLElement;
  const labels = Array.from(row.querySelectorAll('*')).filter(isLabel);
  const last = labels[labels.length - 1];
  const template = last ? childOf(row, last) : null;
  if (!template) return null;
  const button = template.cloneNode(true) as HTMLElement;
  button.setAttribute(CONTACT_BUTTON_ATTR, CONTACT_BUTTON_VALUE);
  for (const el of [button, ...button.querySelectorAll<HTMLElement>('*')]) {
    el.removeAttribute('id');
    el.removeAttribute('title');
    el.removeAttribute('aria-label');
    el.removeAttribute('data-icon');
  }
  const icon = button.querySelector('svg');
  if (icon) icon.replaceWith(boltIcon(icon));
  const label = Array.from(button.querySelectorAll('*')).find(isLabel) ?? (isLabel(button) ? button : null);
  if (label) label.textContent = 'Nostr';
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

/** A phone number shown near the actions (contact info shows the number), as a contact id. */
export function phoneIdNear(row: Element): string | null {
  let panel: Element | null = row;
  for (let i = 0; i < 6 && panel?.parentElement; i++) panel = panel.parentElement;
  for (const el of Array.from(panel?.querySelectorAll('span, div') ?? [])) {
    if (el.children.length) continue;
    const text = normalizeText(el.textContent ?? '');
    if (!/^\+[\d\s().-]{7,}$/.test(text)) continue;
    const digits = text.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 15) return `${digits}@c.us`;
  }
  return null;
}

/**
 * Watch for contact info panels and add the button to each. `onOpen` gets
 * the phone-number id shown in that panel, when there is one.
 * Returns an uninstall function.
 */
export function installContactInfoButton(
  onOpen: (shownId: string | null) => void,
  doc: Document = document,
  shouldHandle: () => boolean = () => true,
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
        addNostrButton(row, () => onOpen(phoneIdNear(row)));
      }
    }
  };
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        // The conversation and the chat list change all the time and hold no contact info.
        if (node.nodeType === 1 && !(node as Element).closest('#main, #pane-side')) pending.push(node as Element);
      }
    }
    if (pending.length && !timer) timer = setTimeout(scan, 150);
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  // A panel already open when the extension starts.
  pending.push(doc.body);
  timer = setTimeout(scan, 0);
  return () => { observer.disconnect(); clearTimeout(timer); };
}
