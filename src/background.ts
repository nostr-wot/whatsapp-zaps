/**
 * Background worker: LNURL fetches and Nostr profile searches for the
 * content script and the options page.
 *
 * Fetching here rather than in the page keeps the requests out of WhatsApp's
 * origin and CSP. Like Nostr WoT, this relies on LNURL servers sending CORS
 * headers — the extension holds no host permission for them.
 */
import { fetchPayParams, requestInvoice } from './services/lnurl.ts';
import { cachedSearch, fetchFollows, poolQuery, searchProfiles } from './services/nostrSearch.ts';
import { cachedAvatars } from './services/avatar.ts';
import { FOLLOWS_CACHE_KEY, FOLLOWS_CACHE_MS, MY_PUBKEY_KEY, SEARCH_CACHE_MS } from './constants.ts';

const fetchFn = globalThis.fetch.bind(globalThis);
const avatar = cachedAvatars(fetchFn);

/** Who the person follows, if they gave their npub; cached in storage for an hour. */
async function follows(): Promise<Set<string>> {
  const stored = await chrome.storage.local.get([MY_PUBKEY_KEY, FOLLOWS_CACHE_KEY]);
  const me = stored[MY_PUBKEY_KEY];
  if (typeof me !== 'string' || !/^[0-9a-f]{64}$/.test(me)) return new Set();
  const cache = stored[FOLLOWS_CACHE_KEY] as { pubkey?: string; at?: number; follows?: string[] } | undefined;
  if (cache?.pubkey === me && typeof cache.at === 'number' && Date.now() - cache.at < FOLLOWS_CACHE_MS && Array.isArray(cache.follows)) {
    return new Set(cache.follows);
  }
  const list = await fetchFollows(me, poolQuery());
  await chrome.storage.local.set({ [FOLLOWS_CACHE_KEY]: { pubkey: me, at: Date.now(), follows: list } });
  return new Set(list);
}

const search = cachedSearch(input => searchProfiles(input, { query: poolQuery(), fetchFn, follows }), SEARCH_CACHE_MS);

// A new npub (or none) changes the ranking: drop cached searches.
let searchFor = search;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && MY_PUBKEY_KEY in changes) {
    searchFor = cachedSearch(input => searchProfiles(input, { query: poolQuery(), fetchFn, follows }), SEARCH_CACHE_MS);
  }
});
import {
  isTrustedSender,
  parseBackgroundRequest,
  toRecipientInfo,
  type BackgroundRequest,
  type BackgroundResponse,
} from './domain/messages.ts';
import type { ResolvedInvoice } from './domain/lnurl.ts';

async function handle(request: BackgroundRequest): Promise<unknown> {
  if (request.type === 'search') return searchFor(request.query);
  if (request.type === 'avatar') return avatar(request.url);
  // Each call re-resolves the address: the callback URL never round-trips
  // through the content script, so it cannot be swapped on the way back.
  const params = await fetchPayParams(request.address);
  if (request.type === 'resolve') return toRecipientInfo(params);
  const invoice: ResolvedInvoice = await requestInvoice(params, request.amountSats, request.comment || undefined);
  return invoice;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
  if (!isTrustedSender(sender, chrome.runtime.id, extensionOrigin)) return false;
  const request = parseBackgroundRequest(message);
  if (!request) {
    sendResponse({ ok: false, error: 'Invalid request' } satisfies BackgroundResponse<never>);
    return false;
  }
  handle(request).then(
    value => sendResponse({ ok: true, value }),
    (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});
