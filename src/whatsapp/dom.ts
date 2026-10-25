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
  ],
  /** Chat title in the conversation header. */
  chatTitle: [
    '#main header [data-testid="conversation-info-header-chat-title"]',
    '#main header span[dir="auto"][title]',
    '#main header span[dir="auto"]',
  ],
  /** Message rows; their data-id embeds the chat id. */
  messageRow: ['#main [data-id]'],
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

/** Contact id from a mention chip, e.g. `@{{5491100000000@c.us}}` → `5491100000000@c.us`. */
export function mentionId(el: Element): string | null {
  const template = el.getAttribute('data-app-text-template') ?? '';
  const candidates = [/@\{\{([^}]+)\}\}/.exec(template)?.[1], el.getAttribute('data-jid')];
  return candidates.find((id): id is string => !!id && /^[\w.+-]+@[\w.]+$/.test(id)) ?? null;
}

/** Mention chips the user picked from WhatsApp's mention list. */
export function readMentions(composer: HTMLElement): Mention[] {
  const seen = new Set<Element>();
  const mentions: Mention[] = [];
  for (const selector of SELECTORS.mention) {
    for (const el of composer.querySelectorAll(selector)) {
      if ([...seen].some(s => s.contains(el) || el.contains(s))) continue;
      seen.add(el);
      const label = normalizeText(el.textContent ?? '').replace(/^@/, '');
      if (label) mentions.push({ label, id: mentionId(el) });
    }
  }
  return mentions;
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
