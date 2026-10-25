/**
 * Bounded JSON fetches from untrusted endpoints (LNURL servers, NIP-05 hosts).
 *
 * Ported from Nostr WoT's src/services/wallet/lnurl.ts (GPL-3.0-only).
 */
import { LNURL_MAX_RESPONSE_BYTES as MAX_RESPONSE_BYTES, LNURL_REQUEST_TIMEOUT_MS as REQUEST_TIMEOUT_MS } from '../constants.ts';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Read a response body, giving up as soon as it exceeds {@link MAX_RESPONSE_BYTES}.
 *
 * The cap has to be enforced *while* reading. Buffering first and measuring
 * afterwards means a hostile endpoint has already been allowed to stream an
 * unbounded body into the service worker — the check would then only decline to
 * parse what it had finished downloading.
 */
async function readCapped(res: Response, label: string): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error(`${label}: response too large`);
  }

  // No stream to read incrementally (a test double, or a browser that gives no
  // body): fall back to buffering, still capped.
  if (!res.body) {
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new Error(`${label}: response too large`);
    return text;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        // Cancelling releases the connection instead of letting the endpoint
        // keep sending into a body nobody will read.
        await reader.cancel().catch(() => {});
        throw new Error(`${label}: response too large`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * GET a JSON object from an untrusted public endpoint.
 *
 * Callers must have checked the URL with assertPublicHttpsUrl first. Errors are
 * prefixed with `label` (e.g. "NIP-05") so the UI can say which lookup failed.
 */
export async function fetchCappedJson(
  url: string,
  fetchFn: FetchFn,
  label: string,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      // Never follow a redirect. assertPublicHttpsUrl vouches for the URL we
      // are about to request, and it cannot vouch for wherever a 302 points:
      // following one would let an endpoint that passed the check hand us an
      // internal address and walk the fetch straight back inside. This is the
      // guarantee Nostr WoT's docs/security.md §17 states ("the endpoint cannot redirect
      // the second hop inward"), and NIP-05 forbids following redirects too.
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if ((err as Error)?.name === 'TimeoutError') {
      throw new Error(`${label}: the endpoint took too long to respond`);
    }
    // Network failure, DNS failure, a refused redirect, or a server that
    // refuses cross-origin reads. They look identical from here; say so
    // instead of leaking a browser-specific message into the UI.
    throw new Error(`${label}: could not reach the endpoint`);
  }
  if (!res.ok) {
    throw new Error(`${label}: endpoint returned ${res.status}`);
  }

  const text = await readCapped(res, label);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${label}: endpoint did not return JSON`);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error(`${label}: endpoint did not return JSON`);
  }

  const obj = body as Record<string, unknown>;
  // LUD-06 error shape: { status: "ERROR", reason: "..." }
  if (typeof obj.status === 'string' && obj.status.toUpperCase() === 'ERROR') {
    const reason = typeof obj.reason === 'string' && obj.reason.trim()
      ? obj.reason.trim().slice(0, 200)
      : 'request rejected';
    throw new Error(`${label}: ${reason}`);
  }

  return obj;
}
