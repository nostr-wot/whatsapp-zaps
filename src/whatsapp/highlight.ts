/**
 * Colour the message box and make it bold while it holds a `/zap` command, so
 * it reads as a payment and not as a message about to be sent. The colour is
 * the chosen Nostr WoT theme's zap colour, picked to read on WhatsApp's light
 * or dark background (see markColor in ui/themes.ts).
 *
 * WhatsApp's editor (Lexical) owns the text nodes and rewrites them, so the
 * colour comes from a stylesheet keyed on an attribute set on the editor's
 * root, not from editing the text.
 */
import { isZapCommand } from '../domain/command.ts';
import { findComposer, readComposerText } from './dom.ts';
import { attachStyles } from '../ui/styles.ts';
import { THEMES } from '../ui/themes.ts';

export const ZAP_ATTR = 'data-whatsapp-zaps-command';

/** Nostr WoT Light's zap colour, until the theme is known. */
export const ZAP_COLOR = THEMES.light.zap;

export function highlightStyle(color: string): string {
  return `
[${ZAP_ATTR}], [${ZAP_ATTR}] * { color: ${color} !important; caret-color: ${color} !important; }
[${ZAP_ATTR}] { font-weight: 600; }
`;
}

/** Set or clear the attribute to match the composer's current text. */
export function updateHighlight(doc: Document = document): void {
  const composer = findComposer(doc);
  if (!composer) return;
  const on = isZapCommand(readComposerText(composer));
  if (on !== composer.hasAttribute(ZAP_ATTR)) composer.toggleAttribute(ZAP_ATTR, on);
}

/**
 * Install the stylesheet and keep the attribute in step with typing.
 * `setColor` repaints the command in another colour (a new theme).
 */
export function installCommandHighlight(doc: Document = document, color: string = ZAP_COLOR): { uninstall(): void; setColor(color: string): void } {
  let current = color;
  let detach = attachStyles(doc, highlightStyle(current));
  // Lexical may apply its own change after the event; read the text once it has.
  const onChange = () => { queueMicrotask(() => updateHighlight(doc)); };
  const events = ['input', 'keyup', 'paste', 'cut', 'focusin'];
  for (const type of events) doc.addEventListener(type, onChange, true);
  return {
    uninstall: () => {
      for (const type of events) doc.removeEventListener(type, onChange, true);
      detach();
    },
    setColor: next => {
      if (next === current) return;
      current = next;
      detach();
      detach = attachStyles(doc, highlightStyle(next));
    },
  };
}
