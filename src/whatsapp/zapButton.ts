/**
 * A small "⚡ 21" pill shown beside someone's message on hover: one click zaps the
 * message's author. Drawn entirely by this extension (in its own closed shadow
 * root), so it does not depend on WhatsApp's markup beyond finding messages —
 * the reliable way to zap a message when WhatsApp's own reactions cannot be
 * observed. Own messages get no button.
 */
import { attachStyles } from '../ui/styles.ts';
import { THEMES, themeCss, themeVars, type ThemeId } from '../ui/themes.ts';
import { messageAreaOf, messageRowOf, readMessageAuthor } from './dom.ts';

/** A Nostr WoT button in the chosen theme: its zap colour, 8px corners. */
const STYLE = `
:host { all: initial; }
:host { ${themeVars(THEMES.light)} }
${themeCss(id => `:host([data-theme="${id}"])`)}
button {
  position: fixed; z-index: 2147483645; height: 28px; padding: 0 10px 0 7px; margin: 0;
  display: inline-flex; align-items: center; gap: 3px; border-radius: 8px; border: 0; cursor: pointer;
  background: var(--zap); color: var(--text-on-brand); white-space: nowrap;
  font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .28);
  transition: transform .1s, filter .1s;
}
button .bolt { font-size: 13px; }
button:hover, button:focus-visible { filter: brightness(1.08); transform: translateY(-1px); outline: none; }
button:focus-visible { box-shadow: 0 2px 8px rgba(0, 0, 0, .28), var(--focus-ring); }
button[hidden] { display: none; }
@media (prefers-reduced-motion: reduce) { button { transition: none; } }
`;

export interface ZapButtonOptions {
  /** Amount shown in the tooltip. */
  amount: () => number;
  /** Clicks a person made (not scripts) only, unless tests say otherwise. */
  requireTrusted?: boolean;
  shouldHandle?: () => boolean;
  /** The Nostr WoT theme to draw in; Nostr WoT Light without it. */
  theme?: () => ThemeId;
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
    if (options.theme) host.dataset.theme = options.theme();
    const amount = options.amount();
    amountText.textContent = amount.toLocaleString('en-US');
    const label = `Zap ${amount.toLocaleString('en-US')} sats to ${readMessageAuthor(row).name ?? 'the author'}`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.style.top = `${at.top}px`;
    button.hidden = false;
    // Keep the whole button on screen beside a message that reaches the right edge.
    const width = button.getBoundingClientRect().width || 64;
    button.style.left = `${Math.max(4, Math.min(at.left, window.innerWidth - width - 8))}px`;
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
