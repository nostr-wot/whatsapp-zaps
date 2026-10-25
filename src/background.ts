/**
 * Background worker: LNURL fetches and Nostr profile searches for the
 * content script and the options page.
 *
 * Fetching here rather than in the page keeps the requests out of WhatsApp's
 * origin and CSP. Like Nostr WoT, this relies on LNURL servers sending CORS
 * headers — the extension holds no host permission for them.
 */
import { fetchPayParams, requestInvoice } from './services/lnurl.ts';
import { poolQuery, searchProfiles } from './services/nostrSearch.ts';
import {
  isTrustedSender,
  parseBackgroundRequest,
  toRecipientInfo,
  type BackgroundRequest,
  type BackgroundResponse,
} from './domain/messages.ts';
import type { ResolvedInvoice } from './domain/lnurl.ts';

async function handle(request: BackgroundRequest): Promise<unknown> {
  if (request.type === 'search') {
    return searchProfiles(request.query, { query: poolQuery(), fetchFn: globalThis.fetch.bind(globalThis) });
  }
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
