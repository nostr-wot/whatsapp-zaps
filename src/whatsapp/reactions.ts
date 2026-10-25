/**
 * Notice when the person reacts to a message with ⚡.
 *
 * WhatsApp's reaction picker opens from a button on the message, so the
 * message is the one last acted on (see replies.ts). The ⚡ is recognised by
 * the emoji itself — its text, or an image's alt text — not by WhatsApp's
 * markup. Clicks that are not reactions are left alone: the emoji panel used
 * while typing (in the footer), existing reaction badges and text inside
 * messages, and this extension's own dialog.
 */
import { messageRowOf } from './dom.ts';

const LIGHTNING = /^⚡️?$/;

/** How long after acting on a message a ⚡ click still counts as reacting to it. */
const REACTION_WINDOW_MS = 60_000;

/** True when `el` (or a close ancestor) shows nothing but the ⚡ emoji. */
export function isLightningEmoji(el: Element | null): boolean {
  for (let node = el, depth = 0; node && depth < 3; node = node.parentElement, depth++) {
    const label = [
      node.getAttribute('alt'),
      node.getAttribute('data-emoji'),
      node.getAttribute('aria-label'),
      node.textContent,
    ].map(v => (v ?? '').trim());
    if (label.some(v => LIGHTNING.test(v))) return true;
    // A larger container with more than the emoji in it is not the emoji.
    if ((node.textContent ?? '').trim() && !LIGHTNING.test((node.textContent ?? '').trim())) return false;
  }
  return false;
}

export interface ReactionWatcher {
  uninstall(): void;
}

/**
 * Call `onReact(row)` when the person picks ⚡ in a reaction picker opened
 * from message `row`. `lastRow` gives the message last acted on.
 */
export function installReactionWatcher(
  onReact: (row: HTMLElement) => void,
  lastRow: () => HTMLElement | null,
  doc: Document = document,
  shouldHandle: () => boolean = () => true,
  now: () => number = Date.now,
): ReactionWatcher {
  let rowAt = 0;
  let row: HTMLElement | null = null;
  let footerAt = 0;

  const onPointer = (event: Event) => {
    const target = event.target as Element | null;
    if (messageRowOf(target)) { row = lastRow() ?? messageRowOf(target); rowAt = now(); }
    if (target instanceof Element && target.closest('footer')) footerAt = now();
  };
  const onClick = (event: Event) => {
    const target = event.target as Element | null;
    if (!(target instanceof Element) || !isLightningEmoji(target)) return;
    if (target.closest('footer') || messageRowOf(target) || target.closest('[data-whatsapp-zaps]')) return;
    // Typing (the footer) since the message was acted on means this is the emoji panel.
    const current = lastRow() ?? row;
    if (!current || !current.isConnected || now() - rowAt > REACTION_WINDOW_MS || (footerAt > 0 && footerAt >= rowAt)) return;
    if (!shouldHandle()) return;
    // The reaction itself goes through to WhatsApp untouched.
    onReact(current);
  };

  doc.addEventListener('pointerdown', onPointer, true);
  doc.addEventListener('click', onClick, true);
  return {
    uninstall() {
      doc.removeEventListener('pointerdown', onPointer, true);
      doc.removeEventListener('click', onClick, true);
    },
  };
}
