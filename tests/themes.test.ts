import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_THEME, PALETTES, THEMES, TOPO_LAYER_1, hasAppearance, markColor, parseThemeChoice, resolveTheme, themeCss, themeVars, topoCss,
  type ThemeId,
} from '../src/ui/themes.ts';

const ids = Object.keys(THEMES) as ThemeId[];

describe('Nostr WoT themes', () => {
  it('has Nostr WoT’s palettes, light and dark, each complete', () => {
    assert.deepEqual(ids.sort(), [
      'coracle', 'coracle-light', 'dark', 'lacrypta', 'light', 'nostrich', 'nostrich-light', 'nostrudel', 'nostrudel-light', 'yakihonne', 'yakihonne-light',
    ]);
    for (const id of ids) {
      for (const [key, value] of Object.entries(THEMES[id])) {
        if (key === 'dark') continue;
        assert.ok(typeof value === 'string' && value.length > 0, `${id}.${key}`);
      }
      assert.equal(THEMES[id].dark, !(id === 'light' || id.endsWith('-light')), `${id} is ${THEMES[id].dark ? 'dark' : 'light'}`);
    }
  });

  it('keeps Nostr WoT’s values', () => {
    assert.equal(THEMES.light.bgPage, 'linear-gradient(45deg, #ffffff, #eeeffd)');
    assert.equal(THEMES.light.brand, '#6366f1');
    assert.equal(THEMES.dark.bgPage, '#030712');
    assert.equal(THEMES.dark.brand, '#818cf8');
    assert.equal(THEMES.lacrypta.bgPage, 'linear-gradient(45deg, #090908, #171710)');
    assert.equal(THEMES.lacrypta.brand, '#c7ff5b');
    assert.equal(THEMES.coracle.brand, '#fc560e');
    assert.equal(THEMES['nostrudel-light'].brand, '#88b220');
    assert.equal(THEMES.yakihonne.bgPage, '#000000');
    // The zap colour is the brand colour, except Nostrich’s amber.
    for (const id of ids) if (!id.startsWith('nostrich')) assert.equal(THEMES[id].zap, THEMES[id].brand, id);
    assert.equal(THEMES.nostrich.zap, '#ffb020');
    assert.equal(THEMES['nostrich-light'].zap, '#e08a00');
    // Dark palettes start from Nostr WoT's dark base; light ones from its light palette.
    assert.equal(THEMES.nostrudel.success, '#6ee7b7');
    assert.equal(THEMES['nostrudel-light'].success, '#059669');
  });

  it('reads a stored choice, falling back to Nostr WoT, automatic', () => {
    assert.deepEqual(DEFAULT_THEME, { palette: 'nostr-wot', appearance: 'auto' });
    assert.deepEqual(parseThemeChoice(undefined), DEFAULT_THEME);
    assert.deepEqual(parseThemeChoice('dark'), DEFAULT_THEME);
    assert.deepEqual(parseThemeChoice({ palette: 'coracle', appearance: 'light' }), { palette: 'coracle', appearance: 'light' });
    assert.deepEqual(parseThemeChoice({ palette: 'myspace', appearance: 'neon' }), DEFAULT_THEME);
  });

  it('resolves a choice to a palette, as Nostr WoT does', () => {
    assert.equal(resolveTheme({ palette: 'nostr-wot', appearance: 'auto' }, false), 'light');
    assert.equal(resolveTheme({ palette: 'nostr-wot', appearance: 'auto' }, true), 'dark');
    assert.equal(resolveTheme({ palette: 'nostr-wot', appearance: 'dark' }, false), 'dark');
    assert.equal(resolveTheme({ palette: 'coracle', appearance: 'light' }, true), 'coracle-light');
    assert.equal(resolveTheme({ palette: 'coracle', appearance: 'auto' }, true), 'coracle');
    assert.equal(resolveTheme({ palette: 'nostrich', appearance: 'auto' }, false), 'nostrich-light');
    // La Crypta has one palette.
    assert.equal(hasAppearance('lacrypta'), false);
    assert.equal(resolveTheme({ palette: 'lacrypta', appearance: 'light' }, false), 'lacrypta');
    for (const palette of PALETTES) for (const dark of [false, true]) {
      assert.ok(resolveTheme({ palette: palette.id, appearance: 'auto' }, dark) in THEMES);
    }
  });

  it('picks a mark colour that reads on WhatsApp’s own background', () => {
    assert.equal(markColor('nostr-wot', false), '#6366f1');
    assert.equal(markColor('nostr-wot', true), '#818cf8');
    assert.equal(markColor('coracle', false), '#fc560e');
    assert.equal(markColor('nostrich', true), '#ffb020');
    // La Crypta's lime is darkened on WhatsApp's light theme.
    assert.equal(markColor('lacrypta', false), 'color-mix(in srgb, #c7ff5b 50%, #000000)');
    assert.equal(markColor('lacrypta', true), '#c7ff5b');
  });

  it('writes CSS custom properties under Nostr WoT’s names', () => {
    const vars = themeVars(THEMES.coracle);
    assert.match(vars, /^color-scheme: dark;/);
    assert.match(vars, /--bg-page: #262626;/);
    assert.match(vars, /--text-on-brand: #171717;/);
    assert.match(vars, /--focus-ring: 0 0 0 3px rgba\(252,86,14,\.4\);/);
    const css = themeCss(id => `:host([data-theme="${id}"])`);
    assert.equal(css.split('\n').length, ids.length);
    assert.match(css, /:host\(\[data-theme="yakihonne-light"\]\) \{ color-scheme: light;/);
  });

  it('draws Nostr WoT’s topographic background in the brand colour', () => {
    const css = topoCss('body', 'fixed');
    assert.match(css, /body::before, body::after \{[^}]*position: fixed;[^}]*background: var\(--brand\)/);
    assert.ok(css.includes(TOPO_LAYER_1));
    assert.match(decodeURIComponent(TOPO_LAYER_1), /<ellipse cx='120' cy='120' rx='70' ry='55' stroke='rgba\(0,0,0,0.09\)'\/>/);
    assert.match(css, /prefers-reduced-motion: reduce/);
  });
});
