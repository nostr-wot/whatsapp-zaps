/**
 * Stop `/zap` commands from being sent as chat messages.
 *
 * Listeners run in the capture phase on the document, so they fire before
 * WhatsApp's own handlers on the composer and the send button. Anything that
 * is not a `/zap` command passes through untouched.
 */
import { isZapCommand, type Mention } from '../domain/command.ts';
import { findComposer, isSendButton, readComposerText, readMentions } from './dom.ts';

export interface InterceptedCommand {
  text: string;
  mentions: Mention[];
  composer: HTMLElement;
}

/**
 * Install the interceptor. `onCommand` is called once per intercepted send.
 * `isBusy` lets the caller swallow sends while a zap dialog is already open.
 * Returns an uninstall function.
 */
export function installInterceptor(
  onCommand: (command: InterceptedCommand) => void,
  isBusy: () => boolean = () => false,
  doc: Document = document,
  /** False makes this interceptor let the event through untouched (another copy handles it). */
  shouldHandle: () => boolean = () => true,
): () => void {
  function intercept(event: Event): boolean {
    if (!shouldHandle()) return false;
    const composer = findComposer(doc);
    if (!composer) return false;
    const text = readComposerText(composer);
    if (!isZapCommand(text)) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!isBusy()) onCommand({ text, mentions: readMentions(composer), composer });
    return true;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    const composer = findComposer(doc);
    if (!composer || !(event.target instanceof Node) || !composer.contains(event.target)) return;
    intercept(event);
  }

  function onPointer(event: Event) {
    if (!isSendButton(event.target, doc) || !shouldHandle()) return;
    // Only the click starts a zap; mousedown/pointerdown are swallowed so
    // WhatsApp cannot send on press.
    if (event.type === 'click') intercept(event);
    else {
      const composer = findComposer(doc);
      if (composer && isZapCommand(readComposerText(composer))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
  }

  doc.addEventListener('keydown', onKeyDown, true);
  for (const type of ['pointerdown', 'mousedown', 'click']) doc.addEventListener(type, onPointer, true);
  return () => {
    doc.removeEventListener('keydown', onKeyDown, true);
    for (const type of ['pointerdown', 'mousedown', 'click']) doc.removeEventListener(type, onPointer, true);
  };
}
