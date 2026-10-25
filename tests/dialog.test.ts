import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './helpers/dom.ts';
import { ZapDialog } from '../src/ui/dialog.ts';
import type { ConfirmDetails } from '../src/flow.ts';

const DETAILS: ConfirmDetails = {
  name: '<b>Alice</b>',
  recipient: { address: 'alice@w.example', domain: 'w.example', minSats: 1, maxSats: 1000, commentAllowed: 0, description: '<img src=x onerror=alert(1)>' },
  amountSats: 1000,
  comment: 'lunch',
};

function open(requireTrusted = false) {
  const dialog = new ZapDialog({ shadowMode: 'open', requireTrusted });
  const root = () => document.querySelector('[data-whatsapp-zaps]')?.shadowRoot ?? null;
  const button = (label: string | RegExp) => [...root()!.querySelectorAll('button')]
    .find(b => (typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? ''))) as HTMLButtonElement;
  return { dialog, root, button };
}

describe('ZapDialog', () => {
  beforeEach(() => { installDom(); });

  it('shows the summary as text, never as markup', async () => {
    const { dialog, root, button } = open();
    const answer = dialog.confirm(DETAILS);
    const text = root()!.textContent ?? '';
    assert.match(text, /<b>Alice<\/b>/);
    assert.match(text, /1,000 sats/);
    assert.match(text, /does not accept comments/);
    assert.equal(root()!.querySelector('img, b'), null);
    button(/^Pay/).click();
    assert.equal(await answer, true);
  });

  it('ignores synthetic clicks on Pay by default', async () => {
    const { dialog, button } = open(true);
    let settled = false;
    void dialog.confirm(DETAILS).then(() => { settled = true; });
    button(/^Pay/).click();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(settled, false);
  });

  it('cancels with Escape', async () => {
    const { dialog, root } = open();
    const answer = dialog.confirm(DETAILS);
    root()!.querySelector('.backdrop')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(await answer, false);
  });

  it('validates the address and returns the remember choice', async () => {
    const { dialog, root } = open();
    const answer = dialog.askAddress('Bob', 'Friends');
    const input = root()!.querySelector('input[type="text"]') as HTMLInputElement;
    const form = root()!.querySelector('form')!;
    input.value = 'not an address';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    assert.match(root()!.querySelector('.error')!.textContent!, /not a Lightning Address/);
    input.value = 'Bob@W.example';
    (root()!.querySelector('input[value="global"]') as HTMLInputElement).checked = true;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    assert.deepEqual(await answer, { address: 'Bob@W.example', remember: 'global' });
  });

  it('defaults to remembering for the chat, and hides that option without one', async () => {
    const a = open();
    void a.dialog.askAddress('Bob', 'Friends');
    assert.equal((a.root()!.querySelector('input[type="radio"]:checked') as HTMLInputElement).value, 'chat');
    a.dialog.close();
    const b = open();
    void b.dialog.askAddress('Bob', null);
    assert.equal(b.root()!.querySelector('input[value="chat"]'), null);
    assert.equal((b.root()!.querySelector('input[type="radio"]:checked') as HTMLInputElement).value, 'global');
  });

  it('offers the chat message only after a payment', async () => {
    const paid = open();
    const choice = paid.dialog.showResult({ outcome: 'paid', preimage: 'p' }, DETAILS);
    paid.button('Add message to chat').click();
    assert.equal(await choice, 'insert');
    paid.dialog.close();

    const unknown = open();
    void unknown.dialog.showResult({ outcome: 'unknown', error: 'timeout' }, DETAILS);
    assert.equal(unknown.button('Add message to chat'), undefined);
    assert.match(unknown.root()!.textContent!, /second payment/);
  });

  it('removes itself and reports closing', () => {
    let closed = 0;
    const dialog = new ZapDialog({ shadowMode: 'open', onClosed: () => { closed++; } });
    dialog.showLoading('…');
    assert.equal(dialog.isOpen, true);
    dialog.close();
    assert.equal(document.querySelector('[data-whatsapp-zaps]'), null);
    assert.equal(closed, 1);
  });
});

describe('ZapDialog — Nostr search', () => {
  beforeEach(() => { installDom(); });

  const PK = 'c'.repeat(64);
  const results = [
    { pubkey: PK, npub: 'npub1alicealicealicealice', displayName: 'Alice', name: 'alice', nip05: 'alice@a.example', nip05Verified: true, lud16: 'alice@wallet.example', createdAt: 1 },
    { pubkey: 'd'.repeat(64), npub: 'npub1nolightningnolightning', displayName: 'Alice (no LN)', name: null, nip05: 'alice@b.example', nip05Verified: false, lud16: null, createdAt: 1 },
  ];

  function withSearch(impl: (q: string) => Promise<typeof results>) {
    const queries: string[] = [];
    const dialog = new ZapDialog({ shadowMode: 'open', requireTrusted: false, search: q => { queries.push(q); return impl(q); } });
    const root = () => document.querySelector('[data-whatsapp-zaps]')!.shadowRoot!;
    const tick = () => new Promise(r => setTimeout(r, 0));
    return { dialog, root, queries, tick };
  }

  it('searches on Enter when the input is not an address, and picking a result fills it in', async () => {
    const t = withSearch(async () => results);
    const answer = t.dialog.askAddress('Alice', 'Friends');
    const input = t.root().querySelector('input[type="text"]') as HTMLInputElement;
    const form = t.root().querySelector('form')!;
    input.value = 'alice';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await t.tick();
    assert.deepEqual(t.queries, ['alice']);
    const options = [...t.root().querySelectorAll('.results button.option')] as HTMLButtonElement[];
    assert.equal(options.length, 2);
    assert.match(options[0].textContent!, /✓ alice@a\.example/);
    assert.match(options[1].textContent!, /not verified/);
    assert.equal(options[1].disabled, true);
    options[0].click();
    assert.equal(input.value, 'alice@wallet.example');
    assert.match(t.root().textContent!, /Selected Alice/);
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    assert.deepEqual(await answer, { address: 'alice@wallet.example', remember: 'chat', pubkey: PK });
  });

  it('forgets the profile when the address is edited by hand', async () => {
    const t = withSearch(async () => results);
    const answer = t.dialog.askAddress('Alice', 'Friends');
    const input = t.root().querySelector('input[type="text"]') as HTMLInputElement;
    input.value = 'alice';
    (([...t.root().querySelectorAll('button')].find(b => b.textContent === 'Search Nostr')) as HTMLButtonElement).click();
    await t.tick();
    (t.root().querySelector('.results button.option') as HTMLButtonElement).click();
    input.value = 'someone@else.example';
    input.dispatchEvent(new Event('input'));
    t.root().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    assert.deepEqual(await answer, { address: 'someone@else.example', remember: 'chat' });
  });

  it('submits a typed Lightning Address directly, without searching', async () => {
    const t = withSearch(async () => results);
    const answer = t.dialog.askAddress('Alice', null);
    (t.root().querySelector('input[type="text"]') as HTMLInputElement).value = 'alice@wallet.example';
    t.root().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    assert.deepEqual(await answer, { address: 'alice@wallet.example', remember: 'global' });
    assert.deepEqual(t.queries, []);
  });

  it('shows search errors and empty results, and ignores stale answers', async () => {
    let release!: (r: typeof results) => void;
    const slow = new Promise<typeof results>(r => { release = r; });
    let call = 0;
    const t = withSearch(q => (++call === 1 ? slow : q === 'boom' ? Promise.reject(new Error('relays unreachable')) : Promise.resolve([])));
    void t.dialog.askAddress('Alice', null);
    const input = t.root().querySelector('input[type="text"]') as HTMLInputElement;
    const form = t.root().querySelector('form')!;
    input.value = 'first';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    input.value = 'second';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await t.tick();
    assert.match(t.root().textContent!, /No Nostr profiles found/);
    release(results);
    await t.tick();
    assert.equal(t.root().querySelectorAll('.results button.option').length, 0, 'stale results must not appear');
    input.value = 'boom';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await t.tick();
    assert.match(t.root().querySelector('.error')!.textContent!, /relays unreachable/);
  });

  it('offers no search without a search function', () => {
    const dialog = new ZapDialog({ shadowMode: 'open', requireTrusted: false });
    void dialog.askAddress('Alice', null);
    const root = document.querySelector('[data-whatsapp-zaps]')!.shadowRoot!;
    assert.equal([...root.querySelectorAll('button')].some(b => b.textContent === 'Search Nostr'), false);
  });
});
