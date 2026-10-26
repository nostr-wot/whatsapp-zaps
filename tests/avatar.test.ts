import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cachedAvatars, fetchAvatar, proxyUrl } from '../src/services/avatar.ts';

const png = (bytes = 4, type = 'image/png', extra: Record<string, string> = {}, url = '') =>
  async () => {
    const res = new Response(new Uint8Array(bytes).fill(7), { status: 200, headers: { 'content-type': type, ...extra } });
    if (url) Object.defineProperty(res, 'url', { value: url });
    return res;
  };

describe('fetchAvatar', () => {
  it('returns a data: URL for a small ordinary image (no thumbnailing outside a browser)', async () => {
    assert.equal(await fetchAvatar('https://img.example/a.png', png()), 'data:image/png;base64,BwcHBw==');
  });

  it('follows redirects, but never to a private host', async () => {
    const seen: RequestInit[] = [];
    const ok = await fetchAvatar('https://nostr.build/i/a.png', async (_u, init) => { seen.push(init!); return png(4, 'image/png', {}, 'https://image.nostr.build/a.png')(); });
    assert.equal(ok, 'data:image/png;base64,BwcHBw==');
    assert.equal(seen[0].redirect, 'follow');
    assert.equal(await fetchAvatar('https://evil.example/a.png', png(4, 'image/png', {}, 'https://192.168.1.1/a.png')), null);
  });

  it('refuses SVG, non-images, errors and oversize files', async () => {
    assert.equal(await fetchAvatar('https://img.example/a.svg', png(4, 'image/svg+xml')), null);
    assert.equal(await fetchAvatar('https://img.example/a', png(4, 'text/html')), null);
    assert.equal(await fetchAvatar('https://img.example/a', png(4, 'image/png', { 'content-length': String(10 ** 8) })), null);
    assert.equal(await fetchAvatar('https://img.example/a', async () => new Response('', { status: 404, headers: { 'content-type': 'image/png' } })), null);
    assert.equal(await fetchAvatar('https://192.168.1.10/a.png', png()), null);
  });

  it('uses the image proxy only when the host refuses, and only when allowed', async () => {
    const urls: string[] = [];
    const blocked = async (url: string) => {
      urls.push(url);
      if (url.startsWith('https://wsrv.nl/')) return png(4, 'image/webp')();
      throw new TypeError('Failed to fetch'); // what a refused cross-origin read looks like
    };
    assert.equal(await fetchAvatar('https://img.example/a.png', blocked, () => false), null);
    assert.deepEqual(urls, ['https://img.example/a.png']);
    urls.length = 0;
    assert.equal(await fetchAvatar('https://img.example/a.png', blocked, () => true), 'data:image/webp;base64,BwcHBw==');
    assert.deepEqual(urls, ['https://img.example/a.png', proxyUrl('https://img.example/a.png')]);
    assert.match(proxyUrl('https://img.example/a b.png'), /^https:\/\/wsrv\.nl\/\?url=https%3A%2F%2Fimg\.example%2Fa%20b\.png&w=128&h=128&fit=cover&output=webp$/);
  });

  it('caches results, misses included', async () => {
    let calls = 0;
    const get = cachedAvatars(async () => { calls++; return png()(); });
    await get('https://img.example/a.png');
    await get('https://img.example/a.png');
    assert.equal(calls, 1);
  });
});
