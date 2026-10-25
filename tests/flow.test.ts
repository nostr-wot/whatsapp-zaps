import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runZap, type ZapDeps, type ZapUi, type AddressAnswer, type Candidate } from '../src/flow.ts';
import { emptyStore, saveMapping, type MappingStore } from '../src/domain/mappings.ts';
import type { RecipientInfo } from '../src/domain/messages.ts';
import type { PayOutcome } from '../src/domain/bridge.ts';

const CHAT = { chatKey: 'jid:1@g.us', chatTitle: 'Friends' };
const info = (address: string, extra: Partial<RecipientInfo> = {}): RecipientInfo =>
  ({ address, domain: address.split('@')[1], minSats: 1, maxSats: 1_000_000, commentAllowed: 100, description: null, ...extra });

interface Script {
  store?: MappingStore;
  addresses?: Array<AddressAnswer | null>;
  choose?: (c: Candidate[]) => Candidate | null;
  confirm?: boolean;
  resultChoice?: 'insert' | 'close';
  resolve?: (address: string) => Promise<RecipientInfo>;
  pay?: (bolt11: string) => Promise<PayOutcome>;
}

function setup(script: Script = {}) {
  const log: string[] = [];
  const addresses = [...(script.addresses ?? [])];
  const ui: ZapUi = {
    askAddress: async (name, title, error) => { log.push(`ask:${name}:${title}${error ? `:${error}` : ''}`); return addresses.shift() ?? null; },
    choose: async (_n, c) => { log.push(`choose:${c.length}`); return script.choose ? script.choose(c) : null; },
    showLoading: m => { log.push(`loading:${m}`); },
    confirm: async d => { log.push(`confirm:${d.recipient.address}:${d.amountSats}:${d.comment}`); return script.confirm ?? true; },
    showResult: async o => { log.push(`result:${o.outcome}`); return script.resultChoice ?? 'close'; },
    showError: async m => { log.push(`error:${m}`); },
    close: () => { log.push('close'); },
  };
  const saved: string[] = [];
  const deps: ZapDeps = {
    ui,
    loadMappings: async () => script.store ?? emptyStore(),
    saveMapping: async (scope, key, name, address, pubkey) => {
      saved.push(`${scope.kind === 'chat' ? scope.chatKey : 'global'}|${key}|${name}|${address}${pubkey ? `|${pubkey}` : ''}`);
    },
    resolve: script.resolve ?? (async a => info(a)),
    invoice: async (address, amountSats, comment) => { log.push(`invoice:${address}:${amountSats}:${comment}`); return { bolt11: 'lnbc1inv', amountSats }; },
    pay: script.pay ?? (async b => { log.push(`pay:${b}`); return { outcome: 'paid', preimage: 'p' }; }),
    insertMessage: t => { log.push(`insert:${t}`); },
    clearComposer: () => { log.push('clear'); },
  };
  return { deps, log, saved };
}

const known = saveMapping(emptyStore(), { kind: 'global' }, 'name:alice', 'Alice', 'alice@w.example');

describe('runZap', () => {
  it('pays a known recipient once and offers the chat message', async () => {
    const { deps, log } = setup({ store: known, resultChoice: 'insert' });
    assert.equal(await runZap('/zap @Alice 1000 lunch', [], CHAT, deps), 'paid');
    assert.deepEqual(log, [
      'loading:Looking up alice@w.example…',
      'confirm:alice@w.example:1000:lunch',
      'loading:Requesting invoice…',
      'invoice:alice@w.example:1000:lunch',
      'loading:Waiting for your wallet…',
      'pay:lnbc1inv',
      'clear',
      'result:paid',
      'insert:⚡ Zapped @Alice 1,000 sats',
      'close',
    ]);
  });

  it('zaps the other person in a one-to-one chat when no one is mentioned', async () => {
    const { deps, log } = setup({ store: saveMapping(emptyStore(), { kind: 'global' }, 'id:54911@c.us', 'Ana', 'ana@w.example') });
    const chat = { chatKey: 'jid:54911@c.us', chatTitle: 'Ana', contact: { label: 'Ana', id: '54911@c.us' } };
    assert.equal(await runZap('/zap 21 thanks', [], chat, deps), 'paid');
    assert.ok(log.includes('confirm:ana@w.example:21:thanks'));
  });

  it('asks for a mention when no one is named in a group', async () => {
    const { deps, log } = setup({ store: known });
    assert.equal(await runZap('/zap 21', [], CHAT, deps), 'invalid');
    assert.match(log[0], /^error:In a group, say who to zap/);
  });

  it('a mention still wins in a one-to-one chat', async () => {
    const { deps, log } = setup({ store: known });
    const chat = { chatKey: 'jid:54911@c.us', chatTitle: 'Ana', contact: { label: 'Ana', id: '54911@c.us' } };
    await runZap('/zap @Alice 5', [], chat, deps);
    assert.ok(log.includes('confirm:alice@w.example:5:'));
  });

  it('shows usage for an invalid command and does nothing else', async () => {
    const { deps, log } = setup();
    assert.equal(await runZap('/zap @Alice', [], CHAT, deps), 'invalid');
    assert.match(log[0], /^error:Add an amount/);
    assert.deepEqual(log.slice(1), ['close']);
  });

  it('asks for an unknown address and remembers it for this chat', async () => {
    const { deps, log, saved } = setup({ addresses: [{ address: 'bob@w.example', remember: 'chat' }] });
    assert.equal(await runZap('/zap @Bob 21', [], CHAT, deps), 'paid');
    assert.equal(log[0], 'ask:Bob:Friends');
    assert.deepEqual(saved, ['jid:1@g.us|name:bob|Bob|bob@w.example']);
  });

  it('remembers which Nostr profile an address came from', async () => {
    const pk = 'b'.repeat(64);
    const { deps, saved } = setup({ addresses: [{ address: 'bob@w.example', remember: 'global', pubkey: pk }] });
    await runZap('/zap @Bob 21', [], CHAT, deps);
    assert.deepEqual(saved, [`global|name:bob|Bob|bob@w.example|${pk}`]);
  });

  it('keys a picked mention by its contact id', async () => {
    const { deps, saved } = setup({ addresses: [{ address: 'bob@w.example', remember: 'global' }] });
    await runZap('/zap @Bob 21', [{ label: 'Bob', id: '99@c.us' }], CHAT, deps);
    assert.deepEqual(saved, ['global|id:99@c.us|Bob|bob@w.example']);
  });

  it('does not offer a chat mapping when the chat is unknown, nor save one', async () => {
    const { deps, log, saved } = setup({ addresses: [{ address: 'bob@w.example', remember: 'chat' }] });
    await runZap('/zap @Bob 21', [], { chatKey: null, chatTitle: 'Friends' }, deps);
    assert.equal(log[0], 'ask:Bob:null');
    assert.deepEqual(saved, []);
  });

  it('does not save an address that fails to resolve, and asks again', async () => {
    const { deps, log, saved } = setup({
      addresses: [{ address: 'bad@w.example', remember: 'global' }, { address: 'good@w.example', remember: 'global' }],
      resolve: async a => { if (a.startsWith('bad')) throw new Error('LNURL: endpoint returned 404'); return info(a); },
    });
    assert.equal(await runZap('/zap @Bob 21', [], CHAT, deps), 'paid');
    assert.ok(log.some(l => l.startsWith('ask:Bob:Friends:bad@w.example is not a Lightning Address')));
    assert.deepEqual(saved, ['global|name:bob|Bob|good@w.example']);
  });

  it('asks again when a saved address stops resolving', async () => {
    const { deps, log } = setup({
      store: known, addresses: [null],
      resolve: async () => { throw new Error('LNURL: could not reach the endpoint'); },
    });
    assert.equal(await runZap('/zap @Alice 21', [], CHAT, deps), 'cancelled');
    assert.ok(log.some(l => l.startsWith('ask:Alice:Friends:w.example did not answer')));
  });

  it('lets the user pick between contacts with the same name', async () => {
    let s = saveMapping(emptyStore(), { kind: 'global' }, 'id:1@c.us', 'Bob', 'bob1@w.example');
    s = saveMapping(s, { kind: 'global' }, 'id:2@c.us', 'Bob', 'bob2@w.example');
    const { deps, log } = setup({ store: s, choose: c => c.find(x => x.mapping.address === 'bob2@w.example')! });
    assert.equal(await runZap('/zap @Bob 5', [], CHAT, deps), 'paid');
    assert.equal(log[0], 'choose:2');
    assert.ok(log.includes('invoice:bob2@w.example:5:'));
  });

  it('stops before any invoice when the user cancels', async () => {
    for (const script of [{ store: known, confirm: false }, { addresses: [null] }] as Script[]) {
      const { deps, log } = setup(script);
      assert.equal(await runZap('/zap @Alice 5', [], CHAT, deps), 'cancelled');
      assert.equal(log.some(l => l.startsWith('invoice') || l.startsWith('pay')), false);
      assert.equal(log.at(-1), 'close');
    }
  });

  it('refuses amounts outside the recipient limits before confirming', async () => {
    const { deps, log } = setup({ store: known, resolve: async a => info(a, { minSats: 10, maxSats: 100 }) });
    assert.equal(await runZap('/zap @Alice 500', [], CHAT, deps), 'error');
    assert.ok(log.includes('error:alice@w.example accepts between 10 and 100 sats.'));
    assert.equal(log.some(l => l.startsWith('confirm')), false);
  });

  it('keeps the command and offers nothing when the wallet refuses', async () => {
    const { deps, log } = setup({ store: known, pay: async () => ({ outcome: 'not_paid', error: 'Payment denied by user' }) });
    assert.equal(await runZap('/zap @Alice 5', [], CHAT, deps), 'not_paid');
    assert.equal(log.includes('clear'), false);
    assert.equal(log.some(l => l.startsWith('insert')), false);
  });

  it('never retries: a throwing payer is one attempt with an unknown outcome', async () => {
    let attempts = 0;
    const { deps, log } = setup({ store: known, resultChoice: 'insert', pay: async () => { attempts++; throw new Error('bridge gone'); } });
    assert.equal(await runZap('/zap @Alice 5', [], CHAT, deps), 'unknown');
    assert.equal(attempts, 1);
    assert.equal(log.filter(l => l.startsWith('invoice')).length, 1);
    assert.equal(log.some(l => l.startsWith('insert')), false);
  });

  it('reports an invoice failure as an error without paying', async () => {
    const { deps, log } = setup({ store: known });
    deps.invoice = async () => { throw new Error('LNURL: invoice is for 6 sats, not the 5 sats requested'); };
    assert.equal(await runZap('/zap @Alice 5', [], CHAT, deps), 'error');
    assert.ok(log.includes('error:LNURL: invoice is for 6 sats, not the 5 sats requested'));
    assert.equal(log.some(l => l.startsWith('pay')), false);
  });
});
