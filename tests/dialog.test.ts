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

  it('draws in the chosen Nostr WoT theme', async () => {
    let theme: 'coracle' | 'lacrypta' = 'coracle';
    const dialog = new ZapDialog({ shadowMode: 'open', requireTrusted: false, theme: () => theme });
    const answer = dialog.confirm(DETAILS);
    const host = () => document.querySelector('[data-whatsapp-zaps]') as HTMLElement;
    assert.equal(host().dataset.theme, 'coracle');
    const css = [...(host().shadowRoot!.adoptedStyleSheets ?? [])].flatMap(sheet => [...sheet.cssRules].map(r => r.cssText)).join(' ')
      + [...host().shadowRoot!.querySelectorAll('style')].map(s => s.textContent).join(' ');
    assert.match(css, /data-theme="coracle"/);
    assert.match(css, /--brand/);
    host().shadowRoot!.querySelector('.backdrop')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(await answer, false);
    dialog.close();
    theme = 'lacrypta';
    const again = dialog.confirm(DETAILS);
    assert.equal(host().dataset.theme, 'lacrypta', 'read again each time it opens');
    host().shadowRoot!.querySelector('.backdrop')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await again;
    dialog.close();
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
    assert.equal(failed.root()!.querySelector('.copy-box output')!.textContent, DETAILS.chatMessage!.text);
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
    { pubkey: PK, npub: 'npub1alicealicealicealice', displayName: 'Alice', name: 'alice', nip05: 'alice@a.example', nip05Verified: true, lud16: 'alice@wallet.example', picture: null, followed: false, createdAt: 1 },
    { pubkey: 'd'.repeat(64), npub: 'npub1nolightningnolightning', displayName: 'Alice (no LN)', name: null, nip05: 'alice@b.example', nip05Verified: false, lud16: null, picture: null, followed: false, createdAt: 1 },
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
    let options = [...t.root().querySelectorAll('.results button.option')] as HTMLButtonElement[];
    assert.equal(options.length, 1, 'only payable profiles are shown at first');
    assert.match(options[0].textContent!, /✓ alice@a\.example/);
    const more = [...t.root().querySelectorAll('.results button.more')][0] as HTMLButtonElement;
    assert.equal(more.textContent, 'Show 1 without a Lightning Address');
    more.click();
    options = [...t.root().querySelectorAll('.results button.option')] as HTMLButtonElement[];
    assert.equal(options.length, 2);
    assert.match(options[1].textContent!, /not verified/);
    assert.equal(options[1].disabled, true);
    options[0].click();
    assert.equal(input.value, 'alice@wallet.example');
    assert.match(t.root().textContent!, /Selected Alice/);
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    assert.deepEqual(await answer, {
      address: 'alice@wallet.example', remember: 'chat', pubkey: PK,
      nostr: { name: 'Alice', nip05: 'alice@a.example', picture: null },
    });
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
    assert.deepEqual(await answer, {
      address: 'alice@wallet.example', remember: 'global', pubkey: PK,
      nostr: { name: 'Alice', nip05: 'alice@a.example', picture: null },
    });
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

  it('searches as the person types, but never the prefilled text on its own', async () => {
    const t = withSearch(async () => results);
    void t.dialog.link({ contact: { kind: 'contact', id: '1@c.us', name: 'Ana Paula' }, current: null, members: [] });
    const input = t.root().querySelector('#wz-query') as HTMLInputElement;
    await new Promise(r => setTimeout(r, 600));
    assert.deepEqual(t.queries, [], 'prefilled name not searched');
    input.value = 'al';
    input.dispatchEvent(new Event('input'));
    input.value = 'ali';
    input.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 600));
    assert.deepEqual(t.queries, ['ali'], 'one search after the pause, for the latest text');
  });

  it('shows "You follow" and moves through results with the arrow keys', async () => {
    const t = withSearch(async () => [{ ...results[0], followed: true }, { ...results[0], pubkey: 'e'.repeat(64), npub: 'npub1other', displayName: 'Alice 2' }]);
    void t.dialog.askAddress('Alice', null);
    const input = t.root().querySelector('input[type="text"]') as HTMLInputElement;
    input.value = 'alice';
    t.root().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await t.tick();
    const options = [...t.root().querySelectorAll('.results button.option')] as HTMLButtonElement[];
    assert.match(options[0].textContent!, /You follow/);
    assert.match(t.root().textContent!, /People you follow come first/);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(t.root().activeElement, options[0]);
    options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(t.root().activeElement, options[1]);
    options[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    assert.equal(t.root().activeElement, options[0]);
  });

  it('shows the profile picture once fetched, keeping the initial otherwise', async () => {
    const asked: string[] = [];
    const dialog = new ZapDialog({
      shadowMode: 'open', requireTrusted: false,
      search: async () => [{ ...results[0], picture: 'https://img.example/a.png' }, { ...results[0], pubkey: 'f'.repeat(64), picture: 'https://img.example/broken.png' }],
      avatar: async url => { asked.push(url); return url.includes('broken') ? null : 'data:image/png;base64,AAAA'; },
    });
    void dialog.askAddress('Alice', null);
    const root = document.querySelector('[data-whatsapp-zaps]')!.shadowRoot!;
    (root.querySelector('input[type="text"]') as HTMLInputElement).value = 'alice';
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(asked, ['https://img.example/a.png', 'https://img.example/broken.png']);
    const avatars = [...root.querySelectorAll('.results .avatar')];
    assert.equal(avatars[0].querySelector('img')?.getAttribute('src'), 'data:image/png;base64,AAAA');
    assert.equal(avatars[1].querySelector('img'), null);
    assert.equal(avatars[1].textContent, 'A', 'the initial stays');
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
  const PROFILE = { pubkey: PK, npub: 'npub1anaanaanaanaanaana', displayName: 'Ana P', name: 'ana', nip05: 'ana@nostr.example', nip05Verified: true, lud16: 'ana@wallet.example', picture: null, followed: false, createdAt: 1 };
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
      current: { contactKey: 'id:x', mapping: { address: 'ana@wallet.example', displayName: 'Ana Paula', updatedAt: 1, pubkey: PK, nostr: { name: 'Ana P', nip05: 'ana@nostr.example', picture: null } } },
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
      action: 'link', address: 'ana@wallet.example', pubkey: PK, nostr: { name: 'Ana P', nip05: 'ana@nostr.example', picture: null },
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
      action: 'link', address: 'ana@wallet.example', pubkey: PK, nostr: { name: 'Ana P', nip05: 'ana@nostr.example', picture: null },
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
      action: 'link', address: 'ana@wallet.example', memberName: 'Ana from work', pubkey: PK, nostr: { name: 'Ana P', nip05: 'ana@nostr.example', picture: null },
    });
  });

  it('shows notices from the last action', () => {
    const t = make();
    void t.dialog.link({ contact, current: null, members: [] }, { text: 'x@y.example: LNURL: endpoint returned 404', error: true });
    assert.match(t.root().querySelector('.error')!.textContent!, /404/);
  });
});

describe('ZapDialog — the person being paid', () => {
  beforeEach(() => { installDom(); });

  const base = {
    name: 'Ana Paula',
    recipient: { address: 'ana@wallet.example', domain: 'wallet.example', minSats: 1, maxSats: 1000, commentAllowed: 50, description: null },
    amountSats: 21, comment: 'gracias', chatMessage: null, postByDefault: true,
  };
  const PK = 'a'.repeat(64);

  function make(opts: { profile?: (pk: string) => Promise<unknown> } = {}) {
    const asked: string[] = [];
    const dialog = new ZapDialog({
      shadowMode: 'open', requireTrusted: false,
      avatar: async url => { asked.push(url); return `data:image/png;base64,${url.length}`; },
      profile: opts.profile as never,
    });
    const root = () => document.querySelector('[data-whatsapp-zaps]')!.shadowRoot!;
    return { dialog, root, asked };
  }

  it('shows the saved Nostr picture, name, verified NIP-05 and address', async () => {
    const t = make();
    void t.dialog.confirm({ ...base, person: { pubkey: PK, nostr: { name: 'Ana P', nip05: 'ana@nostr.example', picture: 'https://img.example/ana.png' } } });
    await new Promise(r => setTimeout(r, 0));
    const card = t.root().querySelector('.person')!;
    assert.match(card.textContent!, /Ana Paula.*Ana P.*✓ ana@nostr\.example.*⚡ ana@wallet\.example/s);
    assert.deepEqual(t.asked, ['https://img.example/ana.png']);
    assert.ok(card.querySelector('.avatar.lg img'), 'picture shown');
    assert.match(t.root().querySelector('.hero')!.textContent!, /21\s*sats/);
    assert.equal(t.root().querySelector('.bubble')!.textContent, 'gracias', 'the comment as a chat bubble');
  });

  it('fetches the picture of a linked profile that has none saved', async () => {
    const t = make({ profile: async pk => (pk === PK ? { picture: 'https://img.example/fresh.png' } : null) });
    void t.dialog.confirm({ ...base, person: { pubkey: PK, nostr: null } });
    await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(t.asked, ['https://img.example/fresh.png']);
    assert.match(t.root().querySelector('.person')!.textContent!, /Nostr/, 'marked as a Nostr profile');
  });

  it('keeps the person on the waiting and result screens, with a badge', async () => {
    const t = make();
    void t.dialog.confirm({ ...base, person: { pubkey: PK, nostr: { name: null, nip05: null, picture: 'https://img.example/a.png' } } });
    t.dialog.showLoading('Waiting for your wallet…');
    assert.ok(t.root().querySelector('.loading .ring .avatar'));
    assert.match(t.root().querySelector('h2')!.textContent!, /Zap Ana Paula/);
    void t.dialog.showResult({ outcome: 'paid', preimage: 'p' }, { ...base, person: { pubkey: PK, nostr: null } }, null);
    assert.equal(t.root().querySelector('.result .badge.good')!.textContent, '✓');
  });

  it('has a close button in the header while the dialog can be dismissed', async () => {
    const t = make();
    const answer = t.dialog.confirm({ ...base });
    const close = t.root().querySelector('h2 button.close') as HTMLButtonElement;
    assert.equal(close.getAttribute('aria-label'), 'Close');
    assert.ok(t.root().querySelector('h2 svg.brand'), 'the logo');
    close.click();
    assert.equal(await answer, false);
    t.dialog.showLoading('…');
    assert.equal(t.root().querySelector('h2 button.close'), null, 'no close while paying');
  });
});
