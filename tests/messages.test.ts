import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedSender, parseBackgroundRequest, toRecipientInfo } from '../src/domain/messages.ts';

const EXT = 'abcdefghijklmnop';
const EXT_ORIGIN = `chrome-extension://${EXT}`;

describe('parseBackgroundRequest', () => {
  it('accepts resolve and invoice requests', () => {
    assert.deepEqual(parseBackgroundRequest({ type: 'resolve', address: 'a@b.example' }), { type: 'resolve', address: 'a@b.example' });
    assert.deepEqual(parseBackgroundRequest({ type: 'invoice', address: 'a@b.example', amountSats: 21, comment: 'hi' }),
      { type: 'invoice', address: 'a@b.example', amountSats: 21, comment: 'hi' });
  });
  it('rejects bad addresses, amounts, comments and types', () => {
    for (const bad of [
      null, 'x', { type: 'resolve', address: 'nope' }, { type: 'pay', address: 'a@b.example' },
      { type: 'invoice', address: 'a@b.example', amountSats: 0 }, { type: 'invoice', address: 'a@b.example', amountSats: 1.5 },
      { type: 'invoice', address: 'a@b.example', amountSats: 1e9 }, { type: 'invoice', address: 'a@b.example', amountSats: '5' },
      { type: 'invoice', address: 'a@b.example', amountSats: 5, comment: 'x'.repeat(281) },
    ]) assert.equal(parseBackgroundRequest(bad), null, JSON.stringify(bad));
  });
});

describe('isTrustedSender', () => {
  it('accepts our content script on WhatsApp Web and our own pages', () => {
    assert.equal(isTrustedSender({ id: EXT, url: 'https://web.whatsapp.com/' }, EXT, EXT_ORIGIN), true);
    assert.equal(isTrustedSender({ id: EXT, url: `${EXT_ORIGIN}/options.html` }, EXT, EXT_ORIGIN), true);
  });
  it('rejects other extensions, other sites and missing URLs', () => {
    assert.equal(isTrustedSender({ id: 'other', url: 'https://web.whatsapp.com/' }, EXT, EXT_ORIGIN), false);
    assert.equal(isTrustedSender({ id: EXT, url: 'https://web.whatsapp.com.evil.example/' }, EXT, EXT_ORIGIN), false);
    assert.equal(isTrustedSender({ id: EXT, url: 'http://web.whatsapp.com/' }, EXT, EXT_ORIGIN), false);
    assert.equal(isTrustedSender({ id: EXT }, EXT, EXT_ORIGIN), false);
  });
});

describe('toRecipientInfo', () => {
  it('converts msats to whole sats inward and drops the callback', () => {
    const info = toRecipientInfo({
      address: 'a@b.example', domain: 'b.example', callback: 'https://b.example/cb', minSendable: 1500, maxSendable: 2_000_999,
      metadata: '[]', description: 'hi', commentAllowed: 10, allowsNostr: false, nostrPubkey: null,
    });
    assert.deepEqual(info, { address: 'a@b.example', domain: 'b.example', minSats: 2, maxSats: 2000, commentAllowed: 10, description: 'hi' });
    assert.equal('callback' in info, false);
  });
});
