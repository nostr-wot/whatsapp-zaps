import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.ts';
import {
  findComposer, findSendButton, isSendButton, mentionId, readChatContact, readChatId, readChatKey, readChatTitle, readComposerText, readMentions, composerHolds,
} from '../src/whatsapp/dom.ts';
import { parseZapCommand } from '../src/domain/command.ts';

const FIXTURE = readFileSync(new URL('./fixtures/whatsapp-chat.html', import.meta.url), 'utf8');

describe('WhatsApp DOM adapter', () => {
  beforeEach(() => { installDom(FIXTURE); });

  it('finds the composer and reads its text and mentions', () => {
    const composer = findComposer()!;
    assert.ok(composer);
    const text = readComposerText(composer);
    const mentions = readMentions(composer);
    assert.deepEqual(mentions, [{ label: 'Ana Paula', id: '5491100000000@c.us' }]);
    const parsed = parseZapCommand(text, mentions);
    assert.deepEqual(parsed, { ok: true, command: { recipient: { label: 'Ana Paula', id: '5491100000000@c.us' }, amountSats: 1000, comment: 'gracias' } });
  });

  it('joins Lexical paragraphs with newlines', () => {
    const composer = findComposer()!;
    composer.innerHTML = '<p>one</p><p>two</p>';
    assert.equal(readComposerText(composer), 'one\ntwo');
  });

  it('reads the chat title, id and key', () => {
    assert.equal(readChatTitle(), 'Friends & Family');
    assert.equal(readChatId(), '120363000000000000@g.us');
    assert.equal(readChatKey(), 'jid:120363000000000000@g.us');
  });

  it('falls back to a title key in an empty chat', () => {
    for (const row of document.querySelectorAll('[data-id]')) row.remove();
    assert.equal(readChatId(), null);
    assert.equal(readChatKey(), 'title:friends & family');
  });

  it('finds the send button from its icon', () => {
    const button = findSendButton()!;
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(isSendButton(button.querySelector('span')), true);
    assert.equal(isSendButton(findComposer()), false);
  });

  it('only accepts contact ids that look like ids', () => {
    const el = document.createElement('span');
    el.setAttribute('data-app-text-template', '@{{<img src=x>}}');
    assert.equal(mentionId(el), null);
    el.setAttribute('data-jid', '123@c.us');
    assert.equal(mentionId(el), '123@c.us');
  });

  it('compares the box to a text, ignoring invisible marks and spacing', () => {
    const composer = findComposer()!;
    composer.innerHTML = '<p><span>\u2068⚡ Zapped</span>  <span>@Ana\u2069 1 sats</span></p>';
    assert.equal(composerHolds(composer, '⚡ Zapped @Ana 1 sats'), true);
    assert.equal(composerHolds(composer, '⚡ Zapped @Ana 2 sats'), false);
    composer.innerHTML = '<p><br></p>';
    assert.equal(composerHolds(composer, ''), true);
  });

});

describe('readChatContact', () => {
  beforeEach(() => { installDom(FIXTURE); });

  it('reads a group from its chat id', () => {
    assert.deepEqual(readChatContact(), { kind: 'group', chatKey: 'jid:120363000000000000@g.us', title: 'Friends & Family' });
  });

  it('reads a one-to-one contact with its id', () => {
    for (const row of document.querySelectorAll('[data-id]')) row.setAttribute('data-id', 'false_5491100000000@c.us_3EB0AB');
    assert.deepEqual(readChatContact(), { kind: 'contact', id: '5491100000000@c.us', name: 'Friends & Family' });
  });

  it('falls back to a contact known by title in an empty chat', () => {
    for (const row of document.querySelectorAll('[data-id]')) row.remove();
    assert.deepEqual(readChatContact(), { kind: 'contact', id: null, name: 'Friends & Family' });
  });
});
