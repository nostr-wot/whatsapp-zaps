/**
 * `/zap` command parsing.
 *
 * Accepted forms:
 *   /zap @Alice 1000
 *   /zap @Alice Smith 21k thanks for lunch
 *   /zap 1,000 @Alice
 *   /zap 1000 thanks          (no mention: the other person in a one-to-one chat)
 *
 * The recipient comes from a WhatsApp mention when the user picked one from
 * the mention list (it carries the contact id), and from plain `@name` text
 * otherwise. Names may contain spaces, so a typed name runs until the amount.
 */
import { MAX_COMMENT_LENGTH, MAX_ZAP_SATS } from '../constants.ts';

/** A mention as read from the composer. `label` excludes the leading `@`. */
export interface Mention {
  label: string;
  /** WhatsApp contact id (e.g. `5491100000000@c.us`) when the DOM exposes it. */
  id: string | null;
}

export interface ZapCommand {
  /** Null when no one was mentioned: in a one-to-one chat that means the other person. */
  recipient: Mention | null;
  amountSats: number;
  comment: string;
}

export type ParseResult =
  | { ok: true; command: ZapCommand }
  | { ok: false; error: string };

/** Where the command was typed; it decides what the help text asks for. */
export type ChatKind = 'private' | 'group' | 'unknown';

const USAGE: Record<ChatKind, string> = {
  private: 'Usage: /zap amount [comment] — for example /zap 1000 thanks',
  group: 'Usage: /zap @name amount [comment]',
  unknown: 'Usage: /zap amount [comment] in a private chat, or /zap @name amount in a group',
};

// WhatsApp wraps mentions in bidi isolates and sprinkles zero-width marks.
const INVISIBLES = /[\u200b-\u200f\u2066-\u2069\ufeff]/g;

/** Strip invisible marks and collapse whitespace. */
export function normalizeText(text: string): string {
  return text.replace(INVISIBLES, '').replace(/[\s\u00a0]+/g, ' ').trim();
}

/** True when the composer text is a `/zap` command (and must not be sent). */
export function isZapCommand(text: string): boolean {
  return /^\/zap(\s|$)/i.test(normalizeText(text));
}

/**
 * Parse an amount like `1000`, `21,000`, `21k`, `1.5k` or `2m`.
 * Returns null when the token is not an amount.
 */
export function parseAmount(token: string): number | null {
  const match = /^(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)([km])?$/i.exec(token);
  if (!match) return null;
  const multiplier = match[2] ? (match[2].toLowerCase() === 'k' ? 1_000 : 1_000_000) : 1;
  // Work in integers so `1.1k` is 1100, not 1100.0000000000002. A result
  // with a fraction left over (`1.5`) is returned as is for checkAmount to refuse.
  const [whole, fraction = ''] = match[1].replace(/,/g, '').split('.');
  const scale = 10 ** fraction.length;
  return ((Number(whole) * scale + Number(fraction || 0)) * multiplier) / scale;
}

function checkAmount(amount: number): string | null {
  if (!Number.isSafeInteger(amount) || amount <= 0) return 'The amount must be a whole number of sats.';
  if (amount > MAX_ZAP_SATS) return `The amount is above the ${MAX_ZAP_SATS.toLocaleString('en-US')} sat limit for one zap.`;
  return null;
}

/**
 * Take the recipient off the front of `rest` (which starts with `@`).
 * A picked mention wins; the longest matching label is used so "@Ana" does not
 * shadow "@Ana Paula".
 */
function takeRecipient(rest: string, mentions: Mention[]): { recipient: Mention; rest: string } | null {
  if (!rest.startsWith('@')) return null;
  const body = rest.slice(1);
  const picked = mentions
    .map(m => ({ ...m, label: normalizeText(m.label).replace(/^@/, '') }))
    .filter(m => m.label && body.toLowerCase().startsWith(m.label.toLowerCase()))
    .filter(m => body.length === m.label.length || body[m.label.length] === ' ')
    .sort((a, b) => b.label.length - a.label.length)[0];
  if (picked) {
    return { recipient: { label: body.slice(0, picked.label.length), id: picked.id }, rest: body.slice(picked.label.length).trim() };
  }
  return null;
}

/** Parse composer text into a zap command. */
export function parseZapCommand(text: string, mentions: Mention[] = [], chat: ChatKind = 'unknown'): ParseResult {
  const usage = USAGE[chat];
  const normalized = normalizeText(text);
  if (!isZapCommand(normalized)) return { ok: false, error: usage };
  let rest = normalized.replace(/^\/zap\s*/i, '');
  if (!rest) return { ok: false, error: chat === 'group' ? usage : `Add an amount. ${usage}` };

  let amount: number | null = null;
  let recipient: Mention | null = null;

  // `/zap 1000 @Alice …`
  const leading = rest.split(' ')[0];
  const leadingAmount = parseAmount(leading);
  if (leadingAmount !== null) {
    amount = leadingAmount;
    rest = rest.slice(leading.length).trim();
  }

  if (!rest.startsWith('@')) {
    // `/zap 1000 [comment]`: no one named. The caller decides who that is.
    if (amount === null) {
      // In a private chat no name is needed; what is missing is the amount up front.
      return { ok: false, error: chat === 'group' ? `Mention who to zap. ${usage}` : `Start with the amount. ${usage}` };
    }
    const amountError = checkAmount(amount);
    if (amountError) return { ok: false, error: amountError };
    if (rest.length > MAX_COMMENT_LENGTH) return { ok: false, error: `The comment is longer than ${MAX_COMMENT_LENGTH} characters.` };
    return { ok: true, command: { recipient: null, amountSats: amount, comment: rest } };
  }

  const picked = takeRecipient(rest, mentions);
  if (picked) {
    recipient = picked.recipient;
    rest = picked.rest;
  } else {
    // Typed name: words up to the amount (or to the end when the amount came first).
    const words = rest.slice(1).split(' ');
    const amountAt = amount === null ? words.findIndex((w, i) => i > 0 && parseAmount(w) !== null) : -1;
    if (amount === null && amountAt === -1) {
      if (words.length === 1 && words[0]) return { ok: false, error: `Add an amount. ${usage}` };
      return { ok: false, error: usage };
    }
    // With the amount first, the name is the first word only: a comment cannot be told apart otherwise.
    const nameWords = amount === null ? words.slice(0, amountAt) : words.slice(0, 1);
    const label = nameWords.join(' ');
    if (!label) return { ok: false, error: `Mention who to zap. ${usage}` };
    recipient = { label, id: null };
    rest = words.slice(nameWords.length).join(' ');
  }

  if (amount === null) {
    const token = rest.split(' ')[0];
    amount = parseAmount(token);
    if (amount === null) return { ok: false, error: `Add an amount. ${usage}` };
    rest = rest.slice(token.length).trim();
  }

  const amountError = checkAmount(amount);
  if (amountError) return { ok: false, error: amountError };

  const comment = rest.trim();
  if (comment.length > MAX_COMMENT_LENGTH) {
    return { ok: false, error: `The comment is longer than ${MAX_COMMENT_LENGTH} characters.` };
  }

  return { ok: true, command: { recipient, amountSats: amount, comment } };
}

/**
 * A chat message that may carry a real WhatsApp mention: `before`, then the
 * mention of `who`, then `after`. `text` is the plain fallback, used when the
 * mention cannot be made.
 */
export interface ChatMessage {
  text: string;
  mention?: { before: string; who: Mention; after: string };
}

/** What the message will look like, for previews: the mention as `@Name`. */
export function messagePreview(message: ChatMessage): string {
  const m = message.mention;
  return m ? `${m.before}@${normalizeText(m.who.label).replace(/^@/, '')}${m.after}` : message.text;
}

/**
 * The message after a confirmed zap. In a group, naming who was paid mentions
 * them for real; in a private chat it is just "Sent you …".
 */
export function zapChatMessage(who: Mention | null, amountSats: number, comment = ''): ChatMessage {
  const text = zapMessage(who ? normalizeText(who.label).replace(/^@/, '') : null, amountSats, comment);
  if (!who) return { text };
  return {
    text,
    // A space always separates the mention from what follows: text typed right
    // against a mention can merge into it in some editors and break it.
    mention: { before: `⚡ Sent ${amountSats.toLocaleString('en-US')} sats to `, who, after: comment ? ` — ${comment}` : '' },
  };
}

/**
 * The chat message posted after a confirmed zap.
 *
 * It is plain text: a typed "@name" is not a WhatsApp mention, it just shows
 * as "@name", so no "@" is used. Paying the person a private chat is with
 * (`to: null`) reads "Sent you …" — their name there would only be the
 * sender's own nickname for them.
 */
export function zapMessage(to: string | null, amountSats: number, comment = ''): string {
  const amount = `${amountSats.toLocaleString('en-US')} sats`;
  const base = to === null ? `⚡ Sent you ${amount}` : `⚡ Sent ${amount} to ${to}`;
  return comment ? `${base} — ${comment}` : base;
}
