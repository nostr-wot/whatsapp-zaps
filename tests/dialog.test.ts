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
  chatMessage: {
    text: '⚡ Zapped <b>Alice</b> 1,000 sats — lunch',
    mention: { before: '⚡ Zapped ', who: { label: '<b>Alice</b>', id: '1@c.us' }, after: ' 1,000 sats — lunch' },
  },
  postByDefault: true,
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
    assert.deepEqual(await answer, { post: true });
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

  it('offers to post the message after the payment, remembering the last choice', async () => {
    const { dialog, root, button } = open();
    const answer = dialog.confirm({ ...DETAILS, postByDefault: false });
    const box = root()!.querySelector('#wz-post') as HTMLInputElement;
    assert.equal(box.checked, false);
    assert.match(root()!.textContent!, /Post in the chat once the payment is confirmed/);
    assert.match(root()!.querySelector('.preview')!.textContent!, /⚡ Zapped @<b>Alice<\/b> 1,000 sats — lunch/);
    assert.equal(root()!.querySelector('.preview .mention')!.textContent, '@<b>Alice</b>', 'the mention is shown as one');
    box.checked = true;
    button(/^Pay/).click();
    assert.deepEqual(await answer, { post: true });
  });

  it('reports what happened in the chat after a confirmed payment', () => {
    const sent = open();
    void sent.dialog.showResult({ outcome: 'paid', preimage: 'p' }, DETAILS, { commandCleared: true, message: 'sent' });
    assert.match(sent.root()!.textContent!, /Payment confirmed/);
    assert.match(sent.root()!.textContent!, /Posted in the chat/);
    sent.dialog.close();

    const failed = open();
    void failed.dialog.showResult({ outcome: 'paid', preimage: 'p' }, DETAILS, { commandCleared: false, message: 'not_sent' });
    const text = failed.root()!.textContent!;
    assert.match(text, /could not be posted/);
    assert.equal(failed.root()!.querySelector('.copy-box output')!.textContent, DETAILS.chatMessage.text);
    assert.match(text, /still in the message box/);
  });

  it('posts nothing and warns on an unknown outcome', () => {
    const unknown = open();
    void unknown.dialog.showResult({ outcome: 'unknown', error: 'timeout' }, DETAILS, null);
    assert.match(unknown.root()!.textContent!, /nothing was posted/);
    assert.match(unknown.root()!.textContent!, /second payment/);
  });

  it('asks before paying the same command again; the safe answer is the default', async () => {
    const { dialog, root, button } = open();
    const answer = dialog.confirmRepeat(3, { name: 'Ana', amountSats: 21 });
    assert.match(root()!.textContent!, /21 sats.*Ana.*3 minutes ago/s);
    assert.equal(root()!.activeElement?.textContent, 'Don’t pay again');
    button('Pay again').click();
    assert.equal(await answer, true);
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

  it('checks a typed name@domain on Nostr, and uses it as typed when it names no one', async () => {
    const t = withSearch(async () => []);
    const answer = t.dialog.askAddress('Alice', null);
    (t.root().querySelector('input[type="text"]') as HTMLInputElement).value = 'alice@wallet.example';
    t.root().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    assert.deepEqual(await answer, { address: 'alice@wallet.example', remember: 'global' });
    assert.deepEqual(t.queries, ['alice@wallet.example']);
  });

  it('pays the profile’s Lightning Address when a NIP-05 was typed, not the NIP-05', async () => {
    const t = withSearch(async () => [results[0]]);
    const answer = t.dialog.askAddress('Alice', null);
    (t.root().querySelector('input[type="text"]') as HTMLInputElement).value = 'Alice@A.example';
    t.root().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    assert.deepEqual(await answer, { address: 'alice@wallet.example', remember: 'global', pubkey: PK });
  });

  it('does not trust an unverified NIP-05 match', async () => {
    const t = withSearch(async () => [{ ...results[0], nip05Verified: false }]);
    const answer = t.dialog.askAddress('Alice', null);
    (t.root().querySelector('input[type="text"]') as HTMLInputElement).value = 'alice@a.example';
    t.root().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    assert.deepEqual(await answer, { address: 'alice@a.example', remember: 'global' });
  });

  it('uses the text as typed when the lookup fails', async () => {
    const t = withSearch(async () => { throw new Error('relays down'); });
    const answer = t.dialog.askAddress('Alice', null);
    (t.root().querySelector('input[type="text"]') as HTMLInputElement).value = 'alice@wallet.example';
    t.root().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    assert.deepEqual(await answer, { address: 'alice@wallet.example', remember: 'global' });
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

describe('ZapDialog — link popup', () => {
  beforeEach(() => { installDom(); });

  const PK = 'f'.repeat(64);
  const PROFILE = { pubkey: PK, npub: 'npub1anaanaanaanaanaana', displayName: 'Ana P', name: 'ana', nip05: 'ana@nostr.example', nip05Verified: true, lud16: 'ana@wallet.example', createdAt: 1 };
  const contact = { kind: 'contact' as const, id: '5491100000000@c.us', name: 'Ana Paula' };

  function make(search: (q: string) => Promise<typeof PROFILE[]> = async () => [PROFILE]) {
    const queries: string[] = [];
    const dialog = new ZapDialog({ shadowMode: 'open', requireTrusted: false, search: q => { queries.push(q); return search(q); } });
    const root = () => document.querySelector('[data-whatsapp-zaps]')!.shadowRoot!;
    const button = (text: string | RegExp) => [...root().querySelectorAll('button')]
      .find(b => (typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? ''))) as HTMLButtonElement;
    return { dialog, root, button, queries };
  }

  it('shows the current link with its Nostr name, verified NIP-05 and npub, and unlinks', async () => {
    const t = make();
    const answer = t.dialog.link({
      contact,
      current: { contactKey: 'id:x', mapping: { address: 'ana@wallet.example', displayName: 'Ana Paula', updatedAt: 1, pubkey: PK, nostr: { name: 'Ana P', nip05: 'ana@nostr.example' } } },
      members: [],
    });
    const text = t.root().textContent!;
    assert.match(text, /Ana Paula · 5491100000000/);
    assert.match(text, /Ana P ✓ ana@nostr\.example/);
    assert.match(text, /npub1/);
    assert.match(text, /⚡ ana@wallet\.example/);
    assert.equal(t.button(/Replace link/).disabled, true, 'nothing to link yet');
    t.button('Unlink').click();
    assert.deepEqual(await answer, { action: 'unlink', contactKey: 'id:x' });
  });

  it('prefills the contact name but never searches on its own', async () => {
    const t = make();
    void t.dialog.link({ contact, current: null, members: [] });
    assert.equal((t.root().querySelector('#wz-query') as HTMLInputElement).value, 'Ana Paula');
    assert.match(t.root().textContent!, /saved only in this browser/);
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(t.queries, []);
  });

  it('links a picked profile with its pubkey and a snapshot', async () => {
    const t = make();
    const answer = t.dialog.link({ contact, current: null, members: [] });
    t.button('Search Nostr').click();
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(t.queries, ['Ana Paula']);
    (t.root().querySelector('.results button.option') as HTMLButtonElement).click();
    assert.equal(t.button('Link').disabled, false);
    t.root().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    assert.deepEqual(await answer, {
      action: 'link', address: 'ana@wallet.example', pubkey: PK, nostr: { name: 'Ana P', nip05: 'ana@nostr.example' },
    });
  });

  it('never stores an unverified NIP-05 in the snapshot', async () => {
    const t = make(async () => [{ ...PROFILE, nip05Verified: false }]);
    const answer = t.dialog.link({ contact, current: null, members: [] });
    t.button('Search Nostr').click();
    await new Promise(r => setTimeout(r, 0));
    (t.root().querySelector('.results button.option') as HTMLButtonElement).click();
    t.root().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    assert.equal((await answer as { nostr: { nip05: string | null } }).nostr.nip05, null);
  });

  it('links a typed Lightning Address without Nostr when it names no profile', async () => {
    const t = make(async () => []);
    const answer = t.dialog.link({ contact, current: null, members: [] });
    const input = t.root().querySelector('#wz-query') as HTMLInputElement;
    input.value = 'ana@wallet.example';
    input.dispatchEvent(new Event('input'));
    assert.equal(t.button('Link').disabled, false);
    t.root().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    assert.deepEqual(await answer, { action: 'link', address: 'ana@wallet.example' });
  });

  it('links the profile’s Lightning Address when Link is pressed on a NIP-05 search', async () => {
    // The reported bug: search for a NIP-05, see the right profile, press Link
    // without clicking it — the NIP-05 itself was linked and answered 404.
    const t = make();
    const answer = t.dialog.link({ contact, current: null, members: [] });
    const input = t.root().querySelector('#wz-query') as HTMLInputElement;
    input.value = 'ana@nostr.example';
    input.dispatchEvent(new Event('input'));
    t.button('Search Nostr').click();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(t.root().querySelectorAll('.results button.option').length, 1);
    t.button('Link').click();
    assert.deepEqual(await answer, {
      action: 'link', address: 'ana@wallet.example', pubkey: PK, nostr: { name: 'Ana P', nip05: 'ana@nostr.example' },
    });
  });

  it('in a group, lists linked members and asks for the member’s name', async () => {
    const t = make();
    const answer = t.dialog.link({
      contact: { kind: 'group', chatKey: 'jid:1@g.us', title: 'Friends' },
      current: null,
      members: [{ contactKey: 'name:bob', mapping: { address: 'bob@x.example', displayName: 'Bob', updatedAt: 1 } }],
    });
    assert.match(t.root().textContent!, /Members of Friends/);
    assert.match(t.root().textContent!, /Bob.*bob@x\.example/s);
    const member = t.root().querySelector('#wz-member') as HTMLInputElement;
    const input = t.root().querySelector('#wz-query') as HTMLInputElement;
    assert.equal(input.value, '', 'nothing prefilled in a group');
    input.value = 'Ana';
    t.button('Search Nostr').click();
    await new Promise(r => setTimeout(r, 0));
    (t.root().querySelector('.results button.option') as HTMLButtonElement).click();
    assert.equal(member.value, 'Ana P', 'member name suggested from the profile');
    member.value = 'Ana from work';
    t.root().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    assert.deepEqual(await answer, {
      action: 'link', address: 'ana@wallet.example', memberName: 'Ana from work', pubkey: PK, nostr: { name: 'Ana P', nip05: 'ana@nostr.example' },
    });
  });

  it('shows notices from the last action', () => {
    const t = make();
    void t.dialog.link({ contact, current: null, members: [] }, { text: 'x@y.example: LNURL: endpoint returned 404', error: true });
    assert.match(t.root().querySelector('.error')!.textContent!, /404/);
  });
});
