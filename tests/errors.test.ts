import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { explainLookupError } from '../src/domain/errors.ts';

describe('explainLookupError', () => {
  it('explains a 404 as a wrong address and points at NIP-05 confusion', () => {
    const text = explainLookupError('ana@nostr.example', new Error('LNURL: endpoint returned 404'));
    assert.match(text, /ana@nostr\.example is not a Lightning Address: nostr\.example has no wallet by that name/);
    assert.match(text, /NIP-05/);
  });
  it('explains an unreachable server', () => {
    assert.match(explainLookupError('a@b.example', new Error('LNURL: could not reach the endpoint')), /b\.example did not answer/);
  });
  it('passes other errors through with the address', () => {
    assert.equal(explainLookupError('a@b.example', new Error('LNURL: endpoint returned 500')), 'a@b.example: LNURL: endpoint returned 500');
  });
});
