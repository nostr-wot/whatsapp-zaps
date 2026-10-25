import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.ts';
import { installInterceptor, type InterceptedCommand } from '../src/whatsapp/intercept.ts';
import { findComposer, findSendButton } from '../src/whatsapp/dom.ts';

const FIXTURE = readFileSync(new URL('./fixtures/whatsapp-chat.html', import.meta.url), 'utf8');

function setup(busy = false) {
  installDom(FIXTURE);
  const commands: InterceptedCommand[] = [];
  const reachedWhatsApp: string[] = [];
  const composer = findComposer()!;
  const send = findSendButton()!;
  // Stand-ins for WhatsApp's own handlers, which sit on the elements themselves.
  composer.addEventListener('keydown', e => reachedWhatsApp.push(`key:${(e as KeyboardEvent).key}`));
  for (const type of ['pointerdown', 'mousedown', 'click']) send.addEventListener(type, () => reachedWhatsApp.push(type));
  const uninstall = installInterceptor(c => commands.push(c), () => busy);
  const enter = (init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
    composer.querySelector('span')!.dispatchEvent(event);
    return event;
  };
  return { commands, reachedWhatsApp, composer, send, uninstall, enter };
}

describe('installInterceptor', () => {
  beforeEach(() => {});

  it('swallows Enter on a /zap command and hands it over', () => {
    const t = setup();
    const event = t.enter();
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(t.reachedWhatsApp, []);
    assert.equal(t.commands.length, 1);
    assert.match(t.commands[0].text, /^\/zap /);
    assert.deepEqual(t.commands[0].mentions, [{ label: 'Ana Paula', id: '5491100000000@c.us' }]);
  });

  it('lets ordinary messages, Shift+Enter and other keys through', () => {
    const t = setup();
    t.enter({ shiftKey: true });
    t.composer.innerHTML = '<p><span>hello</span></p>';
    t.enter();
    t.composer.querySelector('span')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    assert.deepEqual(t.reachedWhatsApp, ['key:Enter', 'key:Enter', 'key:a']);
    assert.equal(t.commands.length, 0);
  });

  it('swallows the send button press and starts on click', () => {
    const t = setup();
    const icon = t.send.querySelector('span')!;
    for (const type of ['pointerdown', 'mousedown', 'click']) icon.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    assert.deepEqual(t.reachedWhatsApp, []);
    assert.equal(t.commands.length, 1);
  });

  it('still blocks the send but starts nothing while a zap is open', () => {
    const t = setup(true);
    assert.equal(t.enter().defaultPrevented, true);
    assert.deepEqual(t.reachedWhatsApp, []);
    assert.equal(t.commands.length, 0);
  });

  it('uninstalls cleanly', () => {
    const t = setup();
    t.uninstall();
    t.enter();
    assert.deepEqual(t.reachedWhatsApp, ['key:Enter']);
    assert.equal(t.commands.length, 0);
  });
});
