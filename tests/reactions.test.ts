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
  let clock: number;
  beforeEach(() => {
    installDom(FIXTURE);
    reacted = [];
    clock = 1000;
    const tracker = installReplyTracker();
    installReactionWatcher(row => reacted.push(row), tracker.lastRow, document, () => true, () => clock);
  });

  it('reports a ⚡ picked right after acting on a message', () => {
    press(rows()[0]);
    press(picker().img, 'click');
    assert.deepEqual(reacted, [rows()[0]]);
  });

  it('ignores ⚡ in the emoji panel used while typing', () => {
    press(rows()[0]);
    const panel = document.createElement('div');
    panel.innerHTML = '<span>⚡</span>';
    document.querySelector('footer')!.append(panel);
    press(panel.querySelector('span')!);
    press(panel.querySelector('span')!, 'click');
    const p = picker();
    press(p.text, 'click');
    assert.deepEqual(reacted, [], 'typing happened after the message was acted on');
  });

  it('ignores an existing ⚡ reaction badge on a message', () => {
    const badge = document.createElement('span');
    badge.textContent = '⚡';
    rows()[0].append(badge);
    press(badge);
    press(badge, 'click');
    assert.deepEqual(reacted, []);
  });

  it('ignores ⚡ without a recent message, or long after', () => {
    press(picker().img, 'click');
    assert.deepEqual(reacted, [], 'no message acted on');
    press(rows()[0]);
    clock += 61_000;
    press(picker().img, 'click');
    assert.deepEqual(reacted, [], 'too long ago');
  });

  it('ignores other reactions', () => {
    press(rows()[0]);
    press(picker().thumbs, 'click');
    assert.deepEqual(reacted, []);
  });
});
