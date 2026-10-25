import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLinkView, contactKeys, runLinkPopup, type LinkAnswer, type LinkDeps, type LinkView } from '../src/linkFlow.ts';
import { emptyStore, removeMapping, saveMapping, type MappingScope, type MappingStore, type NostrSnapshot } from '../src/domain/mappings.ts';
import type { ChatContact } from '../src/whatsapp/dom.ts';

const PK = 'e'.repeat(64);
const ANA: ChatContact = { kind: 'contact', id: '5491100000000@c.us', name: 'Ana Paula' };
const GROUP: ChatContact = { kind: 'group', chatKey: 'jid:1@g.us', title: 'Friends' };

function setup(answers: LinkAnswer[], initial: MappingStore = emptyStore(), resolveFails?: string) {
  let store = initial;
  const views: Array<{ view: LinkView; notice?: { text: string; error?: boolean } }> = [];
  const resolved: string[] = [];
  let closed = 0;
  const deps: LinkDeps = {
    ui: {
      link: async (view, notice) => { views.push({ view, notice }); return answers.shift() ?? null; },
      close: () => { closed++; },
    },
    loadMappings: async () => store,
    saveMapping: async (scope: MappingScope, key, name, address, pubkey?: string, nostr?: NostrSnapshot) => {
      store = saveMapping(store, scope, key, name, address, 1, pubkey, nostr);
    },
    removeMapping: async (scope, key) => { store = removeMapping(store, scope, key); },
    resolve: async address => {
      resolved.push(address);
      if (resolveFails && address === resolveFails) throw new Error('LNURL: endpoint returned 404');
      return { address: address.toLowerCase(), domain: address.split('@')[1], minSats: 1, maxSats: 1e6, commentAllowed: 0, description: null };
    },
  };
  return { deps, views, resolved, store: () => store, closed: () => closed };
}

describe('buildLinkView', () => {
  it('finds a contact by id first, then by name', () => {
    let s = saveMapping(emptyStore(), { kind: 'global' }, 'name:ana paula', 'Ana Paula', 'old@x.example');
    assert.equal(buildLinkView(s, ANA).current?.contactKey, 'name:ana paula');
    s = saveMapping(s, { kind: 'global' }, 'id:5491100000000@c.us', 'Ana Paula', 'new@x.example');
    assert.equal(buildLinkView(s, ANA).current?.mapping.address, 'new@x.example');
    assert.equal(buildLinkView(emptyStore(), ANA).current, null);
  });

  it('lists a group’s members by name', () => {
    let s = saveMapping(emptyStore(), { kind: 'chat', chatKey: 'jid:1@g.us' }, 'name:zoe', 'Zoe', 'z@x.example');
    s = saveMapping(s, { kind: 'chat', chatKey: 'jid:1@g.us' }, 'name:ana', 'Ana', 'a@x.example');
    s = saveMapping(s, { kind: 'chat', chatKey: 'jid:2@g.us' }, 'name:bob', 'Bob', 'b@x.example');
    assert.deepEqual(buildLinkView(s, GROUP).members.map(m => m.mapping.displayName), ['Ana', 'Zoe']);
  });

  it('keys a contact without an id by name', () => {
    assert.deepEqual(contactKeys({ kind: 'contact', id: null, name: 'Ána' }), ['name:ana']);
  });
});

describe('runLinkPopup', () => {
  it('links a contact to a Nostr profile, globally and by id', async () => {
    const t = setup([{ action: 'link', address: 'ana@wallet.example', pubkey: PK, nostr: { name: 'Ana', nip05: 'ana@nostr.example' } }]);
    await runLinkPopup(ANA, t.deps);
    assert.deepEqual(t.store().global['id:5491100000000@c.us'], {
      address: 'ana@wallet.example', displayName: 'Ana Paula', updatedAt: 1, pubkey: PK, nostr: { name: 'Ana', nip05: 'ana@nostr.example' },
    });
    assert.deepEqual(t.views[1].notice, { text: 'Linked Ana Paula → ana@wallet.example.' });
    assert.equal(t.closed(), 1);
  });

  it('replaces a name-keyed link with the id-keyed one', async () => {
    const initial = saveMapping(emptyStore(), { kind: 'global' }, 'name:ana paula', 'Ana Paula', 'old@x.example');
    const t = setup([{ action: 'link', address: 'new@x.example' }], initial);
    await runLinkPopup(ANA, t.deps);
    assert.deepEqual(Object.keys(t.store().global), ['id:5491100000000@c.us']);
  });

  it('unlinks', async () => {
    const initial = saveMapping(emptyStore(), { kind: 'global' }, 'id:5491100000000@c.us', 'Ana Paula', 'a@x.example');
    const t = setup([{ action: 'unlink', contactKey: 'id:5491100000000@c.us' }], initial);
    await runLinkPopup(ANA, t.deps);
    assert.deepEqual(t.store().global, {});
    assert.equal(t.views[1].view.current, null);
    assert.deepEqual(t.views[1].notice, { text: 'Unlinked.' });
  });

  it('links a group member by name inside the group, and requires that name', async () => {
    const t = setup([
      { action: 'link', address: 'a@x.example', memberName: '  ' },
      { action: 'link', address: 'a@x.example', memberName: 'Ana' },
    ]);
    await runLinkPopup(GROUP, t.deps);
    assert.equal(t.views[1].notice?.error, true);
    assert.deepEqual(t.resolved, ['a@x.example'], 'nothing looked up without a name');
    assert.equal(t.store().groups['jid:1@g.us']['name:ana'].address, 'a@x.example');
    assert.deepEqual(t.store().global, {});
  });

  it('does not save an address that does not answer', async () => {
    const t = setup([{ action: 'link', address: 'dead@x.example' }], emptyStore(), 'dead@x.example');
    await runLinkPopup(ANA, t.deps);
    assert.deepEqual(t.store().global, {});
    assert.match(t.views[1].notice!.text, /dead@x\.example: LNURL: endpoint returned 404/);
  });

  it('drops the Nostr snapshot when no pubkey came with it', async () => {
    const t = setup([{ action: 'link', address: 'a@x.example', nostr: { name: 'Fake', nip05: null } }]);
    await runLinkPopup(ANA, t.deps);
    assert.equal('nostr' in t.store().global['id:5491100000000@c.us'], false);
  });
});
