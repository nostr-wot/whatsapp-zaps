/**
 * Smoke-test stand-in for WhatsApp's message box: a real Lexical editor, so
 * the extension's edits go through the same machinery as on WhatsApp (its own
 * model, selection synced asynchronously from `selectionchange`).
 *
 * - Enter or the send button "sends": the text goes to #sent (with mentions
 *   kept as `@{{id}}` so tests can see a real mention went out) and the box empties.
 * - Mentions are atomic token nodes, as in WhatsApp. Typing `@` plus letters
 *   opens a member list (`[role="listbox"]` of `[role="option"]`); picking one
 *   replaces the typed `@name` with a mention node.
 * - `?text=` sets the initial text; `?mention=Name:id` puts a picked mention
 *   into it in place of `@Name`; `?members=Name:id,Name:id` fills the list.
 * - `?markup=opaque` drops every marker the extension knows (no
 *   data-app-text-template, no .mention, no roles): mentions carry only a
 *   random class and the id in an unrelated attribute, and the list is a
 *   portal of plain divs picked by click. This checks that the extension
 *   does not depend on guessed WhatsApp markup.
 */
import {
  $applyNodeReplacement, $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, $isTextNode,
  COMMAND_PRIORITY_HIGH, KEY_ENTER_COMMAND, TextNode, createEditor,
  type EditorConfig, type LexicalNode, type NodeKey, type SerializedTextNode, type Spread,
} from 'lexical';
import { registerPlainText } from '@lexical/plain-text';

type SerializedMention = Spread<{ jid: string }, SerializedTextNode>;

class MentionNode extends TextNode {
  __jid: string;
  static getType() { return 'mention'; }
  static clone(node: MentionNode) { return new MentionNode(node.__text, node.__jid, node.__key); }
  static importJSON(json: SerializedMention) { return $createMentionNode(json.text, json.jid); }
  constructor(text: string, jid: string, key?: NodeKey) { super(text, key); this.__jid = jid; }
  exportJSON(): SerializedMention { return { ...super.exportJSON(), jid: this.__jid, type: 'mention', version: 1 }; }
  createDOM(config: EditorConfig) {
    const el = super.createDOM(config);
    el.classList.add('mention');
    el.setAttribute('data-app-text-template', `⁨@{{${this.__jid}}}⁩`);
    el.style.color = '#027eb5';
    return el;
  }
  isTextEntity() { return true; }
  canInsertTextBefore() { return false; }
  canInsertTextAfter() { return false; }
}
function $createMentionNode(name: string, jid: string): MentionNode {
  return $applyNodeReplacement(new MentionNode(`@${name}`, jid)).setMode('token');
}
const $isMention = (node: LexicalNode | null | undefined): node is MentionNode => node instanceof MentionNode;

const params = new URLSearchParams(location.search);
const opaque = params.get('markup') === 'opaque';
const members = (params.get('members') ?? '').split(',').filter(Boolean).map(m => {
  const [name, jid] = m.split(':');
  return { name, jid };
});

const root = document.querySelector<HTMLElement>('footer [contenteditable="true"]')!;
root.replaceChildren();
const editor = createEditor({ namespace: 'composer', nodes: [MentionNode], onError: e => { throw e; } });
editor.setRootElement(root);
registerPlainText(editor);

editor.update(() => {
  const paragraph = $createParagraphNode();
  const text = params.get('text') ?? '';
  const mention = params.get('mention');
  if (mention) {
    const [name, jid] = mention.split(':');
    const [before, after] = text.split(`@${name}`);
    if (before) paragraph.append($createTextNode(before));
    paragraph.append($createMentionNode(name, jid));
    if (after) paragraph.append($createTextNode(after));
  } else if (text) {
    paragraph.append($createTextNode(text));
  }
  $getRoot().clear().append(paragraph);
});

// ── Mention list ──
const list = document.createElement('div');
if (!opaque) list.setAttribute('role', 'listbox');
list.hidden = true;
// The opaque list is a portal at the end of <body>, as many apps render popups.
if (opaque) document.body.append(list);
else document.querySelector('footer')!.prepend(list);

function pick(member: { name: string; jid: string }) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    const node = selection.anchor.getNode();
    if (!$isTextNode(node) || $isMention(node)) return;
    const offset = selection.anchor.offset;
    const text = node.getTextContent();
    const at = text.slice(0, offset).lastIndexOf('@');
    if (at < 0) return;
    const [, target] = node.splitText(at, offset);
    const mention = $createMentionNode(member.name, member.jid);
    (target ?? node).replace(mention);
    const space = $createTextNode(' ');
    mention.insertAfter(space);
    space.select(1, 1);
  });
  list.hidden = true;
}

editor.registerUpdateListener(({ editorState }) => {
  const query = editorState.read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
    const node = selection.anchor.getNode();
    if (!$isTextNode(node) || $isMention(node)) return null;
    return /(?:^|\s)@(\p{L}*)$/u.exec(node.getTextContent().slice(0, selection.anchor.offset))?.[1] ?? null;
  });
  const matches = query === null ? [] : members.filter(m => m.name.toLowerCase().startsWith(query.toLowerCase()));
  list.replaceChildren(...matches.map(m => {
    const option = document.createElement('div');
    if (opaque) {
      option.tabIndex = -1;
      const name = document.createElement('span');
      name.textContent = m.name;
      const phone = document.createElement('span');
      phone.textContent = '~ +54 9 11';
      option.append(name, phone);
      option.addEventListener('mousedown', e => e.preventDefault());
      option.addEventListener('click', () => pick(m));
    } else {
      option.setAttribute('role', 'option');
      option.textContent = m.name;
      option.addEventListener('mousedown', e => { e.preventDefault(); pick(m); });
    }
    return option;
  }));
  list.hidden = matches.length === 0;
});

// ── Sending ──
function send(): boolean {
  const text = editor.getEditorState().read(() => $getRoot().getAllTextNodes()
    .map(n => ($isMention(n) ? `${n.getTextContent()}{{${n.__jid}}}` : n.getTextContent())).join('')).trim();
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
