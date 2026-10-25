import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BRIDGE_REQUEST, BRIDGE_RESPONSE } from '../src/constants.ts';
import { classifyPaymentError, isPayRequest, isPayResponse, payWithWebln } from '../src/domain/bridge.ts';

function webln(opts: { enabled?: boolean; enable?: () => Promise<void>; send?: (pr: string) => Promise<{ preimage: string }> } = {}) {
  const calls: string[] = [];
  return {
    calls,
    provider: {
      enabled: opts.enabled ?? false,
      enable: async () => { calls.push('enable'); await opts.enable?.(); },
      sendPayment: async (pr: string) => { calls.push(`pay:${pr}`); return opts.send ? opts.send(pr) : { preimage: 'ab'.repeat(32) }; },
    },
  };
}

describe('payWithWebln', () => {
  it('enables, then pays once', async () => {
    const w = webln();
    assert.deepEqual(await payWithWebln(w.provider, 'lnbc1x'), { outcome: 'paid', preimage: 'ab'.repeat(32) });
    assert.deepEqual(w.calls, ['enable', 'pay:lnbc1x']);
  });

  it('skips enable when already enabled', async () => {
    const w = webln({ enabled: true });
    await payWithWebln(w.provider, 'lnbc1x');
    assert.deepEqual(w.calls, ['pay:lnbc1x']);
  });

  it('reports a refused enable as not paid, without paying', async () => {
    const w = webln({ enable: async () => { throw new Error('WebLN access denied'); } });
    assert.deepEqual(await payWithWebln(w.provider, 'lnbc1x'), { outcome: 'not_paid', error: 'WebLN access denied' });
    assert.deepEqual(w.calls, ['enable']);
  });

  it('reports a missing provider as not paid', async () => {
    assert.equal((await payWithWebln(undefined, 'lnbc1x')).outcome, 'not_paid');
  });

  it('never retries, and treats a timeout as unknown', async () => {
    const w = webln({ enabled: true, send: async () => { throw new Error('WEBLN_REQUEST timeout: sendPayment'); } });
    assert.equal((await payWithWebln(w.provider, 'lnbc1x')).outcome, 'unknown');
    assert.deepEqual(w.calls, ['pay:lnbc1x']);
  });

  it('treats a result without a preimage as unknown', async () => {
    const w = webln({ enabled: true, send: async () => ({}) as { preimage: string } });
    assert.equal((await payWithWebln(w.provider, 'lnbc1x')).outcome, 'unknown');
  });
});

describe('classifyPaymentError', () => {
  it('knows Nostr WoT refusals that happen before paying', () => {
    for (const m of ['Payment denied by user', 'Permission denied', 'Site not connected', 'No wallet configured', 'WebLN not enabled. Call webln.enable() first.']) {
      assert.equal(classifyPaymentError(m).outcome, 'not_paid', m);
    }
  });
  it('treats anything else as unknown', () => {
    for (const m of ['NWC: payment failed', 'Wallet disconnected or replaced', 'boom']) assert.equal(classifyPaymentError(m).outcome, 'unknown', m);
  });
});

describe('bridge message guards', () => {
  it('accepts well-formed requests only', () => {
    assert.equal(isPayRequest({ type: BRIDGE_REQUEST, id: 'a', bolt11: 'lnbc10u1xyz' }), true);
    for (const bad of [null, {}, { type: BRIDGE_REQUEST, id: '', bolt11: 'lnbc1' }, { type: BRIDGE_REQUEST, id: 'a', bolt11: 'javascript:x' },
      { type: 'OTHER', id: 'a', bolt11: 'lnbc1' }, { type: BRIDGE_REQUEST, id: 'x'.repeat(65), bolt11: 'lnbc1' }]) {
      assert.equal(isPayRequest(bad), false, JSON.stringify(bad));
    }
  });
  it('matches responses by id and shape', () => {
    assert.equal(isPayResponse({ type: BRIDGE_RESPONSE, id: 'a', outcome: 'paid', preimage: 'p' }, 'a'), true);
    assert.equal(isPayResponse({ type: BRIDGE_RESPONSE, id: 'a', outcome: 'paid', preimage: 'p' }, 'b'), false);
    assert.equal(isPayResponse({ type: BRIDGE_RESPONSE, id: 'a', outcome: 'paid' }, 'a'), false);
    assert.equal(isPayResponse({ type: BRIDGE_RESPONSE, id: 'a', outcome: 'unknown', error: 'e' }, 'a'), true);
    assert.equal(isPayResponse({ type: BRIDGE_RESPONSE, id: 'a', outcome: 'maybe', error: 'e' }, 'a'), false);
  });
});
