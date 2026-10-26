/**
 * Nostr WoT's themes, so WhatZaps looks like the wallet it pays through.
 *
 * The values are Nostr WoT's (src/styles/theme.css, GPL-3.0-only): its light
 * palette, its dark palettes and its opt-in palettes for Nostr clients (La
 * Crypta, Coracle, noStrudel, YakiHonne, Nostrich), with their light variants.
 * The model is Nostr WoT's too: a palette plus an appearance (light, dark or
 * automatic). La Crypta has one palette and ignores the appearance. Only the
 * tokens WhatZaps uses are kept, under Nostr WoT's names.
 */

export interface Theme {
  dark: boolean;
  bgPage: string; bgPageSolid: string; bgHtml: string; bgElevated: string;
  surfaceGlass: string; surfaceGlassHeavy: string; surfaceHover: string;
  cardBg: string; cardBorder: string; cardActive: string; inputBg: string; controlBorder: string; divider: string;
  textHeading: string; textBody: string; textSecondary: string; textMuted: string;
  brand: string; brandHover: string; brandLight: string; textOnBrand: string;
  brandTintHover: string; brandTintActive: string; buttonSecondaryHover: string;
  success: string; successStrong: string; successTint: string;
  error: string; errorTint: string;
  warning: string; warningStrong: string; warningTint: string;
  info: string; zap: string;
  focusRing: string; scrim: string; shadowCard: string; shadowModal: string;
}

/** CSS custom property for each token: Nostr WoT's names. */
const CSS_NAMES: Record<Exclude<keyof Theme, 'dark'>, string> = {
  bgPage: '--bg-page', bgPageSolid: '--bg-page-solid', bgHtml: '--bg-html', bgElevated: '--bg-elevated',
  surfaceGlass: '--surface-glass', surfaceGlassHeavy: '--surface-glass-heavy', surfaceHover: '--surface-hover',
  cardBg: '--card-bg', cardBorder: '--card-border', cardActive: '--card-active', inputBg: '--input-bg',
  controlBorder: '--control-border', divider: '--divider',
  textHeading: '--text-heading', textBody: '--text-body', textSecondary: '--text-secondary', textMuted: '--text-muted',
  brand: '--brand', brandHover: '--brand-hover', brandLight: '--brand-light', textOnBrand: '--text-on-brand',
  brandTintHover: '--brand-tint-hover', brandTintActive: '--brand-tint-active', buttonSecondaryHover: '--button-secondary-hover',
  success: '--success', successStrong: '--success-strong', successTint: '--success-tint',
  error: '--error', errorTint: '--error-tint',
  warning: '--warning', warningStrong: '--warning-strong', warningTint: '--warning-tint',
  info: '--info', zap: '--zap',
  focusRing: '--focus-ring', scrim: '--scrim', shadowCard: '--shadow-card', shadowModal: '--shadow-modal',
};

/** Nostr WoT's base palette (`:root`). */
const LIGHT: Theme = {
  dark: false,
  bgPage: 'linear-gradient(45deg, #ffffff, #eeeffd)', bgPageSolid: '#ffffff', bgHtml: '#f8f8fc', bgElevated: '#ffffff',
  surfaceGlass: 'rgba(255, 255, 255, 0.85)', surfaceGlassHeavy: 'rgba(255, 255, 255, 0.95)', surfaceHover: 'rgba(99, 102, 241, 0.12)',
  cardBg: 'rgba(99, 102, 241, 0.06)', cardBorder: 'rgba(99, 102, 241, 0.1)', cardActive: 'rgba(99, 102, 241, 0.12)',
  inputBg: '#f1f2f7', controlBorder: 'rgba(99, 102, 241, 0.28)', divider: 'rgba(99, 102, 241, 0.06)',
  textHeading: 'rgba(0, 0, 0, 0.8)', textBody: 'rgba(0, 0, 0, 0.7)', textSecondary: 'rgba(0, 0, 0, 0.56)', textMuted: 'rgba(0, 0, 0, 0.45)',
  brand: '#6366f1', brandHover: '#4f46e5', brandLight: 'rgba(99, 102, 241, 0.1)', textOnBrand: '#ffffff',
  brandTintHover: 'rgba(99, 102, 241, 0.04)', brandTintActive: 'rgba(99, 102, 241, 0.08)', buttonSecondaryHover: 'rgba(99, 102, 241, 0.18)',
  success: '#059669', successStrong: '#15803d', successTint: 'rgba(5, 150, 105, 0.1)',
  error: '#dc2626', errorTint: 'rgba(220, 38, 38, 0.08)',
  warning: '#d97706', warningStrong: '#b45309', warningTint: 'rgba(217, 119, 6, 0.08)',
  info: '#2563eb', zap: '#6366f1',
  focusRing: '0 0 0 3px rgba(99, 102, 241, 0.12)', scrim: 'rgba(0, 0, 0, 0.4)',
  shadowCard: '0 4px 16px rgba(99, 102, 241, 0.08)', shadowModal: '0 8px 32px rgba(0, 0, 0, 0.18)',
};

/** The dark base every dark palette starts from. */
const DARK_BASE: Theme = {
  ...LIGHT,
  dark: true,
  bgPage: 'linear-gradient(45deg, #171722, #202033)', bgPageSolid: '#1c1c2a', bgHtml: '#12121c', bgElevated: '#252434',
  surfaceGlass: 'rgba(28, 28, 42, 0.95)', surfaceGlassHeavy: 'rgba(28, 28, 42, 0.98)',
  cardBg: 'rgba(179, 167, 255, 0.07)', cardBorder: 'rgba(179, 167, 255, 0.24)', cardActive: 'rgba(179, 167, 255, 0.18)',
  inputBg: '#292839', controlBorder: '#706785', divider: 'rgba(179, 167, 255, 0.15)',
  textHeading: '#f3f1ff', textBody: '#dedbea', textSecondary: '#b9b5cd', textMuted: '#a29cb9',
  brand: '#b3a7ff', brandHover: '#c8bfff', brandLight: 'rgba(179, 167, 255, 0.14)', textOnBrand: '#201936',
  brandTintHover: 'rgba(179, 167, 255, 0.09)', brandTintActive: 'rgba(179, 167, 255, 0.16)',
  success: '#6ee7b7', successStrong: '#6ee7b7', successTint: 'rgba(110, 231, 183, 0.12)',
  error: '#ff909b', errorTint: 'rgba(255, 144, 155, 0.12)',
  warning: '#fcd17a', warningStrong: '#fcd17a', warningTint: 'rgba(252, 209, 122, 0.1)',
  info: '#93c5fd',
  focusRing: '0 0 0 3px rgba(179, 167, 255, 0.5)', scrim: 'rgba(0, 0, 0, 0.6)',
  shadowCard: '0 4px 16px rgba(0, 0, 0, 0.2)', shadowModal: '0 8px 32px rgba(0, 0, 0, 0.5)',
};

/** `--zap` follows `--brand` unless a palette sets its own, as in Nostr WoT. */
const on = (base: Theme, over: Partial<Theme>): Theme => {
  const theme = { ...base, ...over };
  return { ...theme, zap: over.zap ?? theme.brand };
};

export const THEMES = {
  light: LIGHT,
  dark: on(DARK_BASE, {
    bgPage: '#030712', bgPageSolid: '#030712', bgHtml: '#030712', bgElevated: '#080e1a',
    surfaceGlass: 'rgba(3, 7, 18, 0.95)', surfaceGlassHeavy: '#101828', surfaceHover: '#1e2939',
    cardBg: '#101828', cardBorder: '#1e2939', cardActive: '#1e2939', inputBg: '#101828', controlBorder: '#6a7282', divider: '#1e2939',
    textHeading: '#ffffff', textBody: '#f3f4f6', textSecondary: '#d1d5dc', textMuted: '#99a1af',
    brand: '#818cf8', brandHover: '#a5b4fc', brandLight: 'rgba(99, 102, 241, 0.1)', textOnBrand: '#030712',
    brandTintHover: '#1e2939', brandTintActive: 'rgba(99, 102, 241, 0.2)', buttonSecondaryHover: '#293259',
    focusRing: '0 0 0 3px rgba(129, 140, 248, 0.5)',
  }),
  lacrypta: on(DARK_BASE, {
    bgPage: 'linear-gradient(45deg, #090908, #171710)', bgPageSolid: '#11110f', bgHtml: '#090908', bgElevated: '#171914',
    surfaceGlass: 'rgba(17, 17, 15, 0.95)', surfaceGlassHeavy: 'rgba(17, 17, 15, 0.98)', surfaceHover: '#303526',
    cardBg: 'rgba(199, 255, 91, 0.05)', cardBorder: 'rgba(199, 255, 91, 0.2)', cardActive: 'rgba(199, 255, 91, 0.16)',
    inputBg: '#25251e', controlBorder: '#6b7059', divider: 'rgba(199, 255, 91, 0.14)',
    textHeading: '#f5f0e6', textBody: '#e5e1d7', textSecondary: '#bfbeb0', textMuted: '#a6a698',
    brand: '#c7ff5b', brandHover: '#dcff9d', brandLight: 'rgba(199, 255, 91, 0.12)', textOnBrand: '#11110f',
    brandTintHover: 'rgba(199, 255, 91, 0.08)', brandTintActive: 'rgba(199, 255, 91, 0.12)', buttonSecondaryHover: 'rgba(199, 255, 91, 0.22)',
    warning: '#ffb267', warningStrong: '#ffb267', warningTint: 'rgba(255, 122, 26, 0.1)',
    focusRing: '0 0 0 3px rgba(199, 255, 91, 0.5)',
  }),
  coracle: on(DARK_BASE, {
    bgPage: '#262626', bgPageSolid: '#262626', bgHtml: '#171717', bgElevated: '#222222',
    surfaceGlass: 'rgba(38,38,38,.95)', surfaceGlassHeavy: '#222222', surfaceHover: '#2a2a2a',
    cardBg: '#332f2d', cardBorder: '#5a524f', cardActive: '#3e3a38', inputBg: '#171717', controlBorder: '#737373', divider: '#404040',
    textHeading: '#f5f5f5', textBody: '#e5e5e5', textSecondary: '#d4d4d4', textMuted: '#a3a3a3',
    brand: '#fc560e', brandHover: '#ff5f0f', brandLight: 'rgba(252,86,14,.13)', textOnBrand: '#171717',
    brandTintHover: 'rgba(252,86,14,.09)', brandTintActive: 'rgba(252,86,14,.16)', buttonSecondaryHover: 'rgba(252,86,14,.18)',
    success: '#12d2b0', successStrong: '#12d2b0', successTint: 'rgba(18,210,176,.12)',
    warning: '#fcab0e', warningStrong: '#fcab0e', warningTint: 'rgba(252,171,14,.1)',
    error: '#dc0c0c', errorTint: 'rgba(220,12,12,.12)',
    focusRing: '0 0 0 3px rgba(252,86,14,.4)',
  }),
  'coracle-light': on(LIGHT, {
    bgPage: '#f5f5f5', bgPageSolid: '#f5f5f5', bgHtml: '#fafafa', bgElevated: '#ffffff',
    surfaceGlass: 'rgba(245,245,245,.95)', surfaceGlassHeavy: '#ffffff', surfaceHover: '#fafafa',
    cardBg: '#ffffff', cardBorder: '#d4d4d4', cardActive: '#fafafa', inputBg: '#ffffff', controlBorder: '#737373', divider: '#d4d4d4',
    textHeading: '#171717', textBody: '#262626', textSecondary: '#404040', textMuted: '#525252',
    brand: '#fc560e', brandHover: '#e34d0d', brandLight: 'rgba(252,86,14,.13)', textOnBrand: '#171717',
    brandTintHover: 'rgba(252,86,14,.09)', brandTintActive: 'rgba(252,86,14,.16)', buttonSecondaryHover: 'rgba(252,86,14,.18)',
    success: '#12d2b0', successStrong: '#12d2b0', successTint: 'rgba(18,210,176,.12)',
    warning: '#fcab0e', warningStrong: '#fcab0e', warningTint: 'rgba(252,171,14,.1)',
    error: '#dc0c0c', errorTint: 'rgba(220,12,12,.12)',
    focusRing: '0 0 0 3px rgba(252,86,14,.4)',
  }),
  nostrudel: on(DARK_BASE, {
    bgPage: '#0e0e0e', bgPageSolid: '#0e0e0e', bgHtml: '#0e0e0e', bgElevated: '#242424',
    surfaceGlass: 'rgba(14,14,14,.95)', surfaceGlassHeavy: '#242424', surfaceHover: '#303030',
    cardBg: '#242424', cardBorder: '#3a3a3a', cardActive: '#303620', inputBg: '#242424', controlBorder: '#737373', divider: '#3a3a3a',
    textHeading: '#ffffff', textBody: '#ffffff', textSecondary: '#ffffff', textMuted: '#b3b3b3',
    brand: '#aad238', brandHover: '#9fc830', brandLight: 'rgba(170,210,56,.14)', textOnBrand: '#171d00',
    brandTintHover: 'rgba(170,210,56,.09)', brandTintActive: 'rgba(170,210,56,.16)', buttonSecondaryHover: 'rgba(170,210,56,.18)',
    warning: '#fbd38d', warningStrong: '#fbd38d', warningTint: 'rgba(251,211,141,.1)',
    error: '#feb2b2', errorTint: 'rgba(254,178,178,.12)',
    info: '#90cdf4', focusRing: '0 0 0 3px rgba(99,179,237,.45)',
  }),
  'nostrudel-light': on(LIGHT, {
    bgPage: '#ffffff', bgPageSolid: '#ffffff', bgHtml: '#ffffff', bgElevated: '#ffffff',
    surfaceGlass: 'rgba(255,255,255,.95)', surfaceGlassHeavy: '#ffffff', surfaceHover: '#d5d5d5',
    cardBg: '#ffffff', cardBorder: '#bfbfbf', cardActive: '#d5d5d5', inputBg: '#ffffff', controlBorder: '#939393', divider: '#bfbfbf',
    textHeading: '#242424', textBody: '#242424', textSecondary: '#3a3a3a', textMuted: '#505050',
    brand: '#88b220', brandHover: '#7da718', brandLight: 'rgba(136,178,32,.14)', textOnBrand: '#ffffff',
    brandTintHover: 'rgba(136,178,32,.09)', brandTintActive: 'rgba(136,178,32,.16)', buttonSecondaryHover: 'rgba(136,178,32,.18)',
    warning: '#c05621', warningStrong: '#c05621', warningTint: '#fffaf0',
    error: '#c53030', errorTint: '#fff5f5',
    info: '#3182ce', focusRing: '0 0 0 3px rgba(49,130,206,.45)',
  }),
  yakihonne: on(DARK_BASE, {
    bgPage: '#000000', bgPageSolid: '#000000', bgHtml: '#000000', bgElevated: '#191919',
    surfaceGlass: '#171718ed', surfaceGlassHeavy: '#191919', surfaceHover: '#252525',
    cardBg: '#191919', cardBorder: '#333333', cardActive: '#252525', inputBg: '#191919', controlBorder: '#909090', divider: '#333333',
    textHeading: '#e5e5e5', textBody: '#d8d8d8', textSecondary: '#d8d8d8', textMuted: '#909090',
    brand: '#ee7700', brandHover: '#ee7700', brandLight: '#ee770026', textOnBrand: '#000000',
    brandTintHover: '#86318c08', brandTintActive: '#ee770026', buttonSecondaryHover: '#28002b',
    success: '#00c04d', successStrong: '#00c04d', successTint: '#00c04d20',
    error: '#ff4a4a', errorTint: '#ff4a4a17',
    warning: '#ee7700', warningStrong: '#ee7700', warningTint: '#ee770026',
    info: '#1d9bf0', focusRing: '0 0 0 3px #ee770026',
  }),
  'yakihonne-light': on(LIGHT, {
    bgPage: '#ffffff', bgPageSolid: '#ffffff', bgHtml: '#ffffff', bgElevated: '#f1f1f1',
    surfaceGlass: '#ffffffda', surfaceGlassHeavy: '#ffffff', surfaceHover: '#e5e5e5',
    cardBg: '#f1f1f1', cardBorder: '#e5e5e5', cardActive: '#e5e5e5', inputBg: '#f1f1f1', controlBorder: '#909090', divider: '#e5e5e5',
    textHeading: '#202020', textBody: '#000000', textSecondary: '#202020', textMuted: '#909090',
    brand: '#ee7700', brandHover: '#ee7700', brandLight: '#fffaf3', textOnBrand: '#000000',
    brandTintHover: '#86318c08', brandTintActive: '#fffaf3', buttonSecondaryHover: '#fffaf3',
    success: '#00c04d', successStrong: '#00c04d', successTint: '#f2fdf6',
    error: '#ff4a4a', errorTint: '#fff6f6',
    warning: '#ee7700', warningStrong: '#ee7700', warningTint: '#fffaf3',
    info: '#1d9bf0', focusRing: '0 0 0 3px #ee770026',
  }),
  nostrich: on(DARK_BASE, {
    bgPage: '#0a0a0a', bgPageSolid: '#0a0a0a', bgHtml: '#050505', bgElevated: '#171717',
    surfaceGlass: 'rgba(10,10,10,.95)', surfaceGlassHeavy: '#171717', surfaceHover: '#1c1c1c',
    cardBg: '#171717', cardBorder: '#404040', cardActive: '#262626', inputBg: '#050505', controlBorder: '#737373', divider: '#404040',
    textHeading: '#fafafa', textBody: '#fafafa', textSecondary: '#cacaca', textMuted: '#9a9a9a',
    brand: '#fafafa', brandHover: '#e5e5e5', brandLight: '#262626', textOnBrand: '#0a0a0a',
    brandTintHover: '#1c1c1c', brandTintActive: '#262626', buttonSecondaryHover: '#262626',
    success: '#66d6a2', successStrong: '#66d6a2', successTint: '#11271d',
    warning: '#eb8f60', warningStrong: '#eb8f60', warningTint: '#2c1a11',
    error: '#e76e7e', errorTint: '#2c1115',
    info: '#5eb0f5', zap: '#ffb020', focusRing: '0 0 0 3px #fafafa',
  }),
  'nostrich-light': on(LIGHT, {
    bgPage: '#ffffff', bgPageSolid: '#ffffff', bgHtml: '#f5f5f5', bgElevated: '#fafafa',
    surfaceGlass: 'rgba(255,255,255,.95)', surfaceGlassHeavy: '#fafafa', surfaceHover: '#ededed',
    cardBg: '#fafafa', cardBorder: '#e5e5e5', cardActive: '#ededed', inputBg: '#f5f5f5', controlBorder: '#9a9a9a', divider: '#e5e5e5',
    textHeading: '#171717', textBody: '#171717', textSecondary: '#525252', textMuted: '#737373',
    brand: '#171717', brandHover: '#404040', brandLight: '#fafafa', textOnBrand: '#ffffff',
    brandTintHover: '#ededed', brandTintActive: '#ededed', buttonSecondaryHover: '#ededed',
    success: '#1c6e48', successStrong: '#1c6e48', successTint: '#effaf5',
    warning: '#954218', warningStrong: '#954218', warningTint: '#fdf2ed',
    error: '#ab1c2f', errorTint: '#fdedef',
    info: '#0f6fd4', zap: '#e08a00', focusRing: '0 0 0 3px #171717',
  }),
} satisfies Record<string, Theme>;

export type ThemeId = keyof typeof THEMES;

// ── The person's choice ──

export const PALETTES = [
  { id: 'nostr-wot', label: 'Nostr WoT' },
  { id: 'lacrypta', label: 'La Crypta', fixed: true },
  { id: 'coracle', label: 'Coracle' },
  { id: 'nostrudel', label: 'noStrudel' },
  { id: 'yakihonne', label: 'YakiHonne' },
  { id: 'nostrich', label: 'Nostrich' },
] as const;

export type PaletteId = typeof PALETTES[number]['id'];

/** `auto` follows WhatsApp's dark mode inside WhatsApp, and the system's on extension pages. */
export const APPEARANCES = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
] as const;

export type Appearance = typeof APPEARANCES[number]['id'];

export interface ThemeChoice { palette: PaletteId; appearance: Appearance }

export const DEFAULT_THEME: ThemeChoice = { palette: 'nostr-wot', appearance: 'auto' };

/** Read a stored choice; anything unknown falls back to the default. */
export function parseThemeChoice(value: unknown): ThemeChoice {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const palette = PALETTES.find(p => p.id === v.palette)?.id ?? DEFAULT_THEME.palette;
  const appearance = APPEARANCES.find(a => a.id === v.appearance)?.id ?? DEFAULT_THEME.appearance;
  return { palette, appearance };
}

/** Whether a palette has light and dark variants (La Crypta has one). */
export function hasAppearance(palette: PaletteId): boolean {
  return !PALETTES.find(p => p.id === palette && 'fixed' in p && p.fixed);
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ThemeId {
  if (!hasAppearance(choice.palette)) return choice.palette as ThemeId;
  const dark = choice.appearance === 'auto' ? prefersDark : choice.appearance === 'dark';
  if (choice.palette === 'nostr-wot') return dark ? 'dark' : 'light';
  return (dark ? choice.palette : `${choice.palette}-light`) as ThemeId;
}

/**
 * The colour for WhatZaps marks drawn on WhatsApp's own surfaces (the /zap
 * command, the ⚡ Nostr buttons): the palette's zap colour in the variant that
 * matches WhatsApp's light or dark background, mixed toward contrast when the
 * palette has no such variant (La Crypta's lime on WhatsApp's light theme).
 */
export function markColor(palette: PaletteId, darkBackground: boolean): string {
  const theme = THEMES[resolveTheme({ palette, appearance: 'auto' }, darkBackground)];
  if (theme.dark === darkBackground) return theme.zap;
  return `color-mix(in srgb, ${theme.zap} 50%, ${darkBackground ? '#ffffff' : '#000000'})`;
}

// ── CSS ──

/** CSS declarations setting one theme's custom properties. */
export function themeVars(theme: Theme): string {
  const vars = (Object.keys(CSS_NAMES) as Array<keyof typeof CSS_NAMES>).map(key => `${CSS_NAMES[key]}: ${theme[key]};`);
  return [`color-scheme: ${theme.dark ? 'dark' : 'light'};`, ...vars].join(' ');
}

/** One rule per theme: `selector(id) { …that theme's custom properties… }`. */
export function themeCss(selector: (id: ThemeId) => string): string {
  return (Object.keys(THEMES) as ThemeId[]).map(id => `${selector(id)} { ${themeVars(THEMES[id])} }`).join('\n');
}

/**
 * Nostr WoT's topographic background (its TopoBg component): the same
 * contours, drawn as a mask so they take the theme's brand colour instead of
 * always being indigo. Only the rings that render in Nostr WoT are kept (its
 * inner rings use CSS variables, which an SVG image cannot see).
 */
const contours = (size: number, rings: Array<[number, number, number, number, number]>, width: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'><g fill='none' stroke-width='${width}'>${
      rings.map(([cx, cy, rx, ry, alpha]) => `<ellipse cx='${cx}' cy='${cy}' rx='${rx}' ry='${ry}' stroke='rgba(0,0,0,${alpha})'/>`).join('')
    }</g></svg>`)}")`;

export const TOPO_LAYER_1 = contours(600, [
  [300, 300, 290, 245, 0.05], [120, 120, 70, 55, 0.09], [120, 120, 130, 100, 0.07], [120, 120, 200, 160, 0.05],
  [500, 470, 65, 50, 0.09], [500, 470, 120, 90, 0.07], [500, 470, 190, 145, 0.05],
], 1.5);

export const TOPO_LAYER_2 = contours(500, [
  [250, 250, 45, 65, 0.09], [250, 250, 90, 120, 0.07], [250, 250, 145, 185, 0.05], [90, 400, 55, 40, 0.07],
  [90, 400, 110, 80, 0.05], [410, 90, 50, 65, 0.07], [410, 90, 100, 130, 0.05],
], 1.2);

/**
 * CSS drawing the topographic background behind `selector`'s content: two
 * slowly drifting contour layers in the brand colour, on ::before and ::after.
 * `fixed` keeps them still behind scrolling content (a page); `absolute`
 * needs `selector` to be a positioning container (a card).
 */
export function topoCss(selector: string, position: 'fixed' | 'absolute' = 'absolute'): string {
  return `
${selector}::before, ${selector}::after {
  content: ""; position: ${position}; inset: -60px; z-index: 0; pointer-events: none;
  background: var(--brand); -webkit-mask-repeat: repeat; mask-repeat: repeat;
}
${selector}::before { -webkit-mask-image: ${TOPO_LAYER_1}; mask-image: ${TOPO_LAYER_1}; -webkit-mask-size: 600px 600px; mask-size: 600px 600px; animation: topo-float 18s ease-in-out infinite; }
${selector}::after { -webkit-mask-image: ${TOPO_LAYER_2}; mask-image: ${TOPO_LAYER_2}; -webkit-mask-size: 500px 500px; mask-size: 500px 500px; animation: topo-float-2 14s ease-in-out infinite; }
@keyframes topo-float {
  0%, 100% { transform: translate(0, 0) rotate(0deg) scale(1); }
  20% { transform: translate(20px, -25px) rotate(1.5deg) scale(1.02); }
  40% { transform: translate(-15px, 20px) rotate(-1deg) scale(0.98); }
  60% { transform: translate(25px, 10px) rotate(0.8deg) scale(1.01); }
  80% { transform: translate(-10px, -15px) rotate(-0.5deg) scale(0.99); }
}
@keyframes topo-float-2 {
  0%, 100% { transform: translate(0, 0) rotate(0deg) scale(1); }
  25% { transform: translate(-25px, 15px) rotate(-1.5deg) scale(1.03); }
  50% { transform: translate(18px, -22px) rotate(1.2deg) scale(0.97); }
  75% { transform: translate(-12px, 20px) rotate(-0.8deg) scale(1.01); }
}
@media (prefers-reduced-motion: reduce) { ${selector}::before, ${selector}::after { animation: none; } }
`;
}
