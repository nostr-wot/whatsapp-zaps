/**
 * LNURL-pay over the network: pay params and invoice requests.
 *
 * Ported from Nostr WoT (src/services/wallet/lnurl.ts, GPL-3.0-only) with its
 * hardening intact — HTTPS only, no private hosts, no redirects, a timeout, a
 * streamed size cap, and an exact amount check on the returned invoice.
 */
import { fetchCappedJson, type FetchFn } from './http.ts';
import { decodeBolt11Amount } from '../domain/bolt11.ts';
import {
  parseLightningAddress,
  lightningAddressToLnurlpUrl,
  assertPublicHttpsUrl,
  type LnurlPayParams,
  type ResolvedInvoice,
} from '../domain/lnurl.ts';

export type { FetchFn } from './http.ts';

const fetchJson = (url: string, fetchFn: FetchFn) => fetchCappedJson(url, fetchFn, 'LNURL');

/** Pull the `text/plain` line out of the LUD-06 metadata array. */
function descriptionFromMetadata(metadata: string): string | null {
  try {
    const entries = JSON.parse(metadata) as unknown;
    if (!Array.isArray(entries)) return null;
    for (const entry of entries) {
      if (Array.isArray(entry) && entry[0] === 'text/plain' && typeof entry[1] === 'string') {
        return entry[1].slice(0, 500);
      }
    }
  } catch {
    // Malformed metadata is not fatal — the payment still works without a description.
  }
  return null;
}

// ── Public API ──

/**
 * Resolve a Lightning Address to its LNURL-pay parameters.
 *
 * @param address - `name@domain`
 * @param fetchFn - Optional fetch override for testing
 * @throws if the address, the endpoint, or the response is invalid.
 */
export async function fetchPayParams(
  address: string,
  fetchFn: FetchFn = globalThis.fetch.bind(globalThis),
): Promise<LnurlPayParams> {
  const parsed = parseLightningAddress(address);
  if (!parsed) throw new Error('Not a valid Lightning Address');

  const url = lightningAddressToLnurlpUrl(address);
  assertPublicHttpsUrl(url);
  const body = await fetchJson(url, fetchFn);

  if (body.tag !== 'payRequest') {
    throw new Error('LNURL: endpoint is not a pay request');
  }

  const callback = typeof body.callback === 'string' ? body.callback : '';
  assertPublicHttpsUrl(callback);

  const minSendable = Number(body.minSendable);
  const maxSendable = Number(body.maxSendable);
  if (!Number.isFinite(minSendable) || !Number.isFinite(maxSendable)
    || minSendable <= 0 || maxSendable < minSendable) {
    throw new Error('LNURL: endpoint returned an invalid sendable range');
  }

  const metadata = typeof body.metadata === 'string' ? body.metadata : '';
  const commentRaw = Number(body.commentAllowed);
  const commentAllowed = Number.isFinite(commentRaw) && commentRaw > 0
    ? Math.min(Math.floor(commentRaw), 1000)
    : 0;

  return {
    address: `${parsed.name}@${parsed.domain}`,
    domain: new URL(url).hostname,
    callback,
    minSendable,
    maxSendable,
    metadata,
    description: descriptionFromMetadata(metadata),
    commentAllowed,
    allowsNostr: body.allowsNostr === true,
    nostrPubkey: typeof body.nostrPubkey === 'string' ? body.nostrPubkey : null,
  };
}

/**
 * Ask the LNURL callback for an invoice for `amountSats`.
 *
 * The returned invoice is decoded and its amount compared to the requested
 * amount before it is handed back: the user approves a number in the confirm dialog,
 * and the server must not be able to substitute a different one. An invoice
 * with no amount is refused for the same reason.
 *
 * @param params - Pay params from {@link fetchPayParams}
 * @param amountSats - Amount the user approved
 * @param comment - Optional LUD-12 comment; truncated to `commentAllowed`
 * @param fetchFn - Optional fetch override for testing
 */
export async function requestInvoice(
  params: LnurlPayParams,
  amountSats: number,
  comment?: string,
  fetchFn: FetchFn = globalThis.fetch.bind(globalThis),
): Promise<ResolvedInvoice> {
  if (!Number.isSafeInteger(amountSats * 1000) || !Number.isInteger(amountSats) || amountSats <= 0) {
    throw new Error('LNURL: amount must be a positive whole number of sats');
  }

  const amountMsats = amountSats * 1000;
  if (amountMsats < params.minSendable || amountMsats > params.maxSendable) {
    const min = Math.ceil(params.minSendable / 1000);
    const max = Math.floor(params.maxSendable / 1000);
    // A range narrower than one sat (say 500–900 msats) has no whole-sat amount
    // in it, and rounding the ends inward inverts them — the old message read
    // "must be between 1 and 0 sats". Name the real problem instead.
    if (max < min) {
      throw new Error('LNURL: this endpoint does not accept any whole-sat amount');
    }
    throw new Error(`LNURL: amount must be between ${min} and ${max} sats`);
  }

  const url = assertPublicHttpsUrl(params.callback);
  url.searchParams.set('amount', String(amountMsats));
  if (comment && params.commentAllowed > 0) {
    url.searchParams.set('comment', comment.slice(0, params.commentAllowed));
  }

  const body = await fetchJson(url.toString(), fetchFn);

  const bolt11 = typeof body.pr === 'string' ? body.pr.trim() : '';
  if (!bolt11) {
    throw new Error('LNURL: callback did not return an invoice');
  }

  const decoded = decodeBolt11Amount(bolt11);
  if (!decoded) {
    throw new Error('LNURL: callback returned an undecodable invoice');
  }
  if (decoded.amountSats === null) {
    throw new Error('LNURL: callback returned an amountless invoice');
  }
  if (decoded.amountMsats !== amountMsats) {
    throw new Error(
      `LNURL: invoice is for ${decoded.amountSats} sats, not the ${amountSats} sats requested`,
    );
  }

  return { bolt11, amountSats };
}
