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
    assert.deepEqual(parsed, { ok: true, command: { recipient: { label: 'Ana Paula', id: '5491100000000@c.us' }, recipientPicked: true, amountSats: 1000, comment: 'gracias' } });
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

describe('mentions in the message box and the mention list', () => {
  beforeEach(() => { installDom(FIXTURE); });

  it('finds the mention element by contact id, else by name', async () => {
    const { findMentionElement } = await import('../src/whatsapp/dom.ts');
    const composer = findComposer()!;
    assert.equal(findMentionElement(composer, { label: 'Someone else', id: '5491100000000@c.us' })?.textContent, '⁨@Ana Paula⁩');
    assert.ok(findMentionElement(composer, { label: 'Ana Paula', id: null }));
    assert.equal(findMentionElement(composer, { label: 'Bob', id: null }), null);
  });

  it('picks a list entry only when exactly one person fits', async () => {
    const { findMentionOption } = await import('../src/whatsapp/dom.ts');
    const list = document.createElement('div');
    list.setAttribute('role', 'listbox');
    list.innerHTML = ['Bob', 'Bea', 'Bea Smith', 'Jaqui'].map(n => `<div role="option">${n}</div>`).join('')
      + '<div role="option" data-jid="77@c.us">Mystery</div>';
    document.querySelector('#main')!.append(list);
    assert.equal(findMentionOption({ label: 'Jaqui', id: null })?.textContent, 'Jaqui');
    assert.equal(findMentionOption({ label: 'bob', id: null })?.textContent, 'Bob');
    assert.equal(findMentionOption({ label: 'Bea', id: null })?.textContent, 'Bea', 'an exact name wins');
    assert.equal(findMentionOption({ label: 'Be', id: null }), null, 'two people start with "Be": no guess');
    assert.equal(findMentionOption({ label: 'Carl', id: null }), null);
    assert.equal(findMentionOption({ label: 'Whoever', id: '77@c.us' })?.textContent, 'Mystery', 'the contact id wins');
  });
});

describe('mentions without known markup', () => {
  beforeEach(() => { installDom(FIXTURE); });

  it('recognises a mention as a piece of its own holding "@Name", and finds its id anywhere', async () => {
    const { mentionElements, readMentions } = await import('../src/whatsapp/dom.ts');
    const composer = findComposer()!;
    composer.innerHTML = '<p><span data-lexical-text="true">/zap </span>'
      + '<span class="_ao3e x1x" data-lexical-text="true" data-ref="u:5491177@c.us"><span>@Jaqui</span></span>'
      + '<span data-lexical-text="true"> 21 thanks @not-a-mention</span></p>';
    assert.equal(mentionElements(composer).length, 1);
    assert.deepEqual(readMentions(composer), [{ label: 'Jaqui', id: '5491177@c.us' }]);
  });

  it('does not take typed "@name" text for a mention', async () => {
    const { mentionElements } = await import('../src/whatsapp/dom.ts');
    const composer = findComposer()!;
    composer.innerHTML = '<p><span data-lexical-text="true">@Jaqui</span></p>';
    assert.deepEqual(mentionElements(composer), []);
  });

  it('finds the list entry among what appeared after typing, when only one fits', async () => {
    const { findMentionOption } = await import('../src/whatsapp/dom.ts');
    const popup = document.createElement('div');
    popup.innerHTML = '<div tabindex="-1"><span>Jaqui</span><span>+54 9 11</span></div><div tabindex="-1"><span>Jaime</span></div>';
    document.body.append(popup);
    const entry = findMentionOption({ label: 'Jaqui', id: null }, document, [popup]);
    assert.equal(entry?.getAttribute('tabindex'), '-1');
    assert.match(entry!.textContent!, /^Jaqui/);
    assert.equal(findMentionOption({ label: 'Ja', id: null }, document, [popup]), null, 'two people: no guess');
    assert.equal(findMentionOption({ label: 'Jaqui', id: null }, document, []), null, 'nothing appeared: nothing picked');
  });
});
