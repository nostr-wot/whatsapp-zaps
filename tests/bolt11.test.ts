import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bech32 } from '@scure/base';
import { decodeBolt11Amount, parseInvoiceHrp } from '../src/domain/bolt11.ts';

const invoice = (hrp: string, words = 111) => bech32.encode(hrp, Array(words).fill(0), 5000);

describe('parseInvoiceHrp', () => {
  it('converts every multiplier to msats', () => {
    assert.deepEqual(parseInvoiceHrp('lnbc2500u'), { amountSats: 250_000, amountMsats: 250_000_000, network: 'bc' });
    assert.equal(parseInvoiceHrp('lnbc1m')?.amountSats, 100_000);
    assert.equal(parseInvoiceHrp('lnbc10n')?.amountMsats, 1000);
    assert.equal(parseInvoiceHrp('lntb20p')?.amountMsats, 2);
    assert.equal(parseInvoiceHrp('lnbc1')?.amountSats, 100_000_000);
  });
  it('reports amountless invoices as null amounts', () => {
    assert.deepEqual(parseInvoiceHrp('lnbc'), { amountSats: null, amountMsats: null, network: 'bc' });
  });
  it('rejects sub-msat and malformed amounts', () => {
    for (const hrp of ['lnbc1p', 'lnbc0u', 'lnxx10u', 'lnbc10x', 'bc10u']) assert.equal(parseInvoiceHrp(hrp), null, hrp);
  });
});

describe('decodeBolt11Amount', () => {
  it('decodes a checksum-valid invoice in either case', () => {
    const inv = invoice('lnbc2500u');
    assert.equal(decodeBolt11Amount(inv)?.amountSats, 250_000);
    assert.equal(decodeBolt11Amount(inv.toUpperCase())?.amountSats, 250_000);
  });
  it('rejects bad checksums, mixed case, short data and non-invoices', () => {
    const inv = invoice('lnbc2500u');
    assert.equal(decodeBolt11Amount(inv.slice(0, -1) + (inv.endsWith('q') ? 'p' : 'q')), null);
    assert.equal(decodeBolt11Amount(inv[0].toUpperCase() + inv.slice(1)), null);
    assert.equal(decodeBolt11Amount(invoice('lnbc2500u', 110)), null);
    assert.equal(decodeBolt11Amount('alice@example.com'), null);
  });
});
