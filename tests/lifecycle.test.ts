import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.ts';
import { INSTANCE_ATTR, claimPage, isExtensionAlive, lifecycleState } from '../src/content/lifecycle.ts';
import { installInterceptor } from '../src/whatsapp/intercept.ts';
import { findComposer } from '../src/whatsapp/dom.ts';

const FIXTURE = readFileSync(new URL('./fixtures/whatsapp-chat.html', import.meta.url), 'utf8');

describe('isExtensionAlive', () => {
  it('needs both the runtime id and storage', () => {
    assert.equal(isExtensionAlive({ runtime: { id: 'x' }, storage: { local: {} } }), true);
    assert.equal(isExtensionAlive({ runtime: { id: 'x' } }), false, 'storage gone: "reading \'local\'" territory');
    assert.equal(isExtensionAlive({ runtime: {}, storage: { local: {} } }), false);
    assert.equal(isExtensionAlive(undefined), false);
    const throwing = { get runtime(): never { throw new Error('Extension context invalidated.'); } };
    assert.equal(isExtensionAlive(throwing), false);
  });
});

describe('lifecycleState', () => {
  beforeEach(() => { installDom(FIXTURE); });

  it('is active while alive, replaced when a newer copy claimed the page, orphaned when alone', () => {
    claimPage(document, 'old');
    assert.equal(lifecycleState(document, 'old', true), 'active');
    assert.equal(lifecycleState(document, 'old', false), 'orphaned');
    claimPage(document, 'new');
    assert.equal(document.documentElement.getAttribute(INSTANCE_ATTR), 'new');
    assert.equal(lifecycleState(document, 'old', false), 'replaced');
  });
});

describe('two copies on one page', () => {
  beforeEach(() => { installDom(FIXTURE); });

  it('an old copy that steps aside lets the new copy take the /zap', () => {
    const handledBy: string[] = [];
    let oldIsCurrent = true;
    installInterceptor(() => handledBy.push('old'), () => false, document, () => oldIsCurrent);
    installInterceptor(() => handledBy.push('new'), () => false, document, () => true);
    const enter = () => findComposer()!.querySelector('span')!.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    enter();
    assert.deepEqual(handledBy, ['old'], 'while current, the first copy handles it and stops it');
    oldIsCurrent = false;
    enter();
    assert.deepEqual(handledBy, ['old', 'new'], 'once replaced, the event reaches the new copy');
  });
});
