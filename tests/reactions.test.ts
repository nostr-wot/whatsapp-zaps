import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.ts';
import { installReactionWatcher, isLightningEmoji } from '../src/whatsapp/reactions.ts';
import { installReplyTracker } from '../src/whatsapp/replies.ts';

const FIXTURE = readFileSync(new URL('./fixtures/whatsapp-chat.html', import.meta.url), 'utf8');
const rows = () => [...document.querySelectorAll<HTMLElement>('#main [data-id]')];
const press = (el: Element, type = 'pointerdown') => el.dispatchEvent(new window.MouseEvent(type, { bubbles: true }));

/** A reaction picker, rendered outside the message as WhatsApp's floats over the chat. */
function picker(): Record<string, HTMLElement> {
  const p = document.createElement('div');
  p.innerHTML = '<div><span>👍</span></div><div role="button"><img alt="⚡" src="data:,"></div><div><span>⚡️</span></div>';
  document.body.append(p);
  return { thumbs: p.querySelector('span')!, img: p.querySelector('img')!, text: p.querySelectorAll('span')[1] as HTMLElement };
}

describe('isLightningEmoji', () => {
  beforeEach(() => { installDom(FIXTURE); });
  it('recognises ⚡ as text, with or without the emoji variation mark, or as an image', () => {
    const p = picker();
    assert.equal(isLightningEmoji(p.img), true);
    assert.equal(isLightningEmoji(p.text), true);
    assert.equal(isLightningEmoji(p.thumbs), false);
  });
  it('does not take ⚡ inside other text for the emoji', () => {
    const span = document.createElement('span');
    span.textContent = '⚡ Zapped you 21 sats';
    document.body.append(span);
    assert.equal(isLightningEmoji(span), false);
  });
});

describe('installReactionWatcher', () => {
  let reacted: HTMLElement[];
  let missed: string[];
  let clock: number;
  const wait = (ms = 80) => new Promise(r => setTimeout(r, ms));
  /** WhatsApp marks the message reacted to with a ⚡ badge. */
  const badge = (row: HTMLElement) => { const b = document.createElement('span'); b.innerHTML = '<img alt="⚡" src="data:,">'; row.append(b); };

  beforeEach(() => {
    installDom(FIXTURE);
    reacted = [];
    missed = [];
    clock = 1000;
    const tracker = installReplyTracker();
    installReactionWatcher(row => reacted.push(row), tracker.lastRow, document, () => true, () => clock, m => missed.push(m.reason), 40);
  });

  it('takes the message from the ⚡ badge WhatsApp adds, wherever the picker was opened', async () => {
    press(picker().img, 'click');
    badge(rows()[1]);
    await wait();
    assert.deepEqual(reacted, [rows()[1]]);
  });

  it('falls back to the message last acted on when no badge appears', async () => {
    press(rows()[0]);
    press(picker().img, 'click');
    await wait();
    assert.deepEqual(reacted, [rows()[0]]);
  });

  it('works when the picker reacts on press and closes before any click', async () => {
    const p = picker();
    press(p.text, 'mousedown');
    p.text.closest('div')!.parentElement!.remove();
    badge(rows()[0]);
    await wait();
    assert.deepEqual(reacted, [rows()[0]]);
  });

  it('acts once per gesture (pointerdown, mousedown and click)', async () => {
    const p = picker();
    for (const type of ['pointerdown', 'mousedown', 'click']) press(p.img, type);
    badge(rows()[0]);
    await wait();
    assert.equal(reacted.length, 1);
  });

  it('a second press soon after is a new reaction, not part of the first', async () => {
    const p = picker();
    press(p.img, 'pointerdown');
    badge(rows()[0]);
    await wait();
    press(p.img, 'pointerdown');
    badge(rows()[1]);
    await wait();
    assert.deepEqual(reacted, [rows()[0], rows()[1]]);
  });

  it('recognises ⚡ by its name in a label', async () => {
    const b = document.createElement('div');
    b.setAttribute('role', 'button');
    b.setAttribute('aria-label', 'High voltage');
    document.body.append(b);
    press(b, 'click');
    badge(rows()[0]);
    await wait();
    assert.deepEqual(reacted, [rows()[0]]);
  });

  it('a badge counts even after typing, and with no message clicked (the reported case)', async () => {
    const typed = document.querySelector('footer [contenteditable="true"]')!;
    press(typed);
    press(picker().img, 'click');
    badge(rows()[0]);
    await wait();
    assert.deepEqual(reacted, [rows()[0]]);
  });

  it('ignores ⚡ in the emoji panel used while typing', async () => {
    press(rows()[0]);
    const panel = document.createElement('div');
    panel.innerHTML = '<span>⚡</span>';
    document.querySelector('footer')!.append(panel);
    press(panel.querySelector('span')!);
    press(panel.querySelector('span')!, 'click');
    await wait();
    press(picker().text, 'click');
    await wait();
    assert.deepEqual(reacted, [], 'typing happened after the message was acted on');
    assert.ok(missed.includes('no badge, and typing happened since the message was acted on'));
  });

  it('ignores an existing ⚡ reaction badge on a message', async () => {
    const b = document.createElement('span');
    b.textContent = '⚡';
    rows()[0].append(b);
    press(b);
    press(b, 'click');
    await wait();
    assert.deepEqual(reacted, []);
  });

  it('records a ⚡ it cannot tie to a message', async () => {
    press(picker().img, 'click');
    await wait();
    assert.deepEqual(reacted, []);
    assert.deepEqual(missed, ['no badge, and no message acted on']);
    press(rows()[0]);
    clock += 61_000;
    press(picker().img, 'click');
    await wait();
    assert.deepEqual(reacted, [], 'too long ago');
    assert.equal(missed.length, 2);
  });

  it('ignores other reactions', async () => {
    press(rows()[0]);
    press(picker().thumbs, 'click');
    const b = document.createElement('span');
    b.textContent = '👍';
    rows()[0].append(b);
    await wait();
    assert.deepEqual(reacted, []);
  });

  it('takes a new ⚡ badge right after a click as the reaction, even when the ⚡ press was not recognised', async () => {
    // A picker that draws emoji as sprites, with nothing naming them.
    const sprite = document.createElement('div');
    sprite.innerHTML = '<span class="emoji-sprite" style="background-position: -40px -80px"></span>';
    document.body.append(sprite);
    press(sprite.firstElementChild!);
    badge(rows()[0]);
    await wait();
    assert.deepEqual(reacted, [rows()[0]]);
  });

  it('a ⚡ badge counts only on a message that was on screen, and did not already have one', async () => {
    badge(rows()[1]);
    press(document.body);
    // Scrolling brings in a message that already carries ⚡.
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div data-id="false_120363000000000000@g.us_OLD_1@c.us"><div data-pre-plain-text="[9:00, 1/1/2026] Old: "><span>old</span></div><span><img alt="⚡" src="data:,"></span></div>';
    document.querySelector('.copyable-area')!.append(wrap);
    // Re-rendering an existing badge does not add one.
    rows()[1].querySelector('img')!.replaceWith(Object.assign(document.createElement('img'), { alt: '⚡' }));
    await wait();
    assert.deepEqual(reacted, []);
  });

  it('a ⚡ in the message text is not a badge, nor is one long after the click', async () => {
    press(document.body);
    const text = rows()[0].querySelector('[data-pre-plain-text]')!;
    text.append(Object.assign(document.createElement('img'), { alt: '⚡' }));
    await wait();
    assert.deepEqual(reacted, []);
    clock += 5_000;
    badge(rows()[0]);
    await wait();
    assert.deepEqual(reacted, [], 'too long after the click');
  });
});
