/**
 * Smoke-test stand-in for WhatsApp's message box: a real Lexical editor, so
 * the extension's edits go through the same machinery as on WhatsApp (its own
 * model, selection synced asynchronously from `selectionchange`).
 * Enter or the send button "sends": the text is added to #sent and the box
 * is emptied, as WhatsApp does.
 */
import {
  $createParagraphNode, $createTextNode, $getRoot, COMMAND_PRIORITY_HIGH, KEY_ENTER_COMMAND, createEditor,
} from 'lexical';
import { registerPlainText } from '@lexical/plain-text';

const root = document.querySelector<HTMLElement>('footer [contenteditable="true"]')!;
root.replaceChildren();
const editor = createEditor({ namespace: 'composer', onError: e => { throw e; } });
editor.setRootElement(root);
registerPlainText(editor);

const initial = new URLSearchParams(location.search).get('text') ?? '';
editor.update(() => {
  const paragraph = $createParagraphNode();
  if (initial) paragraph.append($createTextNode(initial));
  $getRoot().clear().append(paragraph);
});

function send(): boolean {
  const text = editor.getEditorState().read(() => $getRoot().getTextContent()).trim();
  if (!text) return false;
  const row = document.createElement('div');
  row.className = 'sent-message';
  row.textContent = text;
  document.getElementById('sent')!.append(row);
  editor.update(() => { $getRoot().clear().append($createParagraphNode()); });
  return true;
}

editor.registerCommand(KEY_ENTER_COMMAND, event => {
  if (event?.shiftKey) return false;
  event?.preventDefault();
  return send();
}, COMMAND_PRIORITY_HIGH);

document.querySelector('footer button[aria-label="Send"]')!.addEventListener('click', () => { send(); });
(window as unknown as { __lexicalReady: boolean }).__lexicalReady = true;
