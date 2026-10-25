import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  contactKeyFor, emptyStore, mergeStores, normalizeName, removeMapping, resolveRecipient, sanitizeStore, saveMapping,
  type MappingStore,
} from '../src/domain/mappings.ts';

const CHAT = 'jid:120363000000000000@g.us';
const OTHER = 'jid:120363111111111111@g.us';

function store(): MappingStore {
  let s = emptyStore();
  s = saveMapping(s, { kind: 'global' }, 'name:alice', 'Alice', 'alice@global.example', 1);
  s = saveMapping(s, { kind: 'chat', chatKey: CHAT }, 'name:alice', 'Alice', 'alice@group.example', 2);
  s = saveMapping(s, { kind: 'global' }, 'id:111@c.us', 'Bob', 'bob@one.example', 3);
  s = saveMapping(s, { kind: 'global' }, 'id:222@c.us', 'Bob', 'bob@two.example', 4);
  return s;
}

describe('normalizeName / contactKeyFor', () => {
  it('ignores case, accents, the @ and extra spaces', () => {
    assert.equal(normalizeName('  @José   María '), 'jose maria');
  });
  it('keys by id when known and by name otherwise', () => {
    assert.equal(contactKeyFor({ label: 'Alice', id: '1@c.us' }), 'id:1@c.us');
    assert.equal(contactKeyFor({ label: 'Álice', id: null }), 'name:alice');
  });
});

describe('resolveRecipient', () => {
  it('prefers the chat mapping over the global one', () => {
    const r = resolveRecipient(store(), CHAT, { label: 'alice', id: null });
    assert.equal(r.kind, 'found');
    assert.equal(r.kind === 'found' && r.mapping.address, 'alice@group.example');
    assert.deepEqual(r.kind === 'found' && r.scope, { kind: 'chat', chatKey: CHAT });
  });

  it('falls back to the global mapping in other chats and with no chat', () => {
    for (const chat of [OTHER, null]) {
      const r = resolveRecipient(store(), chat, { label: 'Alice', id: null });
      assert.equal(r.kind === 'found' && r.mapping.address, 'alice@global.example');
    }
  });

  it('matches an id exactly', () => {
    const r = resolveRecipient(store(), CHAT, { label: 'Bob', id: '222@c.us' });
    assert.equal(r.kind === 'found' && r.mapping.address, 'bob@two.example');
  });

  it('reports ambiguity when a name maps to several addresses', () => {
    const r = resolveRecipient(store(), CHAT, { label: 'Bob', id: null });
    assert.equal(r.kind, 'ambiguous');
    assert.deepEqual(r.kind === 'ambiguous' && r.candidates.map(c => c.mapping.address).sort(), ['bob@one.example', 'bob@two.example']);
  });

  it('is not ambiguous when duplicate names share one address', () => {
    let s = emptyStore();
    s = saveMapping(s, { kind: 'global' }, 'id:1@c.us', 'Carol', 'carol@x.example');
    s = saveMapping(s, { kind: 'global' }, 'name:carol', 'Carol', 'carol@x.example');
    assert.equal(resolveRecipient(s, null, { label: 'carol', id: null }).kind, 'found');
  });

  it('returns unknown for strangers', () => {
    assert.equal(resolveRecipient(store(), CHAT, { label: 'Mallory', id: null }).kind, 'unknown');
  });
});

describe('saveMapping / removeMapping', () => {
  it('normalizes the address and refuses invalid ones', () => {
    const s = saveMapping(emptyStore(), { kind: 'global' }, 'name:a', ' A ', 'Alice@Example.COM', 5);
    assert.deepEqual(s.global['name:a'], { address: 'alice@example.com', displayName: 'A', updatedAt: 5 });
    assert.throws(() => saveMapping(emptyStore(), { kind: 'global' }, 'name:a', 'A', 'not an address'), /Lightning Address/);
  });

  it('does not mutate the input store', () => {
    const before = store();
    const snapshot = JSON.stringify(before);
    saveMapping(before, { kind: 'chat', chatKey: CHAT }, 'name:z', 'Z', 'z@z.example');
    removeMapping(before, { kind: 'global' }, 'name:alice');
    assert.equal(JSON.stringify(before), snapshot);
  });

  it('drops a chat bucket once it is empty', () => {
    const s = removeMapping(store(), { kind: 'chat', chatKey: CHAT }, 'name:alice');
    assert.equal(CHAT in s.groups, false);
  });
});

describe('sanitizeStore / mergeStores', () => {
  it('keeps valid data and drops malformed entries without throwing', () => {
    const raw = {
      global: {
        'name:ok': { address: 'ok@x.example', displayName: 'Ok', updatedAt: 1 },
        'name:bad': { address: 'nope', displayName: 'Bad', updatedAt: 1 },
        'weird': { address: 'w@x.example', displayName: 'W', updatedAt: 1 },
      },
      groups: { [CHAT]: { 'id:1@c.us': { address: 'g@x.example', displayName: 'G', updatedAt: 1 } }, empty: {}, junk: 5 },
    };
    const s = sanitizeStore(raw);
    assert.deepEqual(Object.keys(s.global), ['name:ok']);
    assert.deepEqual(Object.keys(s.groups), [CHAT]);
    for (const junk of [null, 'x', [], 42, { global: [] }]) assert.deepEqual(sanitizeStore(junk), emptyStore());
  });

  it('merges imports over existing entries', () => {
    const base = store();
    const incoming = saveMapping(emptyStore(), { kind: 'global' }, 'name:alice', 'Alice', 'alice@new.example');
    const merged = mergeStores(base, incoming);
    assert.equal(merged.global['name:alice'].address, 'alice@new.example');
    assert.equal(merged.global['id:111@c.us'].address, 'bob@one.example');
    assert.equal(merged.groups[CHAT]['name:alice'].address, 'alice@group.example');
  });
});

describe('mappings — Nostr pubkey', () => {
  const PK = 'a'.repeat(64);
  it('stores a valid pubkey and refuses a malformed one', () => {
    const s = saveMapping(emptyStore(), { kind: 'global' }, 'name:a', 'A', 'a@x.example', 1, PK);
    assert.equal(s.global['name:a'].pubkey, PK);
    assert.equal('pubkey' in saveMapping(emptyStore(), { kind: 'global' }, 'name:a', 'A', 'a@x.example', 1).global['name:a'], false);
    assert.throws(() => saveMapping(emptyStore(), { kind: 'global' }, 'name:a', 'A', 'a@x.example', 1, 'npub1xyz'), /pubkey/);
  });
  it('keeps valid pubkeys through sanitize and drops entries with bad ones', () => {
    const s = sanitizeStore({ global: {
      'name:ok': { address: 'a@x.example', displayName: 'A', updatedAt: 1, pubkey: PK },
      'name:bad': { address: 'b@x.example', displayName: 'B', updatedAt: 1, pubkey: 'zz' },
    } });
    assert.deepEqual(Object.keys(s.global), ['name:ok']);
  });
});

describe('withSnapshot', () => {
  const PK = 'a'.repeat(64);
  it('replaces a linked mapping’s Nostr snapshot, keeping everything else', async () => {
    const { withSnapshot } = await import('../src/domain/mappings.ts');
    const s = saveMapping(emptyStore(), { kind: 'global' }, 'name:a', 'A', 'a@x.example', 5, PK, { name: 'A', nip05: null });
    const next = withSnapshot(s, { kind: 'global' }, 'name:a', { name: 'A', nip05: null, picture: 'https://img.example/a.png' });
    assert.deepEqual(next.global['name:a'], {
      address: 'a@x.example', displayName: 'A', updatedAt: 5, pubkey: PK,
      nostr: { name: 'A', nip05: null, picture: 'https://img.example/a.png' },
    });
  });
  it('leaves unlinked or missing mappings alone', async () => {
    const { withSnapshot } = await import('../src/domain/mappings.ts');
    const s = saveMapping(emptyStore(), { kind: 'global' }, 'name:b', 'B', 'b@x.example', 5);
    assert.equal(withSnapshot(s, { kind: 'global' }, 'name:b', { name: 'B', nip05: null }), s);
    assert.equal(withSnapshot(s, { kind: 'global' }, 'name:zzz', { name: 'Z', nip05: null }), s);
  });
});
