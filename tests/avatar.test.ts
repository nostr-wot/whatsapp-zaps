import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cachedAvatars, fetchAvatar } from '../src/services/avatar.ts';

const png = (bytes = 4, type = 'image/png', extra: Record<string, string> = {}) =>
  async () => new Response(new Uint8Array(bytes).fill(7), { status: 200, headers: { 'content-type': type, ...extra } });

describe('fetchAvatar', () => {
  it('returns a data: URL for a small ordinary image', async () => {
    assert.equal(await fetchAvatar('https://img.example/a.png', png()), 'data:image/png;base64,BwcHBw==');
  });
  it('refuses SVG, non-images, huge files and errors', async () => {
    assert.equal(await fetchAvatar('https://img.example/a.svg', png(4, 'image/svg+xml')), null);
    assert.equal(await fetchAvatar('https://img.example/a', png(4, 'text/html')), null);
    assert.equal(await fetchAvatar('https://img.example/a', png(400 * 1024)), null);
    assert.equal(await fetchAvatar('https://img.example/a', png(4, 'image/png', { 'content-length': String(10 ** 7) })), null);
    assert.equal(await fetchAvatar('https://img.example/a', async () => new Response('', { status: 404, headers: { 'content-type': 'image/png' } })), null);
    assert.equal(await fetchAvatar('https://img.example/a', async () => { throw new TypeError('network'); }), null);
  });
  it('never contacts private or local hosts, nor follows redirects', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const spy = async (url: string, init?: RequestInit) => { seen.push({ url, init }); return png()(); };
    assert.equal(await fetchAvatar('https://192.168.1.10/a.png', spy), null);
    assert.equal(await fetchAvatar('http://img.example/a.png', spy), null);
    assert.equal(seen.length, 0);
    await fetchAvatar('https://img.example/a.png', spy);
    assert.equal(seen[0].init?.redirect, 'error');
  });
  it('caches results, misses included', async () => {
    let calls = 0;
    const get = cachedAvatars(async () => { calls++; return png()(); });
    await get('https://img.example/a.png');
    await get('https://img.example/a.png');
    assert.equal(calls, 1);
  });
});
