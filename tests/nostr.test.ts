import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as nip19 from 'nostr-tools/nip19';
import {
  latestProfiles, parseNip05, parseSearchQuery, profileFromEvent, pubkeyFromNostrJson, rankProfiles, shortNpub, type ProfileResult,
} from '../src/domain/nostr.ts';
import { person, profileEvent } from './helpers/nostr.ts';

const alice = person();

describe('parseSearchQuery', () => {
  it('decodes npub, nprofile (with wss hints only), nostr: URIs and hex', () => {
    const npub = nip19.npubEncode(alice.pubkey);
    assert.deepEqual(parseSearchQuery(npub), { kind: 'pubkey', pubkey: alice.pubkey, relays: [] });
    assert.deepEqual(parseSearchQuery(`nostr:${npub}`), { kind: 'pubkey', pubkey: alice.pubkey, relays: [] });
    assert.deepEqual(parseSearchQuery(` ${alice.pubkey.toUpperCase()} `), { kind: 'pubkey', pubkey: alice.pubkey, relays: [] });
    const nprofile = nip19.nprofileEncode({ pubkey: alice.pubkey, relays: ['wss://r.example', 'ws://insecure.example'] });
    assert.deepEqual(parseSearchQuery(nprofile), { kind: 'pubkey', pubkey: alice.pubkey, relays: ['wss://r.example'] });
  });

  it('treats name@domain as NIP-05 and other text as a name search', () => {
    assert.deepEqual(parseSearchQuery('Alice@Example.com'), { kind: 'nip05', name: 'alice', domain: 'example.com', text: 'Alice@Example.com' });
    assert.deepEqual(parseSearchQuery('@Alice Smith'), { kind: 'text', text: 'Alice Smith' });
    assert.deepEqual(parseSearchQuery('alice.smith'), { kind: 'text', text: 'alice.smith' });
  });

  it('rejects empty, overlong and broken npub input', () => {
    for (const q of ['', '   ', 'x'.repeat(101), 'npub1notvalid']) assert.equal(parseSearchQuery(q), null, q);
  });
});

describe('parseNip05 / pubkeyFromNostrJson', () => {
  it('requires name@domain', () => {
    assert.deepEqual(parseNip05('_@example.com'), { name: '_', domain: 'example.com' });
    for (const bad of ['example.com', '@example.com', 'a@b', 'a@@b.com', 'a b@c.com']) assert.equal(parseNip05(bad), null, bad);
  });
  it('reads only well-formed pubkeys', () => {
    assert.equal(pubkeyFromNostrJson({ names: { bob: alice.pubkey } }, 'bob'), alice.pubkey);
    assert.equal(pubkeyFromNostrJson({ names: { bob: 'npub1xyz' } }, 'bob'), null);
    assert.equal(pubkeyFromNostrJson({ names: { bob: alice.pubkey } }, 'carol'), null);
    assert.equal(pubkeyFromNostrJson({}, 'bob'), null);
  });
});

describe('profileFromEvent', () => {
  it('reads names, a normalized lud16 and the nip05', () => {
    const p = profileFromEvent(profileEvent(alice, { name: 'alice', display_name: 'Alice A', lud16: 'Alice@Wallet.example', nip05: 'Alice@Example.com' }))!;
    assert.equal(p.pubkey, alice.pubkey);
    assert.equal(p.npub, nip19.npubEncode(alice.pubkey));
    assert.equal(p.displayName, 'Alice A');
    assert.equal(p.name, 'alice');
    assert.equal(p.lud16, 'alice@wallet.example');
    assert.equal(p.nip05, 'alice@example.com');
    assert.equal(p.nip05Verified, false);
  });

  it('falls back to name, and drops a duplicate handle', () => {
    const p = profileFromEvent(profileEvent(alice, { name: 'alice' }))!;
    assert.equal(p.displayName, 'alice');
    assert.equal(p.name, null);
    assert.equal(p.lud16, null);
  });

  it('refuses tampered events: a relay cannot swap in its own lud16', () => {
    const event = profileEvent(alice, { name: 'alice', lud16: 'alice@wallet.example' });
    const forged = { ...event, content: JSON.stringify({ name: 'alice', lud16: 'thief@evil.example' }) };
    assert.equal(profileFromEvent(forged), null);
  });

  it('ignores invalid lud16, non-JSON content and other kinds', () => {
    assert.equal(profileFromEvent(profileEvent(alice, { name: 'a', lud16: 'not an address' }))!.lud16, null);
    assert.equal(profileFromEvent(profileEvent(alice, 'not json')), null);
    assert.equal(profileFromEvent(profileEvent(alice, '[1,2]')), null);
    assert.equal(profileFromEvent({ ...profileEvent(alice, {}), kind: 1 }), null);
  });

  it('strips control and invisible characters from names', () => {
    const p = profileFromEvent(profileEvent(alice, { name: 'al‮ice​\n' }))!;
    assert.equal(p.displayName, 'al‮ice');
    assert.equal(profileFromEvent(profileEvent(alice, { name: '​⁦' }))!.displayName, null);
  });
});

describe('latestProfiles', () => {
  it('keeps the newest valid profile per key', () => {
    const bob = person();
    const events = [
      profileEvent(alice, { name: 'old' }, 1), profileEvent(alice, { name: 'new' }, 3), profileEvent(alice, { name: 'mid' }, 2),
      profileEvent(bob, { name: 'bob' }, 1),
    ];
    const names = latestProfiles(events).map(p => p.displayName).sort();
    assert.deepEqual(names, ['bob', 'new']);
  });
});

describe('rankProfiles', () => {
  const base = (over: Partial<ProfileResult>): ProfileResult => ({
    pubkey: 'x', npub: 'npub1x', displayName: null, name: null, nip05: null, nip05Verified: false, lud16: null, picture: null, followed: false, createdAt: 0, ...over,
  });

  it('puts verified, payable, well-matching profiles first', () => {
    const ranked = rankProfiles([
      base({ pubkey: 'unpayable', displayName: 'Alice' }),
      base({ pubkey: 'imposter', displayName: 'Alice', lud16: 'a@x.example', nip05: 'alice@x.example' }),
      base({ pubkey: 'verified', displayName: 'Alice W', lud16: 'a@y.example', nip05: 'alice@y.example', nip05Verified: true }),
      base({ pubkey: 'other', displayName: 'Bob', lud16: 'b@x.example' }),
    ], 'alice');
    assert.deepEqual(ranked.map(p => p.pubkey), ['verified', 'imposter', 'other', 'unpayable']);
  });

  it('puts the exact verified NIP-05 match on top', () => {
    const ranked = rankProfiles([
      base({ pubkey: 'a', nip05: 'x@y.example', nip05Verified: true, lud16: 'a@b.example' }),
      base({ pubkey: 'b', nip05: 'bob@y.example', nip05Verified: true }),
    ], 'bob@y.example');
    assert.equal(ranked[0].pubkey, 'b');
  });
});

describe('shortNpub', () => {
  it('abbreviates the middle', () => {
    assert.equal(shortNpub('npub1abcdefghijklmnopqrstuvwxyz'), 'npub1abcde…uvwxyz');
  });
});

describe('parseSearchQuery — length limits', () => {
  it('accepts a long nprofile but not a long name', () => {
    const relays = ['wss://relay-one.example.com', 'wss://relay-two.example.com', 'wss://relay-three.example.com'];
    const nprofile = nip19.nprofileEncode({ pubkey: alice.pubkey, relays });
    assert.ok(nprofile.length > 100);
    assert.equal(parseSearchQuery(nprofile)?.kind, 'pubkey');
    assert.equal(parseSearchQuery('a'.repeat(101)), null);
  });
});
