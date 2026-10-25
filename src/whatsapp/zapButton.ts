/**
 * A small "⚡ 21" pill shown beside someone's message on hover: one click zaps the
 * message's author. Drawn entirely by this extension (in its own closed shadow
 * root), so it does not depend on WhatsApp's markup beyond finding messages —
 * the reliable way to zap a message when WhatsApp's own reactions cannot be
 * observed. Own messages get no button.
 */
import { attachStyles } from '../ui/styles.ts';
import { messageAreaOf, messageRowOf, readMessageAuthor } from './dom.ts';

const STYLE = `
:host { all: initial; }
button {
  position: fixed; z-index: 2147483645; height: 28px; padding: 0 11px 0 8px; margin: 0;
  display: inline-flex; align-items: center; gap: 3px; border-radius: 999px; border: 0; cursor: pointer;
  background: #00a884; color: #fff; white-space: nowrap;
  font: 700 13px/1 "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif; font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 6px rgba(11, 20, 26, .3);
  transition: transform .1s, background .1s;
}
button .bolt { color: #ffd23f; font-size: 14px; }
button:hover, button:focus-visible { background: #008069; transform: translateY(-1px); outline: none; }
button[hidden] { display: none; }
@media (prefers-reduced-motion: reduce) { button { transition: none; } }
`;

export interface ZapButtonOptions {
  /** Amount shown in the tooltip. */
  amount: () => number;
  /** Clicks a person made (not scripts) only, unless tests say otherwise. */
  requireTrusted?: boolean;
  shouldHandle?: () => boolean;
}

/** Where the button goes: just right of the message bubble, at its top. */
export function buttonPosition(row: Element): { top: number; left: number } | null {
  const bubble = row.querySelector('[data-pre-plain-text]') ?? row;
  const rect = bubble.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return { top: Math.max(4, rect.top + 2), left: Math.min(window.innerWidth - 36, rect.right + 6) };
}

export function installZapButton(onZap: (row: HTMLElement) => void, options: ZapButtonOptions, doc: Document = document): () => void {
  const host = doc.createElement('div');
  host.setAttribute('data-whatsapp-zaps-ui', 'zap-button');
  const shadow = host.attachShadow({ mode: options.requireTrusted === false ? 'open' : 'closed' });
  attachStyles(shadow, STYLE);
  const button = doc.createElement('button');
  button.type = 'button';
  const bolt = doc.createElement('span');
  bolt.className = 'bolt';
  bolt.textContent = '⚡';
  const amountText = doc.createElement('span');
  button.append(bolt, amountText);
  button.hidden = true;
  shadow.append(button);
  doc.body.append(host);

  let current: HTMLElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const hide = () => { button.hidden = true; current = null; };
  const show = (row: HTMLElement) => {
    clearTimeout(hideTimer);
    if (current === row && !button.hidden) return;
    const at = buttonPosition(row);
    if (!at) return;
    current = row;
    const amount = options.amount();
    amountText.textContent = amount.toLocaleString('en-US');
    const label = `Zap ${amount.toLocaleString('en-US')} sats to ${readMessageAuthor(row).name ?? 'the author'}`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.style.top = `${at.top}px`;
    button.style.left = `${at.left}px`;
    button.hidden = false;
  };

  const onOver = (event: Event) => {
    if (options.shouldHandle && !options.shouldHandle()) return;
    const row = messageRowOf(event.target);
    if (!row) return;
    if (readMessageAuthor(row).fromMe) { hide(); return; }
    show(row);
  };
  const onOut = (event: Event) => {
    const to = (event as MouseEvent).relatedTarget as Node | null;
    // Moving onto the button, or within the same message, keeps it.
    if (to && (to === host || (current && messageAreaOf(current).contains(to)))) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 250);
  };
  const onScroll = () => hide();

  button.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  button.addEventListener('mouseleave', () => { hideTimer = setTimeout(hide, 250); });
  button.addEventListener('click', event => {
    if (options.requireTrusted !== false && !event.isTrusted) return;
    const row = current;
    hide();
    if (row && row.isConnected) onZap(row);
  });

  doc.addEventListener('mouseover', onOver, true);
  doc.addEventListener('mouseout', onOut, true);
  doc.addEventListener('scroll', onScroll, true);
  return () => {
    doc.removeEventListener('mouseover', onOver, true);
    doc.removeEventListener('mouseout', onOut, true);
    doc.removeEventListener('scroll', onScroll, true);
    clearTimeout(hideTimer);
    host.remove();
  };
}
