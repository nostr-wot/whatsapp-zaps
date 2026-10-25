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
