/**
 * Messages between the content script and the background worker.
 *
 * The background only fetches LNURL data, searches Nostr profiles and fetches
 * their pictures; it never pays. Paying happens in the
 * page through Nostr WoT's WebLN, which applies its own consent and limits.
 */
import { MAX_COMMENT_LENGTH, MAX_ZAP_SATS } from '../constants.ts';
import { parseLightningAddress, type LnurlPayParams } from './lnurl.ts';
import { MAX_BECH32_QUERY_LENGTH, safePictureUrl } from './nostr.ts';

export type BackgroundRequest =
  | { type: 'resolve'; address: string }
  | { type: 'invoice'; address: string; amountSats: number; comment: string }
  | { type: 'search'; query: string }
  | { type: 'avatar'; url: string }
  | { type: 'profile'; pubkey: string };

/** What the confirm dialog needs about a recipient. The callback URL stays in the background. */
export interface RecipientInfo {
  address: string;
  domain: string;
  minSats: number;
  maxSats: number;
  commentAllowed: number;
  description: string | null;
}

export type BackgroundResponse<T> = { ok: true; value: T } | { ok: false; error: string };

export function toRecipientInfo(params: LnurlPayParams): RecipientInfo {
  return {
    address: params.address,
    domain: params.domain,
    minSats: Math.ceil(params.minSendable / 1000),
    maxSats: Math.floor(params.maxSendable / 1000),
    commentAllowed: params.commentAllowed,
    description: params.description,
  };
}

/** Validate an incoming message; null when it is not one of ours. */
export function parseBackgroundRequest(message: unknown): BackgroundRequest | null {
  if (typeof message !== 'object' || message === null) return null;
  const m = message as Record<string, unknown>;
  if (m.type === 'profile') {
    return typeof m.pubkey === 'string' && /^[0-9a-f]{64}$/.test(m.pubkey) ? { type: 'profile', pubkey: m.pubkey } : null;
  }
  if (m.type === 'avatar') {
    return typeof m.url === 'string' && safePictureUrl(m.url) === m.url ? { type: 'avatar', url: m.url } : null;
  }
  if (m.type === 'search') {
    return typeof m.query === 'string' && m.query.trim() && m.query.length <= MAX_BECH32_QUERY_LENGTH ? { type: 'search', query: m.query } : null;
  }
  if (typeof m.address !== 'string' || !parseLightningAddress(m.address)) return null;
  if (m.type === 'resolve') return { type: 'resolve', address: m.address };
  if (m.type === 'invoice') {
    const amount = m.amountSats;
    const comment = typeof m.comment === 'string' ? m.comment : '';
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_ZAP_SATS) return null;
    if (comment.length > MAX_COMMENT_LENGTH) return null;
    return { type: 'invoice', address: m.address, amountSats: amount, comment };
  }
  return null;
}

/** Only our own content script on WhatsApp Web and our own pages may ask. */
export function isTrustedSender(sender: { id?: string; url?: string }, extensionId: string, extensionOrigin: string): boolean {
  if (sender.id !== extensionId || typeof sender.url !== 'string') return false;
  let origin: string;
  try {
    // Built by hand: URL.origin is "null" for chrome-extension: URLs in some runtimes.
    const url = new URL(sender.url);
    origin = `${url.protocol}//${url.host}`;
  } catch {
    return false;
  }
  return origin === 'https://web.whatsapp.com' || origin === extensionOrigin;
}
