import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.ts';
import {
  HOOK_STATUS_EVENT, REACTION_EVENT, installReactionHook, isHookStatusEvent, isReactionZapEvent, reactionToZap, serialize, wrapBulkUpsert,
} from '../src/content/reactionHook.ts';

const FIXTURE = readFileSync(new URL('./fixtures/whatsapp-chat.html', import.meta.url), 'utf8');
const NOW = 1_800_000_000_000;

/** A reaction as WhatsApp stores it (shape from whatsapp-web.js's message_reaction). */
function reaction(over: Record<string, unknown> = {}) {
  return {
    id: { fromMe: true, _serialized: 'true_120363@g.us_R1' },
    reactionText: '⚡',
    reactionTimestamp: NOW - 1_000,
    reactionParentKey: {
      fromMe: false,
      remote: { _serialized: '120363000000000000@g.us' },
      participant: { _serialized: '5491177@c.us' },
      _serialized: 'false_120363000000000000@g.us_3EB0AA_5491177@c.us',
    },
    ...over,
  };
}
const ctx = { now: NOW, gestureAt: NOW - 2_000, contactName: (id: string) => (id === '5491177@c.us' ? 'Fierillo' : null) };

describe('reactionToZap', () => {
  it('turns the person’s own fresh ⚡ into a zap for the message’s author', () => {
    assert.deepEqual(reactionToZap(reaction(), ctx), {
      type: REACTION_EVENT,
      messageId: 'false_120363000000000000@g.us_3EB0AA_5491177@c.us',
      chatId: '120363000000000000@g.us',
      authorId: '5491177@c.us',
      authorName: 'Fierillo',
      parentFromMe: false,
    });
  });

  it('accepts ⚡ with the emoji variation mark, and minified ids', () => {
    const z = reactionToZap(reaction({
      reactionText: '⚡️',
      reactionParentKey: { fromMe: false, remote: { $1: '5491100@c.us' }, $1: 'false_5491100@c.us_3EB0BB' },
    }), ctx);
    assert.equal(z?.messageId, 'false_5491100@c.us_3EB0BB');
    assert.equal(z?.authorId, '5491100@c.us', 'a private chat’s author is the chat');
  });

  it('ignores other emoji, removals, other people’s reactions, old ones and ones without a recent gesture', () => {
    assert.equal(reactionToZap(reaction({ reactionText: '👍' }), ctx), null);
    assert.equal(reactionToZap(reaction({ reactionText: '' }), ctx), null, 'a removed reaction');
    assert.equal(reactionToZap(reaction({ id: { fromMe: false } }), ctx), null, 'someone else reacted');
    assert.equal(reactionToZap(reaction({ reactionTimestamp: NOW - 10 * 60_000 }), ctx), null, 'synced history');
    assert.equal(reactionToZap(reaction(), { ...ctx, gestureAt: NOW - 60_000 }), null, 'made on the phone');
    assert.equal(reactionToZap(reaction({ reactionParentKey: undefined }), ctx), null);
  });

  it('accepts timestamps in seconds', () => {
    assert.ok(reactionToZap(reaction({ reactionTimestamp: Math.floor((NOW - 1_000) / 1000) }), ctx));
  });

  it('without a fromMe flag, recognises the person by their own ids', () => {
    const noFlag = { id: { _serialized: 'x' }, author: { _serialized: '111@lid' } };
    assert.ok(reactionToZap(reaction(noFlag), { ...ctx, meIds: () => ['5490000@c.us', '111@lid'] }));
    assert.equal(reactionToZap(reaction(noFlag), { ...ctx, meIds: () => ['5490000@c.us'] }), null, 'someone else');
    assert.equal(reactionToZap(reaction({ id: { fromMe: false }, author: { _serialized: '111@lid' } }), { ...ctx, meIds: () => ['111@lid'] }), null, 'an explicit fromMe:false wins');
  });

  it('marks reactions to one’s own messages', () => {
    const z = reactionToZap(reaction({ reactionParentKey: { fromMe: true, remote: '1@g.us', _serialized: 'true_1@g.us_X' } }), ctx);
    assert.equal(z?.parentFromMe, true);
    assert.equal(z?.authorId, null);
  });

  it('serializes ids in their different shapes', () => {
    assert.equal(serialize('a@c.us'), 'a@c.us');
    assert.equal(serialize({ _serialized: 'b@c.us' }), 'b@c.us');
    assert.equal(serialize({ $1: 'c@c.us' }), 'c@c.us');
    assert.equal(serialize(null), null);
  });
});

describe('wrapBulkUpsert', () => {
  it('runs WhatsApp’s function first and returns its result, even if observing throws', () => {
    const calls: string[] = [];
    const table = { bulkUpsert(rows: unknown[]) { calls.push(`original:${rows.length}`); return 'stored'; } };
    assert.equal(wrapBulkUpsert(table, () => { calls.push('observe'); throw new Error('boom'); }), true);
    assert.equal(table.bulkUpsert([1, 2]), 'stored');
    assert.deepEqual(calls, ['original:2', 'observe']);
  });

  it('does not wrap twice', () => {
    const table = { bulkUpsert() { return 1; } };
    assert.equal(wrapBulkUpsert(table, () => {}), true);
    assert.equal(wrapBulkUpsert(table, () => {}), false);
  });
});

describe('installReactionHook', () => {
  beforeEach(() => { installDom(FIXTURE); });

  function fakeWhatsApp() {
    const table = { stored: [] as unknown[], bulkUpsert(rows: unknown[]) { this.stored.push(...rows); return true; } };
    const contacts = new Map([['5491177@c.us', { name: 'Fierillo' }]]);
    const modules: Record<string, unknown> = {
      WAWebAddonReactionTableMode: { reactionTableMode: table },
      WAWebCollections: { Contact: { get: (id: string) => contacts.get(id) } },
    };
    const require = (name: string) => { if (!(name in modules)) throw new Error(`Requiring unknown module "${name}"`); return modules[name]; };
    return { table, require };
  }

  it('hooks once WhatsApp’s module is there and reports the person’s ⚡', async () => {
    const posted: Array<Record<string, unknown>> = [];
    const wa = fakeWhatsApp();
    const win = window as unknown as Window & { require?: (n: string) => unknown };
    win.require = wa.require;
    let clock = NOW;
    const stop = installReactionHook(win, m => posted.push(m as unknown as Record<string, unknown>), { intervalMs: 5, now: () => clock });
    assert.equal(posted.length, 1);
    assert.deepEqual(posted[0], { type: HOOK_STATUS_EVENT, ok: true, detail: 'listening to WhatsApp’s reactions' });
    window.dispatchEvent(new window.MouseEvent('pointerdown'));
    clock += 500;
    wa.table.bulkUpsert([reaction({ reactionTimestamp: clock }), reaction({ reactionText: '👍' })]);
    assert.equal(wa.table.stored.length, 2, 'WhatsApp stored both, unchanged');
    assert.equal(posted.length, 2);
    assert.equal(posted[1].authorName, 'Fierillo');
    stop();
  });

  it('waits for an open chat, then for the module, and says so when it gives up', async () => {
    const posted: Array<{ ok?: boolean; detail?: string }> = [];
    const wait = () => new Promise(r => setTimeout(r, 20));
    document.getElementById('main')!.id = 'not-main';
    const win = window as unknown as Window & { require?: (n: string) => unknown };
    win.require = () => { throw new Error('Requiring unknown module "WAWebAddonReactionTableMode"'); };
    let clock = 0;
    const stop = installReactionHook(win, m => posted.push(m as { ok?: boolean; detail?: string }), { intervalMs: 5, giveUpMs: 100, now: () => clock });
    await wait();
    assert.equal(posted.length, 0, 'nothing until a chat is open');
    document.getElementById('not-main')!.id = 'main';
    await wait();
    assert.equal(posted.length, 0, 'still trying');
    clock = 200;
    await wait();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].ok, false);
    assert.match(posted[0].detail!, /Requiring unknown module/);
    stop();
  });
});

describe('page event validation', () => {
  it('accepts well-formed events only', () => {
    const ok = { type: REACTION_EVENT, messageId: 'false_1@g.us_A_2@c.us', chatId: '1@g.us', authorId: '2@c.us', authorName: 'A', parentFromMe: false };
    assert.equal(isReactionZapEvent(ok), true);
    assert.equal(isReactionZapEvent({ ...ok, messageId: '' }), false);
    assert.equal(isReactionZapEvent({ ...ok, authorName: 5 }), false);
    assert.equal(isReactionZapEvent({ ...ok, parentFromMe: 'no' }), false);
    assert.equal(isHookStatusEvent({ type: HOOK_STATUS_EVENT, ok: true, detail: 'x' }), true);
    assert.equal(isHookStatusEvent({ type: HOOK_STATUS_EVENT, ok: 'yes', detail: 'x' }), false);
  });
});
