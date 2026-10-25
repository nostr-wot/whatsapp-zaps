/**
 * Colour the message box green and bold while it holds a `/zap` command, so it reads
 * as a payment and not as a message about to be sent.
 *
 * WhatsApp's editor (Lexical) owns the text nodes and rewrites them, so the
 * colour comes from a stylesheet keyed on an attribute set on the editor's
 * root, not from editing the text.
 */
import { isZapCommand } from '../domain/command.ts';
import { findComposer, readComposerText } from './dom.ts';
import { attachStyles } from '../ui/styles.ts';

export const ZAP_ATTR = 'data-whatsapp-zaps-command';

/** WhatsApp's green, as in the dialogs; the brighter shade WhatsApp uses on dark backgrounds. */
export const ZAP_COLOR = '#008069';
const ZAP_COLOR_DARK = '#06cf9c';

export const HIGHLIGHT_STYLE = `
[${ZAP_ATTR}], [${ZAP_ATTR}] * { color: ${ZAP_COLOR} !important; caret-color: ${ZAP_COLOR} !important; }
[${ZAP_ATTR}] { font-weight: 600; }
/* WhatsApp's dark theme is its own setting, a class on <body>. */
body.dark [${ZAP_ATTR}], body.dark [${ZAP_ATTR}] * { color: ${ZAP_COLOR_DARK} !important; caret-color: ${ZAP_COLOR_DARK} !important; }
`;

/** Set or clear the attribute to match the composer's current text. */
export function updateHighlight(doc: Document = document): void {
  const composer = findComposer(doc);
  if (!composer) return;
  const on = isZapCommand(readComposerText(composer));
  if (on !== composer.hasAttribute(ZAP_ATTR)) composer.toggleAttribute(ZAP_ATTR, on);
}

/** Install the stylesheet and keep the attribute in step with typing. Returns an uninstall function. */
export function installCommandHighlight(doc: Document = document): () => void {
  const detach = attachStyles(doc, HIGHLIGHT_STYLE);
  // Lexical may apply its own change after the event; read the text once it has.
  const onChange = () => { queueMicrotask(() => updateHighlight(doc)); };
  const events = ['input', 'keyup', 'paste', 'cut', 'focusin'];
  for (const type of events) doc.addEventListener(type, onChange, true);
  return () => {
    for (const type of events) doc.removeEventListener(type, onChange, true);
    detach();
  };
}
