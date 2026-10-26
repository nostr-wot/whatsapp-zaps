/**
 * Profile pictures for the dialogs inside WhatsApp, fetched by the background
 * and handed out as small data: URLs.
 *
 * WhatsApp's Content-Security-Policy keeps the page from loading outside
 * images, so the background fetches them. Nostr profile pictures are often
 * large photos behind redirects (nostr.build, Blossom CDNs, imgur), and many
 * hosts do not allow cross-origin reads; so:
 * - redirects are followed, and the final address must still be a public
 *   https host (nothing is read back from private networks);
 * - up to 5 MB is read, then shrunk to a 128 px thumbnail;
 * - when the host refuses cross-origin reads, the picture can be loaded
 *   through wsrv.nl, a public image proxy (on by default, a Settings switch).
 * The extension's own pages show pictures directly and need none of this.
 */
import { AVATAR_CACHE_SIZE } from '../constants.ts';
import { assertPublicHttpsUrl } from '../domain/lnurl.ts';
import type { FetchFn } from './http.ts';

/** The most read from any picture before giving up. */
export const AVATAR_DOWNLOAD_MAX = 5 * 1024 * 1024;

/** Kept as-is when no thumbnail can be made (no OffscreenCanvas). */
const PASSTHROUGH_MAX = 300 * 1024;

/** Thumbnail edge, in pixels: enough for a 60 px avatar on a 2x screen. */
const THUMB = 128;

const IMAGE_TYPES = /^image\/(png|jpeg|jpg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/;

/** A public image proxy that sends CORS headers and resizes. */
export function proxyUrl(url: string): string {
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${THUMB}&h=${THUMB}&fit=cover&output=webp`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Read a body, stopping once it is over `max` bytes. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.byteLength > max ? null : bytes;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** Shrink to a square thumbnail; null where the runtime cannot (tests, very old browsers). */
async function thumbnail(bytes: Uint8Array, type: string): Promise<string | null> {
  const g = globalThis as { createImageBitmap?: typeof createImageBitmap; OffscreenCanvas?: typeof OffscreenCanvas };
  if (!g.createImageBitmap || !g.OffscreenCanvas) return null;
  try {
    const bitmap = await g.createImageBitmap(new Blob([bytes as BlobPart], { type }));
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = new g.OffscreenCanvas(THUMB, THUMB);
    const ctx = canvas.getContext('2d');
    if (!ctx || !side) return null;
    // Cover: the centred square, scaled down.
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, THUMB, THUMB);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
    return `data:${blob.type};base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`;
  } catch {
    return null;
  }
}

/** Fetch one picture as a small data: URL; null when it cannot be had. */
async function fetchDirect(url: string, fetchFn: FetchFn): Promise<string | null> {
  assertPublicHttpsUrl(url);
  const res = await fetchFn(url, { redirect: 'follow', signal: AbortSignal.timeout(10_000), credentials: 'omit' } as RequestInit);
  // A redirect may not lead anywhere private.
  if (res.url) assertPublicHttpsUrl(res.url);
  if (!res.ok) return null;
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  // SVG is refused: it is a document, not just pixels. Untyped bodies are tried as images.
  if (type === 'image/svg+xml' || (type && !IMAGE_TYPES.test(type) && type !== 'application/octet-stream')) return null;
  const bytes = await readCapped(res, AVATAR_DOWNLOAD_MAX);
  if (!bytes || bytes.byteLength === 0) return null;
  const thumb = await thumbnail(bytes, type || 'image/*');
  if (thumb) return thumb;
  if (!IMAGE_TYPES.test(type) || bytes.byteLength > PASSTHROUGH_MAX) return null;
  return `data:${type};base64,${toBase64(bytes)}`;
}

/**
 * Fetch one picture as a data: URL: directly, then (when `useProxy` allows)
 * through the image proxy if the host refused.
 */
export async function fetchAvatar(url: string, fetchFn: FetchFn, useProxy: () => boolean | Promise<boolean> = () => false): Promise<string | null> {
  try {
    assertPublicHttpsUrl(url);
  } catch {
    return null;
  }
  try {
    const direct = await fetchDirect(url, fetchFn);
    if (direct) return direct;
  } catch {
    // Refused cross-origin read, network trouble, a private redirect: maybe the proxy.
  }
  if (!(await useProxy())) return null;
  try {
    return await fetchDirect(proxyUrl(url), fetchFn);
  } catch {
    return null;
  }
}

/** fetchAvatar with a small in-memory cache, misses included. */
export function cachedAvatars(fetchFn: FetchFn, useProxy: () => boolean | Promise<boolean> = () => false): (url: string) => Promise<string | null> {
  const cache = new Map<string, Promise<string | null>>();
  return url => {
    const hit = cache.get(url);
    if (hit) return hit;
    const result = fetchAvatar(url, fetchFn, useProxy);
    cache.set(url, result);
    if (cache.size > AVATAR_CACHE_SIZE) cache.delete(cache.keys().next().value!);
    return result;
  };
}
