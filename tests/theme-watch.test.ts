import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './helpers/dom.ts';
import { watchTheme, whatsappDark, type ChoiceSource, type DarkSignal, type ThemeView } from '../src/ui/themeWatch.ts';

const tick = () => new Promise(r => setTimeout(r, 0));

/** A stored choice the test controls. */
function source(stored: unknown): ChoiceSource & { change(value: unknown): void } {
  const listeners: Array<(value: unknown) => void> = [];
  return {
    load: async () => stored,
    subscribe: listener => { listeners.push(listener); return () => listeners.splice(listeners.indexOf(listener), 1); },
    change: value => { for (const listener of [...listeners]) listener(value); },
  };
}

function darkness(initial: boolean): DarkSignal & { set(dark: boolean): void } {
  let dark = initial;
  const listeners: Array<() => void> = [];
  return {
    isDark: () => dark,
    subscribe: listener => { listeners.push(listener); return () => {}; },
    set: next => { dark = next; for (const listener of listeners) listener(); },
  };
}

describe('watchTheme', () => {
  it('applies the default, then the stored choice, then each change', async () => {
    const applied: ThemeView[] = [];
    const stored = source({ palette: 'coracle', appearance: 'auto' });
    const dark = darkness(false);
    const watch = watchTheme(stored, dark, view => applied.push(view));
    assert.deepEqual(applied.map(v => v.id), ['light'], 'Nostr WoT Light before storage answers');
    await tick();
    assert.deepEqual(applied.map(v => v.id), ['light', 'coracle-light']);
    dark.set(true);
    assert.equal(watch.current().id, 'coracle');
    stored.change({ palette: 'lacrypta', appearance: 'auto' });
    dark.set(false);
    assert.deepEqual(applied.map(v => v.id), ['light', 'coracle-light', 'coracle', 'lacrypta', 'lacrypta']);
    assert.deepEqual(applied.at(-1), { choice: { palette: 'lacrypta', appearance: 'auto' }, dark: false, id: 'lacrypta' },
      'La Crypta stays dark, but marks on WhatsApp still learn the background changed');
  });

  it('starts from a choice already known, and a change wins over a slow load', async () => {
    const applied: string[] = [];
    const stored = source({ palette: 'yakihonne', appearance: 'dark' });
    watchTheme(stored, darkness(false), view => applied.push(view.id), { palette: 'nostrich', appearance: 'light' });
    stored.change({ palette: 'nostrudel', appearance: 'light' });
    await tick();
    assert.deepEqual(applied, ['nostrich-light', 'nostrudel-light']);
  });

  it('stops listening', () => {
    const applied: string[] = [];
    const stored = source(undefined);
    const watch = watchTheme(stored, darkness(false), view => applied.push(view.id));
    watch.stop();
    stored.change({ palette: 'coracle', appearance: 'dark' });
    assert.deepEqual(applied, ['light']);
  });
});

describe('whatsappDark', () => {
  beforeEach(() => { installDom(); });

  it('follows the dark class WhatsApp puts on <body>', async () => {
    const dark = whatsappDark(document);
    let changes = 0;
    const stop = dark.subscribe(() => { changes++; });
    assert.equal(dark.isDark(), false);
    document.body.classList.add('dark');
    await tick();
    assert.equal(dark.isDark(), true);
    assert.equal(changes, 1);
    stop();
  });
});
