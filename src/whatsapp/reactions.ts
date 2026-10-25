/**
 * Notice when the person reacts to a message with ⚡.
 *
 * Nothing here depends on how WhatsApp builds its reaction picker:
 * - The ⚡ is recognised by the emoji itself — text, an image's alt text,
 *   data-emoji, or a label naming it ("high voltage") — on the first of
 *   pointerdown / mousedown / click, since a picker may apply the reaction and
 *   close on press, before any click.
 * - The message is the one that then gets a ⚡ reaction badge: WhatsApp adds
 *   one to the message reacted to. When no badge appears (unknown markup),
 *   the message last acted on is used, if recent and still on screen.
 * Clicks that are not reactions are left alone: the emoji panel used while
 * typing (in the footer), existing badges and text inside messages, and this
 * extension's own dialog.
 */
import { messageRowOf } from './dom.ts';

const LIGHTNING = /^⚡️?$/;
const LIGHTNING_NAMES = /^(high[ -]?voltage|voltage|lightning|zap|alto voltaje|alta tensi[oó]n|rayo)$/i;

/** How long after acting on a message a ⚡ still counts as reacting to it. */
const REACTION_WINDOW_MS = 60_000;

/** How long to wait for WhatsApp to put the ⚡ badge on the message. */
const BADGE_WAIT_MS = 1_500;

/** True when `el` (or a close ancestor) shows nothing but the ⚡ emoji. */
export function isLightningEmoji(el: Element | null): boolean {
  for (let node = el, depth = 0; node && depth < 3; node = node.parentElement, depth++) {
    const values = ['alt', 'data-emoji', 'data-plain-text', 'aria-label', 'title'].map(a => (node!.getAttribute(a) ?? '').trim());
    const text = (node.textContent ?? '').trim();
    if ([...values, text].some(v => LIGHTNING.test(v)) || values.some(v => LIGHTNING_NAMES.test(v))) return true;
    // A larger container with more than the emoji in it is not the emoji.
    if (text && !LIGHTNING.test(text)) return false;
  }
  return false;
}

/** A ⚡ badge just added inside a message row: the message reacted to. */
function rowWithNewBadge(records: MutationRecord[]): HTMLElement | null {
  for (const record of records) {
    for (const node of Array.from(record.addedNodes)) {
      const el = node.nodeType === 1 ? node as Element : node.parentElement;
      if (!el) continue;
      const row = messageRowOf(el);
      if (!row) continue;
      const candidates = [el, ...el.querySelectorAll('*')];
      if (candidates.some(c => isLightningEmoji(c) && !c.children.length) || isLightningEmoji(el)) return row;
    }
    if (record.type === 'characterData' && LIGHTNING.test((record.target.nodeValue ?? '').trim())) {
      const row = messageRowOf(record.target.parentElement);
      if (row) return row;
    }
  }
  return null;
}

export interface ReactionWatcher {
  uninstall(): void;
}

/** Why a ⚡ was seen but not acted on; for diagnostics. */
export interface MissedReaction {
  reason: string;
  pickerHtml: string;
}

/**
 * Call `onReact(row)` when the person reacts to message `row` with ⚡.
 * `lastRow` gives the message last acted on (see replies.ts). `onMissed`
 * hears about a ⚡ that could not be tied to a message.
 */
export function installReactionWatcher(
  onReact: (row: HTMLElement) => void,
  lastRow: () => HTMLElement | null,
  doc: Document = document,
  shouldHandle: () => boolean = () => true,
  now: () => number = Date.now,
  onMissed: (missed: MissedReaction) => void = () => {},
  badgeWaitMs: number = BADGE_WAIT_MS,
): ReactionWatcher {
  let rowAt = 0;
  let row: HTMLElement | null = null;
  let footerAt = 0;
  let pending: { at: number; timer: ReturnType<typeof setTimeout>; pickerHtml: string; typedSince: boolean } | null = null;
  let lastGestureAt = -Infinity;

  const settle = (reacted: HTMLElement | null) => {
    if (!pending) return;
    const { pickerHtml, typedSince } = pending;
    clearTimeout(pending.timer);
    pending = null;
    // A ⚡ badge on a message proves a reaction, whatever happened before.
    if (reacted) {
      if (shouldHandle()) onReact(reacted);
      return;
    }
    // No badge appeared: fall back to the message last acted on — unless the
    // person typed since, in which case this ⚡ was the typing emoji panel.
    const current = lastRow() ?? row;
    if (current && current.isConnected && now() - rowAt <= REACTION_WINDOW_MS && !typedSince) {
      if (shouldHandle()) onReact(current);
    } else {
      onMissed({
        reason: typedSince ? 'no badge, and typing happened since the message was acted on'
          : current ? 'no badge, and the message acted on was too long ago' : 'no badge, and no message acted on',
        pickerHtml,
      });
    }
  };

  const observer = new MutationObserver(records => {
    if (!pending) return;
    const reacted = rowWithNewBadge(records);
    if (reacted) settle(reacted);
  });

  const onPress = (event: Event) => {
    const target = event.target as Element | null;
    if (!(target instanceof Element)) return;
    if (event.type === 'pointerdown') {
      if (messageRowOf(target)) { row = lastRow() ?? messageRowOf(target); rowAt = now(); }
      if (target.closest('footer')) footerAt = now();
    }
    if (!isLightningEmoji(target)) return;
    if (target.closest('footer') || messageRowOf(target) || target.closest('[data-whatsapp-zaps]')) return;
    // One press fires pointerdown, mousedown and click: act on the first. A new
    // pointerdown is always a new press; mousedown/click right after one are not.
    if (event.type !== 'pointerdown' && now() - lastGestureAt < 800) return;
    lastGestureAt = now();
    const picker = target.closest('[role="dialog"],[role="menu"],[role="listbox"],[role="application"]') ?? target.parentElement?.parentElement ?? target;
    clearTimeout(pending?.timer);
    pending = {
      at: now(),
      pickerHtml: picker.outerHTML.slice(0, 15_000),
      typedSince: footerAt > 0 && footerAt >= rowAt,
      timer: setTimeout(() => settle(null), badgeWaitMs),
    };
  };

  for (const type of ['pointerdown', 'mousedown', 'click']) doc.addEventListener(type, onPress, true);
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
  return {
    uninstall() {
      for (const type of ['pointerdown', 'mousedown', 'click']) doc.removeEventListener(type, onPress, true);
      observer.disconnect();
      clearTimeout(pending?.timer);
      pending = null;
    },
  };
}
