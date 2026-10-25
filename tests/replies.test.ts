import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.ts';
import { readMessageAuthor, replyAuthor } from '../src/whatsapp/dom.ts';
import { installReplyTracker } from '../src/whatsapp/replies.ts';

const FIXTURE = readFileSync(new URL('./fixtures/whatsapp-chat.html', import.meta.url), 'utf8');
const rows = () => [...document.querySelectorAll<HTMLElement>('#main [data-id]')];

/** What WhatsApp shows above the message box while replying. */
function openReply(author: string, text = 'hi') {
  const preview = document.createElement('div');
  preview.id = 'reply';
  preview.innerHTML = `<div><span dir="auto">${author}</span><span>${text}</span></div><div role="button"><span data-icon="x"></span></div>`;
  document.querySelector('footer')!.prepend(preview);
}

describe('message authors', () => {
  beforeEach(() => { installDom(FIXTURE); });

  it('reads the author of a group message from data-id and data-pre-plain-text', () => {
    assert.deepEqual(readMessageAuthor(rows()[0]), { name: 'Ana Paula', id: '5491100000000@c.us', fromMe: false });
    assert.deepEqual(readMessageAuthor(rows()[1]), { name: 'Me', id: null, fromMe: true });
  });

  it('reads @lid authors and survives missing parts', () => {
    const row = document.createElement('div');
    row.setAttribute('data-id', 'false_1@g.us_ABC_123456789@lid');
    assert.deepEqual(readMessageAuthor(row), { name: null, id: '123456789@lid', fromMe: false });
    row.setAttribute('data-id', 'false_5491@c.us_ABC');
    assert.equal(readMessageAuthor(row).id, null, 'one-to-one rows carry no author id');
  });
});

describe('replyAuthor', () => {
  beforeEach(() => { installDom(FIXTURE); });

  it('names the author when the open reply shows them', () => {
    openReply('Ana Paula');
    assert.deepEqual(replyAuthor(rows()[0]), { name: 'Ana Paula', id: '5491100000000@c.us', fromMe: false });
  });

  it('is null when no reply is open, or it shows someone else', () => {
    assert.equal(replyAuthor(rows()[0]), null, 'no reply open');
    openReply('Bob');
    assert.equal(replyAuthor(rows()[0]), null, 'replying to Bob, not to the message last clicked');
    assert.equal(replyAuthor(null), null);
  });

  it('recognises a reply to one’s own message', () => {
    openReply('You', 'hello');
    assert.equal(replyAuthor(rows()[1])?.fromMe, true);
  });
});

describe('installReplyTracker', () => {
  beforeEach(() => { installDom(FIXTURE); });

  it('remembers the message last acted on', () => {
    const tracker = installReplyTracker();
    assert.equal(tracker.lastRow(), null);
    rows()[0].querySelector('span')!.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    assert.equal(tracker.lastRow(), rows()[0]);
    rows()[1].dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    assert.equal(tracker.lastRow(), rows()[1]);
    document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    assert.equal(tracker.lastRow(), rows()[1], 'clicks elsewhere keep it');
    tracker.uninstall();
  });
});

describe('replyAuthor — only the name line counts', () => {
  beforeEach(() => { installDom(FIXTURE); });

  it('does not take a name inside the quoted text for the author', () => {
    openReply('Bob', 'Ana Paula is great');
    assert.equal(replyAuthor(rows()[0]), null);
  });
});

describe('findReplyTarget — from what the reply box shows', () => {
  beforeEach(() => { installDom(FIXTURE); });

  const addRow = (dataId: string, author: string, text: string) => {
    const wrap = document.createElement('div');
    wrap.setAttribute('role', 'row');
    wrap.innerHTML = `<div data-id="${dataId}"><div class="copyable-text" data-pre-plain-text="[11:00, 25/10/2026] ${author}: "><span>${text}</span></div></div>`;
    document.querySelector('.copyable-area')!.append(wrap);
    return wrap.firstElementChild as HTMLElement;
  };

  it('finds the message without any click on it (reply opened from a button outside the message)', async () => {
    const { findReplyTarget } = await import('../src/whatsapp/dom.ts');
    const row = addRow('false_120363000000000000@g.us_C1_5491177@c.us', 'Fierillo', 'bitcoin fixes this');
    openReply('Fierillo', 'bitcoin fixes this');
    assert.equal(findReplyTarget(null)?.row, row);
    assert.deepEqual(replyAuthor(null), { name: 'Fierillo', id: '5491177@c.us', fromMe: false });
  });

  it('matches a quote that WhatsApp cut short, and the latest of equal messages', async () => {
    const { findReplyTarget } = await import('../src/whatsapp/dom.ts');
    addRow('false_120363000000000000@g.us_C1_1111111@c.us', 'Bob', 'gm everyone, have a great day');
    const latest = addRow('false_120363000000000000@g.us_C2_2222222@c.us', 'Bea', 'gm everyone, have a great day');
    openReply('Bea', 'gm everyone, have a gre');
    assert.equal(findReplyTarget(null)?.row, latest);
  });

  it('prefers the message whose author the box names', async () => {
    const { findReplyTarget } = await import('../src/whatsapp/dom.ts');
    const bob = addRow('false_120363000000000000@g.us_C1_1111111@c.us', 'Bob', 'same words');
    addRow('false_120363000000000000@g.us_C2_2222222@c.us', 'Bea', 'same words');
    openReply('Bob', 'same words');
    assert.equal(findReplyTarget(null)?.row, bob);
  });

  it('accepts names shown differently: "~ name", phone numbers with spaces', async () => {
    const { findReplyTarget } = await import('../src/whatsapp/dom.ts');
    const row = addRow('false_120363000000000000@g.us_C1_5491177@c.us', '+54 9 11 7777-1111', 'hola');
    openReply('+5491177771111', 'hola');
    assert.equal(findReplyTarget(row)?.row, row);
    const tilde = addRow('false_120363000000000000@g.us_C3_5491188@c.us', 'Pepe', 'que tal');
    document.getElementById('reply')!.remove();
    openReply('~ Pepe', 'que tal');
    assert.equal(findReplyTarget(null)?.row, tilde);
  });

  it('is null when nothing on screen fits', async () => {
    const { findReplyTarget } = await import('../src/whatsapp/dom.ts');
    openReply('Zed', 'a message scrolled out of view');
    assert.equal(findReplyTarget(null), null);
  });
});

describe('findReplyTarget — short messages', () => {
  beforeEach(() => { installDom(FIXTURE); });
  it('matches a short message quoted in full, without a click', async () => {
    const { findReplyTarget } = await import('../src/whatsapp/dom.ts');
    openReply('Ana Paula', 'hi');
    assert.equal(findReplyTarget(null)?.row, rows()[0]);
  });
});

describe('messageRowOf — next to the bubble', () => {
  beforeEach(() => { installDom(FIXTURE); });
  it('maps something in the same chat row to its message', async () => {
    const { messageRowOf } = await import('../src/whatsapp/dom.ts');
    const button = document.createElement('span');
    rows()[0].parentElement!.append(button);
    assert.equal(messageRowOf(button), rows()[0]);
    assert.equal(messageRowOf(document.body), null);
  });
});

describe('reply box and group header, without ids on the page', () => {
  beforeEach(() => { installDom(FIXTURE); });

  it('finds the reply box drawn above the footer, not inside it', async () => {
    const { findReplyTarget } = await import('../src/whatsapp/dom.ts');
    const box = document.createElement('div');
    box.innerHTML = '<div><span>Ana Paula</span><span>hi</span></div><span data-icon="x"></span>';
    document.querySelector('footer')!.before(box);
    assert.equal(findReplyTarget(null)?.row, rows()[0]);
  });

  it('tells a group from its header when no message carries the group id (the screenshot case)', async () => {
    const { headerLooksLikeGroup, readChatContact } = await import('../src/whatsapp/dom.ts');
    for (const row of rows()) row.removeAttribute('data-id');
    const header = document.querySelector('#main header')!;
    assert.equal(headerLooksLikeGroup(), false);
    assert.equal(readChatContact()?.kind, 'contact');
    const subtitle = document.createElement('span');
    subtitle.setAttribute('title', 'Analia Acosta, Bob, You');
    subtitle.textContent = 'Analia Acosta, Bob, You';
    header.append(subtitle);
    assert.equal(headerLooksLikeGroup(), true);
    assert.deepEqual(readChatContact(), { kind: 'group', chatKey: 'title:friends & family', title: 'Friends & Family' });
    subtitle.textContent = 'click here for group info';
    subtitle.removeAttribute('title');
    assert.equal(headerLooksLikeGroup(), true);
  });

  it('does not take a private chat’s "online" or "last seen" for a group', async () => {
    const { headerLooksLikeGroup } = await import('../src/whatsapp/dom.ts');
    const subtitle = document.createElement('span');
    subtitle.textContent = 'last seen today at 10:30';
    document.querySelector('#main header')!.append(subtitle);
    assert.equal(headerLooksLikeGroup(), false);
  });
});
