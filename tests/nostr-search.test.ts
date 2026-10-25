import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as nip19 from 'nostr-tools/nip19';
import type { Event } from 'nostr-tools/pure';
import type { Filter } from 'nostr-tools/filter';
import { PROFILE_RELAYS, SEARCH_RELAYS } from '../src/constants.ts';
import { resolveNip05, searchProfiles, type SearchDeps } from '../src/services/nostrSearch.ts';
import { person, profileEvent } from './helpers/nostr.ts';

const alice = person();
const mallory = person();

function deps(opts: { events?: Event[]; nostrJson?: Record<string, Record<string, string>> } = {}) {
  const queries: Array<{ relays: string[]; filter: Filter }> = [];
  const fetched: string[] = [];
  const d: SearchDeps = {
    query: async (relays, filter) => {
      queries.push({ relays, filter });
      return (opts.events ?? []).filter(e => !filter.authors || filter.authors.includes(e.pubkey));
    },
    fetchFn: async url => {
      fetched.push(url);
      const u = new URL(url);
      const names = opts.nostrJson?.[u.host];
      if (!names) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify({ names }), { status: 200 });
    },
  };
  return { d, queries, fetched };
}

const aliceProfile = profileEvent(alice, { name: 'alice', display_name: 'Alice', lud16: 'alice@wallet.example', nip05: 'alice@alice.example' });
// Same name, claims Alice's NIP-05, but alice.example maps that name to Alice's key.
const impostor = profileEvent(mallory, { name: 'alice', display_name: 'Alice', lud16: 'alice@evil.example', nip05: 'alice@alice.example' });

describe('searchProfiles', () => {
  it('looks up an npub on the profile relays', async () => {
    const { d, queries } = deps({ events: [aliceProfile], nostrJson: { 'alice.example': { alice: alice.pubkey } } });
    const results = await searchProfiles(nip19.npubEncode(alice.pubkey), d);
    assert.equal(results.length, 1);
    assert.equal(results[0].lud16, 'alice@wallet.example');
    assert.equal(results[0].nip05Verified, true);
    assert.deepEqual(queries[0], { relays: PROFILE_RELAYS, filter: { kinds: [0], authors: [alice.pubkey], limit: 5 } });
  });

  it('adds nprofile relay hints to the profile relays', async () => {
    const { d, queries } = deps({ events: [aliceProfile] });
    await searchProfiles(nip19.nprofileEncode({ pubkey: alice.pubkey, relays: ['wss://hint.example'] }), d);
    assert.deepEqual(queries[0].relays, ['wss://hint.example', ...PROFILE_RELAYS]);
  });

  it('resolves a NIP-05 address to its key and returns only that profile', async () => {
    const { d, fetched } = deps({ events: [aliceProfile, impostor], nostrJson: { 'alice.example': { alice: alice.pubkey } } });
    const results = await searchProfiles('alice@alice.example', d);
    assert.deepEqual(results.map(r => r.pubkey), [alice.pubkey]);
    assert.equal(results[0].nip05Verified, true);
    assert.deepEqual(fetched, ['https://alice.example/.well-known/nostr.json?name=alice']);
  });

  it('returns nothing when a name@domain is not a NIP-05 (e.g. only a Lightning Address)', async () => {
    const { d, queries } = deps({ events: [aliceProfile] });
    assert.deepEqual(await searchProfiles('alice@wallet.example', d), []);
    assert.equal(queries.length, 0);
  });

  it('searches names on the search relays and exposes the impostor as unverified', async () => {
    const { d, queries } = deps({ events: [impostor, aliceProfile], nostrJson: { 'alice.example': { alice: alice.pubkey } } });
    const results = await searchProfiles('Alice', d);
    assert.deepEqual(queries[0], { relays: SEARCH_RELAYS, filter: { kinds: [0], search: 'Alice', limit: 20 } });
    assert.deepEqual(results.map(r => [r.lud16, r.nip05Verified]), [['alice@wallet.example', true], ['alice@evil.example', false]]);
  });

  it('drops events with bad signatures', async () => {
    const forged = { ...aliceProfile, content: JSON.stringify({ name: 'alice', lud16: 'thief@evil.example' }) };
    const { d } = deps({ events: [forged] });
    assert.deepEqual(await searchProfiles('alice', d), []);
  });

  it('refuses unusable queries', async () => {
    const { d } = deps();
    await assert.rejects(searchProfiles('  ', d), /Type a name/);
  });
});

describe('resolveNip05', () => {
  it('never contacts private or local hosts', async () => {
    const { d, fetched } = deps();
    assert.equal(await resolveNip05('a@localhost.local', d.fetchFn), null);
    assert.equal(await resolveNip05('a@192.168.1.1', d.fetchFn), null);
    assert.deepEqual(fetched, []);
  });

  it('treats network failures as unresolved', async () => {
    assert.equal(await resolveNip05('a@x.example', async () => { throw new TypeError('Failed to fetch'); }), null);
  });
});
