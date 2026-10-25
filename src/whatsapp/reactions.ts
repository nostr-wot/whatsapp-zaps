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
 * - When the ⚡ press itself is not recognised (a picker drawing emoji as
 *   sprites), a message that gains a ⚡ badge within seconds of a click is
 *   still taken as the person's reaction. Messages that already had ⚡, or
 *   were not on screen at the click (scrolling), do not count.
 * Clicks that are not reactions are left alone: the emoji panel used while
 * typing (in the footer), existing badges and text inside messages, and this
 * extension's own dialog.
 */
import { messageAreaOf, messageRowOf } from './dom.ts';

const LIGHTNING = /^⚡️?$/;
const LIGHTNING_NAMES = /^(high[ -]?voltage|voltage|lightning|zap|alto voltaje|alta tensi[oó]n|rayo)$/i;

/** How long after acting on a message a ⚡ still counts as reacting to it. */
const REACTION_WINDOW_MS = 60_000;

/** How long to wait for WhatsApp to put the ⚡ badge on the message. */
const BADGE_WAIT_MS = 1_500;

/** A ⚡ badge appearing this soon after a click counts as the person's reaction. */
const BADGE_AFTER_CLICK_MS = 4_000;

const LIGHTNING_CODE = /(^|[^0-9a-f])26a1([^0-9a-f]|$)/i;

/**
 * True when `el` (or a close ancestor) is the ⚡ emoji: shown as text, an
 * image's alt text, a short label holding or naming it, or an emoji image
 * named by its code point (…/26a1.png).
 */
export function isLightningEmoji(el: Element | null): boolean {
  for (let node = el, depth = 0; node && depth < 3; node = node.parentElement, depth++) {
    const labels = ['alt', 'data-emoji', 'data-plain-text', 'aria-label', 'title'].map(a => (node!.getAttribute(a) ?? '').trim());
    const text = (node.textContent ?? '').trim();
    if ([...labels, text].some(v => LIGHTNING.test(v))) return true;
    if (labels.some(v => LIGHTNING_NAMES.test(v) || (v.length <= 40 && v.includes('\u26a1')))) return true;
    if (['src', 'style', 'data-src'].some(a => LIGHTNING_CODE.test(node!.getAttribute(a) ?? ''))) return true;
    // A larger container with more than the emoji in it is not the emoji.
    if (text && !LIGHTNING.test(text)) return false;
  }
  return false;
}

/**
 * ⚡ reaction badges on a message row: ⚡ elements outside the message's own
 * text (a message may itself contain ⚡, like a posted "⚡ Zapped …").
 */
export function lightningBadges(row: Element): number {
  let count = 0;
  // Badges may be drawn next to the bubble, in the same chat row.
  for (const el of Array.from(messageAreaOf(row).querySelectorAll('*'))) {
    if (el.children.length || el.closest('[data-pre-plain-text]')) continue;
    if (isLightningEmoji(el)) count++;
  }
  return count;
}

/**
 * Message rows touched by these mutations that gained a ⚡ badge: compared with
 * `before` when given (only rows in it count), else by a badge among the added nodes.
 */
function rowsWithNewBadges(records: MutationRecord[], before?: Map<Element, number>): HTMLElement[] {
  const touched = new Set<HTMLElement>();
  for (const record of records) {
    const target = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
    const row = messageRowOf(target);
    if (row) touched.add(row);
    for (const node of Array.from(record.addedNodes)) {
      const added = messageRowOf(node.nodeType === 1 ? node as Element : node.parentElement);
      if (added) touched.add(added);
    }
  }
  return [...touched].filter(row => {
    if (before) return before.has(row) && lightningBadges(row) > (before.get(row) ?? 0);
    return records.some(r => Array.from(r.addedNodes).some(n => {
      const el = n.nodeType === 1 ? n as Element : n.parentElement;
      return !!el && messageAreaOf(row).contains(el) && !el.closest('[data-pre-plain-text]')
        && (isLightningEmoji(el) || Array.from(el.querySelectorAll('*')).some(c => !c.children.length && isLightningEmoji(c)));
    }));
  });
}

/** A ⚡ badge just added inside a message row: the message reacted to. */
function rowWithNewBadge(records: MutationRecord[]): HTMLElement | null {
  return rowsWithNewBadges(records)[0] ?? null;
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
  /** Troubleshooting: hears every click outside the chat and every new element in a message. */
  trace: ((what: string, html: string) => void) | null = null,
): ReactionWatcher {
  // Badges per message when the person last clicked anywhere: a message that
  // gains a ⚡ badge right after is one they reacted to, however the picker is built.
  let snapshot: Map<Element, number> | null = null;
  let snapshotAt = -Infinity;
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
    if (trace) {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          const el = node.nodeType === 1 ? node as Element : null;
          if (el && messageRowOf(el) && !el.closest('[data-pre-plain-text]')) trace('added inside a message', el.outerHTML.slice(0, 3000));
        }
      }
    }
    if (pending) {
      const reacted = rowWithNewBadge(records);
      if (reacted) settle(reacted);
      return;
    }
    // No ⚡ press was recognised (unknown picker markup): a message that gains a
    // ⚡ badge shortly after a click is still the person's reaction.
    if (snapshot && now() - snapshotAt < BADGE_AFTER_CLICK_MS) {
      const [reacted] = rowsWithNewBadges(records, snapshot);
      if (reacted) {
        snapshot.set(reacted, lightningBadges(reacted));
        if (shouldHandle()) onReact(reacted);
      }
    }
  });

  const onPress = (event: Event) => {
    const target = event.target as Element | null;
    if (!(target instanceof Element)) return;
    if (event.type === 'pointerdown') {
      if (messageRowOf(target)) { row = lastRow() ?? messageRowOf(target); rowAt = now(); }
      if (target.closest('footer')) footerAt = now();
      else if (!target.closest('[data-whatsapp-zaps], [data-whatsapp-zaps-ui]')) {
        snapshot = new Map([...doc.querySelectorAll('#main [data-id]')].map(r => [r, lightningBadges(r)]));
        snapshotAt = now();
        if (trace && !messageRowOf(target)) {
          const around = target.parentElement?.parentElement ?? target;
          trace('click outside the chat', around.outerHTML.slice(0, 3000));
        }
      }
    }
    if (!isLightningEmoji(target)) return;
    if (target.closest('footer') || messageRowOf(target) || target.closest('[data-whatsapp-zaps], [data-whatsapp-zaps-ui]')) return;
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
