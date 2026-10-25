/**
 * Remember the message the person last acted on (clicked, opened its menu,
 * double-clicked, swiped), so a `/zap` typed while replying can pay its author.
 * WhatsApp starts a reply from such an action on the message.
 */
import { messageRowOf } from './dom.ts';

export function installReplyTracker(doc: Document = document): { lastRow: () => HTMLElement | null; uninstall: () => void } {
  let last: HTMLElement | null = null;
  const remember = (event: Event) => {
    const row = messageRowOf(event.target);
    if (row) last = row;
  };
  const events = ['pointerdown', 'contextmenu', 'dblclick', 'touchstart'];
  for (const type of events) doc.addEventListener(type, remember, true);
  return {
    lastRow: () => last,
    uninstall: () => { for (const type of events) doc.removeEventListener(type, remember, true); },
  };
}
