/**
 * WhatsApp Web DOM adapter — the only module that knows WhatsApp's markup.
 *
 * WhatsApp ships DOM changes without notice. Every selector lives in
 * SELECTORS, most specific first, preferring attributes that do not depend on
 * the UI language (data-icon, data-tab, contenteditable) over aria-labels.
 * When zapping breaks after a WhatsApp update, start here.
 */
import { normalizeText, type Mention } from '../domain/command.ts';
import { normalizeName } from '../domain/mappings.ts';

export const SELECTORS = {
  /** Message composer (Lexical contenteditable) in the open chat. */
  composer: [
    '#main footer div[contenteditable="true"][role="textbox"]',
    '#main footer div[contenteditable="true"][data-tab]',
    'footer div[contenteditable="true"]',
  ],
  /** Send button; it only exists while the composer has text. */
  sendButton: [
    'footer button[data-tab][aria-label] span[data-icon="send"]',
    'footer span[data-icon="wds-ic-send-filled"]',
    'footer span[data-icon="send"]',
    'footer button[aria-label="Send"]',
  ],
  /** Mention chips inside the composer. */
  mention: [
    '[data-app-text-template*="@{{"]',
    '[data-jid]',
    '[data-mention]',
    '.mention',
  ],
  /** Entries of WhatsApp's mention list, shown after typing `@` in a group. */
  mentionOption: [
    '#main [role="listbox"] [role="option"]',
    '[role="listbox"] [role="option"]',
    '#main [data-testid*="mention"] [role="button"]',
    '#main [role="list"] [role="listitem"]',
  ],
  /** Chat title in the conversation header. */
  chatTitle: [
    '#main header [data-testid="conversation-info-header-chat-title"]',
    '#main header span[dir="auto"][title]',
    '#main header span[dir="auto"]',
  ],
  /** Message rows; their data-id embeds the chat id (and, in groups, the author's id). */
  messageRow: ['#main [data-id]'],
  /** A message's copyable text; `data-pre-plain-text` is "[time, date] Author: ". */
  messageMeta: ['[data-pre-plain-text]'],
  /** The box above the message field while replying ("quoted message"). */
  replyPreview: [
    'footer [data-testid="quoted-message"]',
    'footer [aria-label*="uoted"]',
    'footer [data-icon="x-alt"]',
    'footer [data-icon="x"]',
  ],
  /** The ⋮ menu button in the open chat's header. */
  headerMenuButton: [
    '#main header [data-icon="menu"]',
    '#main header [data-icon="more-refreshed"]',
    '#main header [data-icon="kebab-menu"]',
    '#main header [aria-label="Menu"]',
  ],
  /** Items of an open dropdown menu; the first match is cloned for our item's look. */
  dropdownItem: [
    'li[data-animate-dropdown-item]',
    '[role="application"] li[role="button"]',
    '[role="menu"] [role="menuitem"]',
  ],
} as const;

function query<T extends Element = HTMLElement>(root: ParentNode, selectors: readonly string[]): T | null {
  for (const selector of selectors) {
    const el = root.querySelector<T & Element>(selector);
    if (el) return el;
  }
  return null;
}

export function findComposer(doc: Document = document): HTMLElement | null {
  return query<HTMLElement>(doc, SELECTORS.composer);
}

/** The send button element (the clickable ancestor of the icon, when there is one). */
export function findSendButton(doc: Document = document): HTMLElement | null {
  const el = query<HTMLElement>(doc, SELECTORS.sendButton);
  return (el?.closest('button,[role="button"]') as HTMLElement | null) ?? el;
}

/** True when `target` is, or is inside, the send button. */
export function isSendButton(target: EventTarget | null, doc: Document = document): boolean {
  const button = findSendButton(doc);
  return !!button && target instanceof Node && button.contains(target);
}

/** Composer text; Lexical renders one <p> per line. */
export function readComposerText(composer: HTMLElement): string {
  const paragraphs = composer.querySelectorAll('p');
  if (paragraphs.length === 0) return composer.textContent ?? '';
  return Array.from(paragraphs, p => p.textContent ?? '').join('\n');
}

/** A WhatsApp contact id inside any attribute value, e.g. `5491100000000@c.us`. */
const CONTACT_ID = /(\d{5,20}@(?:c\.us|s\.whatsapp\.net|lid))/;

/**
 * Contact id from a mention chip, e.g. `@{{5491100000000@c.us}}` → `5491100000000@c.us`.
 * Known attributes first; otherwise any attribute on the chip or inside it that
 * holds something shaped like a contact id.
 */
export function mentionId(el: Element): string | null {
  const template = el.getAttribute('data-app-text-template') ?? '';
  const candidates = [/@\{\{([^}]+)\}\}/.exec(template)?.[1], el.getAttribute('data-jid')];
  const known = candidates.find((id): id is string => !!id && /^[\w.+-]+@[\w.]+$/.test(id));
  if (known) return known;
  for (const node of [el, ...el.querySelectorAll('*')]) {
    for (const attr of Array.from(node.attributes)) {
      const match = CONTACT_ID.exec(attr.value);
      if (match) return match[1];
    }
  }
  return null;
}

/** True for a bare editor text span: Lexical marks those `data-lexical-text` and nothing else. */
function isPlainTextSpan(el: Element): boolean {
  const attrs = Array.from(el.attributes).map(a => a.name).filter(n => n !== 'data-lexical-text' && n !== 'style');
  return el.hasAttribute('data-lexical-text') && attrs.length === 0;
}

/**
 * The mention chips in the box. Known markers first; then, not relying on
 * WhatsApp's markup at all: the editor renders each piece of a paragraph as
 * its own element, and a mention is a piece whose whole text is `@Name`.
 * Typed `@name` text is part of a larger plain text piece instead.
 */
export function mentionElements(composer: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const selector of SELECTORS.mention) {
    for (const el of composer.querySelectorAll<HTMLElement>(selector)) if (!found.includes(el)) found.push(el);
  }
  const blocks = composer.querySelectorAll<HTMLElement>('p');
  for (const block of blocks.length ? Array.from(blocks) : [composer]) {
    for (const child of Array.from(block.children) as HTMLElement[]) {
      const text = normalizeText(child.textContent ?? '');
      if (!/^@\S/.test(text) || isPlainTextSpan(child)) continue;
      if (found.some(f => f.contains(child) || child.contains(f))) continue;
      found.push(child);
    }
  }
  // Keep the outermost of nested matches.
  return found.filter(el => !found.some(other => other !== el && other.contains(el)));
}

/** Mention chips the user picked from WhatsApp's mention list. */
export function readMentions(composer: HTMLElement): Mention[] {
  return mentionElements(composer)
    .map(el => ({ label: normalizeText(el.textContent ?? '').replace(/^@/, ''), id: mentionId(el) }))
    .filter(m => m.label);
}

export function readChatTitle(doc: Document = document): string | null {
  const el = query<HTMLElement>(doc, SELECTORS.chatTitle);
  const title = el?.getAttribute('title') || el?.textContent || '';
  return normalizeText(title) || null;
}

/**
 * The open chat's id, read from a message row's data-id
 * (`{fromMe}_{chatId}_{messageId}[_{participant}]`). Null in an empty chat.
 */
export function readChatId(doc: Document = document): string | null {
  for (const row of doc.querySelectorAll(SELECTORS.messageRow.join(','))) {
    const match = /^(?:true|false)_([\w.+-]+@(?:g\.us|c\.us|s\.whatsapp\.net|lid))_/.exec(row.getAttribute('data-id') ?? '');
    if (match) return match[1];
  }
  return null;
}

/**
 * Stable key for per-chat mappings: the chat id when known, the title otherwise.
 * A title key is weaker (two groups can share a name), which is why the id is preferred.
 */
export function readChatKey(doc: Document = document): string | null {
  const id = readChatId(doc);
  if (id) return `jid:${id}`;
  const title = readChatTitle(doc);
  return title ? `title:${normalizeName(title)}` : null;
}

// ── Editing the message box ──
//
// WhatsApp's message box is a Lexical editor. Lexical keeps its own model of
// the text and only learns about a new selection from the `selectionchange`
// event, which arrives after the current task. Editing right after selecting
// therefore edits Lexical's stale selection: nothing happens, and a `/zap`
// command stays in the box, one Enter away from being run again. So: select,
// wait until Lexical has seen it, edit through the browser's input events
// (which Lexical handles), and check the result before reporting success.

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** True when the box holds exactly `text` (ignoring invisible marks and spacing). */
export function composerHolds(composer: HTMLElement, text: string): boolean {
  return normalizeText(readComposerText(composer)) === normalizeText(text);
}

/** Select everything in the box and wait for the editor to pick the selection up. */
async function selectAll(composer: HTMLElement, doc: Document): Promise<void> {
  composer.focus();
  const selection = doc.getSelection();
  if (!selection) return;
  const synced = new Promise<void>(resolve => {
    const timer = setTimeout(resolve, 150);
    doc.addEventListener('selectionchange', () => { clearTimeout(timer); setTimeout(resolve, 0); }, { once: true });
  });
  const range = doc.createRange();
  range.selectNodeContents(composer);
  selection.removeAllRanges();
  selection.addRange(range);
  await synced;
}

/** Ways to delete the selection, most native first. */
const DELETE_STRATEGIES: Array<(composer: HTMLElement, doc: Document) => void> = [
  composer => composer.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true })),
  composer => composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true, cancelable: true })),
  (_composer, doc) => { doc.execCommand('delete', false); },
];

/** Ways to type `text` over the selection, most native first. */
const INSERT_STRATEGIES: Array<(composer: HTMLElement, doc: Document, text: string) => void> = [
  (_composer, doc, text) => { doc.execCommand('insertText', false, text); },
  (composer, _doc, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    composer.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  },
];

/**
 * Replace the box's contents with `text` ('' empties it). Resolves true only
 * when the box was checked afterwards and holds exactly `text`.
 */
export async function replaceComposerText(composer: HTMLElement, text: string, doc: Document = document): Promise<boolean> {
  if (composerHolds(composer, text)) return true;
  if (!text) {
    for (const remove of DELETE_STRATEGIES) {
      await selectAll(composer, doc);
      try { remove(composer, doc); } catch { /* try the next way */ }
      await wait(30);
      if (composerHolds(composer, '')) return true;
    }
    return false;
  }
  for (const insert of INSERT_STRATEGIES) {
    await selectAll(composer, doc);
    try { insert(composer, doc, text); } catch { /* try the next way */ }
    await wait(30);
    if (composerHolds(composer, text)) return true;
  }
  return false;
}

// ── Real mentions ──

const plainName = (text: string) => normalizeText(text).replace(/^@/, '').toLowerCase();

/** The mention element for `who` in the box: by contact id when known, else by name. */
export function findMentionElement(composer: HTMLElement, who: Mention): HTMLElement | null {
  const name = plainName(who.label);
  const mentions = mentionElements(composer);
  if (who.id) {
    const byId = mentions.find(el => mentionId(el) === who.id);
    if (byId) return byId;
  }
  return mentions.find(el => plainName(el.textContent ?? '') === name) ?? null;
}

/** Spacing differs between editors around a mention; compare without it. */
const compact = (text: string) => normalizeText(text).replace(/\s+/g, '');

/** Select `range` and wait for the editor to pick the selection up. */
async function selectRange(range: Range, composer: HTMLElement, doc: Document): Promise<void> {
  composer.focus();
  const selection = doc.getSelection();
  if (!selection) return;
  const synced = new Promise<void>(resolve => {
    const timer = setTimeout(resolve, 150);
    doc.addEventListener('selectionchange', () => { clearTimeout(timer); setTimeout(resolve, 0); }, { once: true });
  });
  selection.removeAllRanges();
  selection.addRange(range);
  await synced;
}

function firstBlock(composer: HTMLElement): Node {
  return composer.querySelector('p') ?? composer;
}

function lastBlock(composer: HTMLElement): Node {
  const blocks = composer.querySelectorAll('p');
  return blocks[blocks.length - 1] ?? composer;
}

function caretAtEnd(composer: HTMLElement, doc: Document): Range {
  const range = doc.createRange();
  range.selectNodeContents(lastBlock(composer));
  range.collapse(false);
  return range;
}

/** Type `text` over the current selection, or delete it when `text` is empty. */
async function typeOverSelection(composer: HTMLElement, text: string, doc: Document): Promise<void> {
  if (text) {
    doc.execCommand('insertText', false, text);
  } else {
    composer.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }));
  }
  await wait(30);
}

/** The box holds `before` + a mention of `who` + `after`, and no other mention. */
function holdsMessage(composer: HTMLElement, who: Mention, before: string, after: string): boolean {
  const mentions = mentionElements(composer);
  const mention = findMentionElement(composer, who);
  return mentions.length === 1 && mention !== null
    && compact(readComposerText(composer)) === compact(before + (mention.textContent ?? '') + after);
}

/**
 * Turn the box into `before` + the existing mention of `who` + `after`,
 * leaving WhatsApp's own mention untouched so it stays a real mention. The
 * selections stop at the mention's edges and never include it.
 * Resolves true only when the result was checked.
 */
export async function rewriteAroundMention(
  composer: HTMLElement, who: Mention, before: string, after: string, doc: Document = document,
): Promise<boolean> {
  const mention = findMentionElement(composer, who);
  if (!mention || mentionElements(composer).length !== 1) return false;

  // After the mention first, so the positions before it do not move.
  const tail = doc.createRange();
  tail.setStartAfter(mention);
  tail.setEnd(lastBlock(composer), lastBlock(composer).childNodes.length);
  if (!tail.collapsed || after) {
    await selectRange(tail, composer, doc);
    await typeOverSelection(composer, after, doc);
  }

  const current = findMentionElement(composer, who);
  if (!current) return false;
  const head = doc.createRange();
  head.setStart(firstBlock(composer), 0);
  head.setEndBefore(current);
  await selectRange(head, composer, doc);
  await typeOverSelection(composer, before, doc);

  return holdsMessage(composer, who, before, after);
}

const OPTION_ROLES = '[role="option"],[role="button"],[role="listitem"],[role="menuitem"],button,li,[tabindex]';

/**
 * The entry for `who` in WhatsApp's open mention list, if exactly one fits.
 *
 * Known list markup first. Otherwise, not relying on WhatsApp's markup: among
 * the elements that appeared after `@name` was typed (`appeared`), the ones
 * showing a matching name are list entries.
 */
export function findMentionOption(who: Mention, doc: Document = document, appeared: Element[] = []): HTMLElement | null {
  let options: HTMLElement[] = [];
  for (const selector of SELECTORS.mentionOption) {
    options = [...doc.querySelectorAll<HTMLElement>(selector)];
    if (options.length) break;
  }
  if (!options.length) {
    // Each name in the list is a leaf element (no child elements); its entry is the
    // clickable element around it, or the leaf itself when nothing is marked clickable.
    const entries = new Set<HTMLElement>();
    for (const root of appeared) {
      if (!root.isConnected) continue;
      for (const leaf of [root, ...root.querySelectorAll<HTMLElement>('*')] as HTMLElement[]) {
        if (leaf.children.length || !plainName(leaf.textContent ?? '')) continue;
        const entry = leaf.closest(OPTION_ROLES) as HTMLElement | null;
        entries.add(entry && root.contains(entry) ? entry : leaf);
      }
    }
    options = [...entries];
  }
  if (who.id) {
    const byId = options.find(o => mentionId(o) === who.id);
    if (byId) return byId;
  }
  const name = normalizeName(who.label);
  // The texts an entry shows: its own when it is a leaf, otherwise those of its leaves.
  const texts = (o: HTMLElement) => {
    const leaves = [...o.querySelectorAll<HTMLElement>('*')].filter(el => !el.children.length);
    return [o.textContent ?? '', ...leaves.map(el => el.textContent ?? '')].map(normalizeName).filter(Boolean);
  };
  const exact = options.filter(o => texts(o).includes(name));
  if (exact.length === 1) return exact[0];
  const starts = options.filter(o => texts(o).some(t => t.startsWith(name)));
  // Never guess between people: no match or several matches means no mention.
  return exact.length === 0 && starts.length === 1 ? starts[0] : null;
}

/** Markup seen while trying to make a mention, kept for diagnostics. */
export interface MentionAttempt {
  ok: boolean;
  stage: string;
  composerHtml: string;
  listHtml: string;
}

let lastAttempt: MentionAttempt | null = null;

/** What the last attempt to make a mention saw; for the diagnostics the person can copy. */
export function lastMentionAttempt(): MentionAttempt | null {
  return lastAttempt;
}

/**
 * Write `before`, then mention `who` the way a person does — type `@` and the
 * start of the name, pick them from WhatsApp's list — then write `after`.
 * Resolves true only when the box was checked to hold a real mention of them.
 */
export async function writeWithMention(
  composer: HTMLElement, who: Mention, before: string, after: string, doc: Document = document,
): Promise<boolean> {
  const appeared: Element[] = [];
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType === 1 && !composer.contains(node) && !(node as Element).closest('[data-whatsapp-zaps]')) appeared.push(node as Element);
      }
    }
  });
  const finish = (ok: boolean, stage: string) => {
    observer.disconnect();
    lastAttempt = {
      ok, stage,
      composerHtml: composer.outerHTML.slice(0, 20_000),
      listHtml: appeared.filter(e => e.isConnected).map(e => e.outerHTML).join('\n').slice(0, 30_000),
    };
    return ok;
  };

  if (!(await replaceComposerText(composer, before.trimEnd(), doc))) return finish(false, 'write-before');
  await selectRange(caretAtEnd(composer, doc), composer, doc);
  observer.observe(doc.body, { childList: true, subtree: true });
  // Type the first word only, as people do: the list then shows everyone it
  // could be, and the full name picks the one entry (never a guess).
  doc.execCommand('insertText', false, ` @${normalizeText(who.label).replace(/^@/, '').split(' ')[0]}`);

  let option: HTMLElement | null = null;
  for (let i = 0; i < 30 && !option; i++) {
    await wait(50);
    option = findMentionOption(who, doc, appeared);
  }
  if (!option) return finish(false, 'no-unique-list-entry');
  const optionName = plainName((option.textContent ?? '').split('\n')[0] ?? '');

  // Pick it: a click as a person makes it, then the keyboard (Tab picks the highlighted entry).
  const picked = () => mentionElements(composer).find(el =>
    (who.id && mentionId(el) === who.id) || plainName(el.textContent ?? '') === optionName
    || plainName(el.textContent ?? '').startsWith(plainName(who.label)));
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    option.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: doc.defaultView }));
  }
  for (let i = 0; i < 10 && !picked(); i++) await wait(50);
  if (!picked()) {
    composer.focus();
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true, cancelable: true }));
    for (let i = 0; i < 10 && !picked(); i++) await wait(50);
  }
  const mention = picked();
  if (!mention) return finish(false, 'not-picked');
  const person: Mention = { label: normalizeText(mention.textContent ?? '').replace(/^@/, ''), id: mentionId(mention) ?? who.id };

  if (after) {
    await selectRange(caretAtEnd(composer, doc), composer, doc);
    // WhatsApp may add a space after a picked mention; do not double it.
    const text = after.startsWith(' ') && /\s$/.test(readComposerText(composer)) ? after.slice(1) : after;
    doc.execCommand('insertText', false, text);
    await wait(30);
  }
  return finish(holdsMessage(composer, person, before, after), 'checked');
}

/**
 * Send what is in the box, the way a person would: the send button, or Enter.
 * Resolves true once the box has emptied, which is how WhatsApp shows a send.
 */
export async function sendComposer(composer: HTMLElement, doc: Document = document): Promise<boolean> {
  const sent = async () => {
    for (let i = 0; i < 20; i++) {
      if (composerHolds(composer, '')) return true;
      await wait(50);
    }
    return false;
  };
  // The send button appears once the box has text; give it a moment.
  for (let i = 0; i < 10 && !findSendButton(doc); i++) await wait(50);
  const button = findSendButton(doc);
  if (button) {
    button.click();
    if (await sent()) return true;
  }
  composer.focus();
  composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
  return sent();
}

/** The header ⋮ button (its clickable ancestor), or null. */
export function findHeaderMenuButton(doc: Document = document): HTMLElement | null {
  const el = query<HTMLElement>(doc, SELECTORS.headerMenuButton);
  return (el?.closest('button,[role="button"]') as HTMLElement | null) ?? el;
}

export function isHeaderMenuButton(target: EventTarget | null, doc: Document = document): boolean {
  const button = findHeaderMenuButton(doc);
  return !!button && target instanceof Node && button.contains(target);
}

/**
 * The dropdown that is open now: the list to append to, and one entry to copy.
 * WhatsApp may wrap each item in its own element, so the entry is the item's
 * outermost wrapper that holds nothing else, and the list is what holds those.
 */
export function findOpenMenu(doc: Document = document): { list: HTMLElement; template: HTMLElement } | null {
  let entry = query<HTMLElement>(doc, SELECTORS.dropdownItem);
  if (!entry) return null;
  while (entry.parentElement && entry.parentElement !== doc.body && entry.parentElement.children.length === 1) {
    entry = entry.parentElement;
  }
  const list = entry.parentElement;
  return list && list !== doc.body ? { list, template: entry } : null;
}

/** Who the open chat is with. */
export type ChatContact =
  | { kind: 'contact'; id: string | null; name: string }
  | { kind: 'group'; chatKey: string; title: string };

/**
 * A group when the chat id says so (`…@g.us`), otherwise one contact. In an
 * empty chat there is no id to read, and the chat is taken for a contact
 * known by its title.
 */
export function readChatContact(doc: Document = document): ChatContact | null {
  const title = readChatTitle(doc);
  const id = readChatId(doc);
  if (id?.endsWith('@g.us')) return { kind: 'group', chatKey: `jid:${id}`, title: title ?? 'this group' };
  if (!title && !id) return null;
  return { kind: 'contact', id, name: title ?? id! };
}

// ── Replies ──

/** Who wrote a message, read from its row. */
export interface MessageAuthor {
  name: string | null;
  /** The author's contact id; in groups it ends the row's data-id. */
  id: string | null;
  /** The message is the person's own. */
  fromMe: boolean;
}

/** The message row an event happened in, if any. */
export function messageRowOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest('[data-id]') as HTMLElement | null;
  return row && /^(true|false)_/.test(row.getAttribute('data-id') ?? '') ? row : null;
}

/**
 * The author of a message row: `{fromMe}_{chatId}_{messageId}[_{authorId}]`
 * in data-id, and "[time, date] Author: " in data-pre-plain-text.
 */
export function readMessageAuthor(row: Element): MessageAuthor {
  const dataId = row.getAttribute('data-id') ?? '';
  const parts = dataId.split('_');
  const fromMe = parts[0] === 'true';
  const last = parts.length >= 4 ? parts[parts.length - 1] : '';
  const id = CONTACT_ID.test(last) ? CONTACT_ID.exec(last)![1] : null;
  const meta = row.matches(SELECTORS.messageMeta.join(',')) ? row : row.querySelector(SELECTORS.messageMeta.join(','));
  const pre = meta?.getAttribute('data-pre-plain-text') ?? '';
  const name = normalizeText(/^\[[^\]]*\]\s*(.+?):\s*$/.exec(pre)?.[1] ?? '') || null;
  return { name, id, fromMe };
}

/** The texts WhatsApp shows in the footer outside the message box: the reply preview, when replying. */
function footerTextsOutsideComposer(doc: Document): string[] {
  const footer = doc.querySelector('#main footer') ?? doc.querySelector('footer');
  const composer = findComposer(doc);
  if (!footer) return [];
  const texts: string[] = [];
  const walker = doc.createTreeWalker(footer, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (composer?.contains(node)) continue;
    const text = normalizeText(node.nodeValue ?? '');
    if (text) texts.push(text);
  }
  return texts;
}

/** True while the footer shows a reply preview. */
export function isReplying(doc: Document = document): boolean {
  const known = SELECTORS.replyPreview.some(selector => doc.querySelector(selector));
  return known;
}

/**
 * The author being replied to, when a reply is open and it names the author of
 * `row` (the message the person last acted on). Both must agree: a reply that
 * was closed, or one started from somewhere else, gives null.
 */
export function replyAuthor(row: Element | null, doc: Document = document): MessageAuthor | null {
  if (!row || !row.isConnected) return null;
  const author = readMessageAuthor(row);
  const texts = footerTextsOutsideComposer(doc).map(t => t.toLowerCase());
  if (texts.length === 0) return null;
  if (author.fromMe) {
    // Own messages: WhatsApp labels the preview "You"; the person's own name may not be on the row.
    return isReplying(doc) || texts.some(t => /^(you|tú|tu|vos|você)$/.test(t)) ? author : null;
  }
  if (!author.name) return null;
  // The name line of the preview is a text of its own. Matching the name inside
  // other text (the quoted message saying "Ana is great") would pay the wrong person.
  const name = author.name.toLowerCase();
  return texts.includes(name) ? author : null;
}
