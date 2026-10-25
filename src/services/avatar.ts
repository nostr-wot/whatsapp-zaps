/**
 * Profile pictures, fetched by the background and handed out as data: URLs.
 *
 * The page never loads them itself: WhatsApp's Content-Security-Policy would
 * block outside images, and fetching here applies the same rules as LNURL —
 * public https hosts only, no redirects, a timeout and a size cap.
 */
import { AVATAR_CACHE_SIZE, AVATAR_MAX_BYTES } from '../constants.ts';
import { assertPublicHttpsUrl } from '../domain/lnurl.ts';
import type { FetchFn } from './http.ts';

const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|avif)$/;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Fetch one picture as a data: URL; null when it is not a small, ordinary image. */
export async function fetchAvatar(url: string, fetchFn: FetchFn): Promise<string | null> {
  try {
    assertPublicHttpsUrl(url);
    const res = await fetchFn(url, { redirect: 'error', signal: AbortSignal.timeout(8_000), credentials: 'omit' } as RequestInit);
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    // SVG is refused: it is a document, not just pixels.
    if (!res.ok || !IMAGE_TYPES.test(type)) return null;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > AVATAR_MAX_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > AVATAR_MAX_BYTES) return null;
    return `data:${type};base64,${toBase64(bytes)}`;
  } catch {
    return null;
  }
}

/** fetchAvatar with a small in-memory cache, misses included. */
export function cachedAvatars(fetchFn: FetchFn): (url: string) => Promise<string | null> {
  const cache = new Map<string, Promise<string | null>>();
  return url => {
    const hit = cache.get(url);
    if (hit) return hit;
    const result = fetchAvatar(url, fetchFn);
    cache.set(url, result);
    if (cache.size > AVATAR_CACHE_SIZE) cache.delete(cache.keys().next().value!);
    return result;
  };
}
