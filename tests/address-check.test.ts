import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { profileForTyped, recipientSummary, shouldCheckAsAddress } from '../src/domain/addressCheck.ts';
import type { ProfileResult } from '../src/domain/nostr.ts';

const profile = (over: Partial<ProfileResult>): ProfileResult => ({
  pubkey: 'a'.repeat(64), npub: 'npub1x', displayName: 'Ana', name: 'ana', nip05: null, nip05Verified: false,
  lud16: null, picture: null, followed: false, createdAt: 1, ...over,
});

describe('a typed name@domain', () => {
  it('stands for the profile whose Lightning Address or verified NIP-05 it is', () => {
    const payable = profile({ lud16: 'ana@wallet.example', nip05: 'ana@nostr.example', nip05Verified: true });
    assert.equal(profileForTyped(' Ana@Wallet.example ', [payable]), payable);
    assert.equal(profileForTyped('ana@nostr.example', [payable]), payable);
    assert.equal(profileForTyped('ana@nostr.example', [{ ...payable, nip05Verified: false }]), null, 'an unverified NIP-05 says nothing');
    assert.equal(profileForTyped('ana@nostr.example', [{ ...payable, lud16: null }]), null, 'a profile without a Lightning Address cannot be paid');
  });

  it('is checked as a Lightning Address when it looks like one and no profile stands for it', () => {
    assert.equal(shouldCheckAsAddress('tips@wallet.example', []), true);
    assert.equal(shouldCheckAsAddress('tips@wallet.example', [profile({ nip05: 'tips@wallet.example', nip05Verified: true })]), true,
      'a profile without a Lightning Address does not explain it');
    assert.equal(shouldCheckAsAddress('ana@wallet.example', [profile({ lud16: 'ana@wallet.example' })]), false);
    assert.equal(shouldCheckAsAddress('Ana Paula', []), false);
    assert.equal(shouldCheckAsAddress('ana@wallet', []), false, 'not a whole address yet');
  });

  it('is summed up from what its wallet says', () => {
    const info = { address: 'tips@wallet.example', domain: 'wallet.example', minSats: 1, maxSats: 1_000_000, commentAllowed: 0, description: 'Tips  jar\nfor Ana' };
    assert.equal(recipientSummary(info), 'Tips jar for Ana · 1–1,000,000 sats');
    assert.equal(recipientSummary({ ...info, description: null }), '1–1,000,000 sats');
    assert.equal(recipientSummary({ ...info, minSats: 21, maxSats: 21 }), 'Tips jar for Ana · 21 sats only');
    assert.match(recipientSummary({ ...info, description: 'x'.repeat(200) }), /^x{79}… · /);
  });
});
