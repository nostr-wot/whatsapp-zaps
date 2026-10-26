/**
 * The zap dialog: a shadow-DOM overlay so WhatsApp's CSS cannot reach it and
 * its CSS cannot reach WhatsApp. All user and server text goes in through
 * textContent / value, never innerHTML.
 */
import { isLightningAddress } from '../domain/lnurl.ts';
import type { PayOutcome } from '../domain/bridge.ts';
import type { ChatMessage } from '../domain/command.ts';
import type { AddressAnswer, Candidate, ChatAftermath, ConfirmAnswer, ConfirmDetails, PersonView, ZapUi } from '../flow.ts';
import { shortNpub, type ProfileResult } from '../domain/nostr.ts';
import { npubEncode } from 'nostr-tools/nip19';
import type { Mapping } from '../domain/mappings.ts';
import type { LinkAnswer, LinkUi, LinkView, LinkedMember } from '../linkFlow.ts';
import { attachStyles } from './styles.ts';
import { THEMES, themeCss, themeVars, type ThemeId } from './themes.ts';

/**
 * Nostr WoT's look: its theme tokens on the host (data-theme says which
 * palette; Nostr WoT Light without one), its dialog, buttons, fields and rows.
 */
const STYLE = `
:host { all: initial; }
:host { ${themeVars(THEMES.light)} }
${themeCss(id => `:host([data-theme="${id}"])`)}
.backdrop {
  position: fixed; inset: 0; z-index: 2147483646;
  display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box;
  background: rgba(0, 0, 0, .45); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--text-body);
  animation: fade .14s ease-out;
}
@keyframes fade { from { opacity: 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.98); } }
.card {
  background: var(--bg-page); background-color: var(--bg-page-solid); color: var(--text-body);
  width: min(420px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; box-sizing: border-box;
  border: 1px solid var(--card-border); border-radius: 16px; padding: 0 16px 16px; box-shadow: var(--shadow-modal);
  animation: rise .18s cubic-bezier(.2, .8, .2, 1);
}

/* Header: logo, title, close. */
h2 {
  display: flex; align-items: center; gap: 10px;
  margin: 0 -16px 14px; padding: 12px 10px 12px 16px;
  background: var(--surface-glass-heavy); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--card-border);
  font-size: 15px; font-weight: 700; color: var(--text-heading);
  position: sticky; top: 0; z-index: 2;
}
.brand { flex: none; width: 28px; height: 28px; border-radius: 8px; display: block; }
button.close {
  margin-left: auto; width: 32px; min-height: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px;
  display: grid; place-items: center; font-size: 20px; line-height: 1; color: var(--text-muted); background: transparent;
}
button.close:hover:not(:disabled) { background: var(--surface-hover); color: var(--text-heading); }
h3 { margin: 18px 0 8px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); }
p { margin: 0 0 12px; }
strong { color: var(--text-heading); }
form { display: block; }
.muted { color: var(--text-secondary); font-size: 12px; }
.small-print { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
.error { color: var(--error); }
.warn { color: var(--warning-strong); }
.ok { color: var(--success); }
.error:empty, .ok:empty, .muted:empty { display: none; }
.mono { font-family: "SF Mono", Monaco, Inconsolata, "Roboto Mono", monospace; font-size: 11px; }

/* Fields. */
input[type="text"] {
  width: 100%; box-sizing: border-box; min-height: 40px; padding: 8px 12px; margin: 0;
  border: 1px solid var(--control-border); border-radius: 8px; background: var(--input-bg); color: var(--text-heading); font: inherit;
  transition: border-color .15s, box-shadow .15s;
}
input[type="text"]::placeholder { color: var(--text-muted); }
input[type="text"]:hover { border-color: var(--brand); }
input[type="text"]:focus { outline: none; border-color: var(--brand); box-shadow: var(--focus-ring); }
input[type="radio"] { accent-color: var(--brand); margin: 0; width: 16px; height: 16px; }
label.choice { display: flex; gap: 10px; align-items: center; padding: 8px 6px; cursor: pointer; border-radius: 8px; color: var(--text-body); }
label.choice:hover { background: var(--brand-tint-hover); }
.row { display: flex; gap: 8px; align-items: center; margin: 0 0 10px; }
.row input { flex: 1; min-width: 0; }
#wz-member { margin-bottom: 10px; }

/* Nostr WoT's switch. */
input.switch {
  appearance: none; -webkit-appearance: none; flex: none; position: relative; margin: 0; cursor: pointer;
  width: 40px; height: 22px; border-radius: 11px; background: var(--control-border); transition: background .2s;
}
input.switch::before {
  content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; transition: transform .2s;
}
input.switch:checked { background: var(--brand); }
input.switch:checked::before { transform: translateX(18px); background: var(--bg-elevated); }
input.switch:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }

/* Buttons. */
button {
  font: inherit; font-weight: 600; border-radius: 8px; padding: 8px 14px; min-height: 40px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: 1px solid var(--card-border); background: transparent; color: var(--text-secondary); white-space: nowrap;
  transition: background .15s, border-color .15s, color .15s, transform .05s;
}
button:hover:not(:disabled) { background: var(--surface-hover); color: var(--text-heading); }
button:active:not(:disabled) { transform: translateY(1px); }
button.primary { background: var(--brand); border-color: var(--brand); color: var(--text-on-brand); }
button.primary:hover:not(:disabled) { background: var(--brand-hover); border-color: var(--brand-hover); color: var(--text-on-brand); }
button.small { min-height: 32px; padding: 6px 10px; font-size: 12px; flex: none; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, label.choice:focus-within { outline: 2px solid var(--brand); outline-offset: 2px; }
.actions {
  display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap;
  position: sticky; bottom: -16px; z-index: 1;
  margin: 16px -16px -16px; padding: 12px 16px;
  background: var(--surface-glass-heavy); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  border-top: 1px solid var(--card-border);
}

/* People: avatars, search results, saved links, name pickers. */
.avatar {
  flex: none; width: 40px; height: 40px; border-radius: 50%; position: relative; overflow: hidden;
  display: grid; place-items: center; font-weight: 700; font-size: 16px; text-transform: uppercase;
  background: var(--brand-light); color: var(--brand);
}
.avatar.lg { width: 60px; height: 60px; font-size: 24px; }
.avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: var(--bg-elevated); animation: fade .2s; }
.face { position: relative; flex: none; display: inline-grid; }
.badge {
  position: absolute; right: -2px; bottom: -2px; width: 22px; height: 22px; border-radius: 50%; box-sizing: border-box;
  display: grid; place-items: center; font-size: 12px; font-weight: 800; color: var(--bg-elevated); border: 2.5px solid var(--bg-elevated);
}
.badge.good { background: var(--success); } .badge.unsure { background: var(--warning); } .badge.bad { background: var(--error); }
.badge.zap { background: var(--zap); color: var(--text-on-brand); }
.results { display: grid; gap: 6px; max-height: 300px; overflow-y: auto; margin: 0 0 10px; }
.results:empty { display: none; }
button.option {
  display: flex; gap: 12px; align-items: flex-start; justify-content: flex-start; width: 100%; height: auto; text-align: left;
  padding: 10px 12px; border-radius: 12px; border: 1px solid var(--card-border); background: var(--surface-glass-heavy);
  white-space: normal; font-weight: 400; color: var(--text-body);
}
button.option:hover:not(:disabled) { background: var(--surface-hover); border-color: var(--brand); color: var(--text-body); }
button.option:disabled { opacity: .55; }
button.option:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; background: var(--brand-tint-active); }
.who { display: grid; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.who .name { font-weight: 700; color: var(--text-heading); }
.chips { display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; }
.chip { display: inline-flex; align-items: center; padding: 1px 7px; border: 1px solid var(--card-border); border-radius: 6px; font-size: 11px; font-weight: 600; color: var(--text-secondary); }
.verified { color: var(--success); }
.chip.verified { border-color: var(--success-tint); background: var(--success-tint); color: var(--success); }
.chip.follows { border-color: var(--brand); background: var(--brand-tint-active); color: var(--brand); }
.chip.nostr { border-color: transparent; background: var(--brand-light); color: var(--brand); }
.ln { color: var(--zap); font-weight: 600; }
.ln.none { color: var(--text-muted); font-weight: 400; }
button.small.more { justify-self: start; }
.skeleton { display: flex; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--card-border); animation: pulse 1.2s ease-in-out infinite; }
.skeleton-dot { background: var(--card-active); }
.skeleton-lines { flex: 1; display: grid; gap: 6px; }
.skeleton-lines span { height: 10px; border-radius: 5px; background: var(--card-active); }
.skeleton-lines span:first-child { width: 55%; } .skeleton-lines span:last-child { width: 80%; }
@keyframes pulse { 50% { opacity: .55; } }
.linked { display: grid; gap: 8px; margin: 0 0 4px; }
.link-row { display: flex; gap: 12px; align-items: center; padding: 12px; border-radius: 12px; background: var(--card-bg); border: 1px solid var(--card-border); }
.link-row .who-row { flex: 1; }
.who-row { display: flex; gap: 12px; align-items: flex-start; min-width: 0; }
.empty { padding: 14px; border-radius: 12px; border: 1.5px dashed var(--card-border); color: var(--text-muted); font-size: 12px; margin: 0 0 4px; text-align: center; }
.intro { display: flex; gap: 12px; align-items: center; margin: 0 0 14px; }
.intro p { margin: 0; }

/* Confirm: the amount first, then who. */
.hero { display: grid; justify-items: center; gap: 2px; padding: 4px 0 12px; }
.amount { font-size: 40px; font-weight: 800; letter-spacing: -.03em; color: var(--text-heading); font-variant-numeric: tabular-nums; line-height: 1.05; }
.amount .bolt { color: var(--zap); margin-right: 4px; font-size: 32px; }
.unit { font-size: 15px; font-weight: 600; color: var(--text-muted); margin-left: 4px; letter-spacing: 0; }
.to { color: var(--text-muted); font-size: 12px; text-transform: lowercase; margin: 0 0 8px; text-align: center; }
.person { display: flex; gap: 14px; align-items: center; padding: 14px; border-radius: 12px; background: var(--card-bg); border: 1px solid var(--card-border); margin: 0 0 14px; }
.person .who { gap: 3px; }
.person .name { font-size: 15px; }
.bubble {
  position: relative; margin: 0 0 14px auto; width: fit-content; max-width: 85%;
  padding: 7px 10px 8px; border-radius: 10px 0 10px 10px; background: var(--brand-light); color: var(--text-heading);
  font-size: 13px; overflow-wrap: anywhere;
}
.bubble::after { content: ""; position: absolute; top: 0; right: -8px; width: 0; height: 0; border-top: 8px solid var(--brand-light); border-right: 8px solid transparent; }
.says { font-size: 12px; color: var(--text-secondary); margin: -4px 0 12px; }
label.post { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 12px 14px; margin: 0 0 12px; border-radius: 12px; border: 1px solid var(--card-border); background: var(--surface-glass-heavy); cursor: pointer; color: var(--text-heading); font-weight: 600; }
label.post .preview { display: block; margin-top: 6px; padding: 6px 10px; border-radius: 8px; background: var(--brand-light); color: var(--text-heading); font-size: 13px; font-weight: 400; width: fit-content; max-width: 100%; overflow-wrap: anywhere; }
.mention { color: var(--brand); font-weight: 700; }
.preview-inline { padding: 2px 8px; border-radius: 6px; background: var(--brand-light); color: var(--text-heading); }
.copy-box { display: flex; gap: 8px; align-items: center; margin: 0 0 12px; }
.copy-box output { flex: 1; min-width: 0; padding: 8px 10px; border-radius: 8px; background: var(--input-bg); border: 1px solid var(--control-border); color: var(--text-heading); user-select: all; overflow-wrap: anywhere; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; margin: 0 0 14px; }
dt { color: var(--text-muted); }
dd { margin: 0; overflow-wrap: anywhere; }

/* Outcomes. */
.result { display: grid; justify-items: center; text-align: center; gap: 6px; padding: 6px 0 14px; }
.result .title { font-size: 18px; font-weight: 700; color: var(--text-heading); }
.state { display: flex; gap: 12px; align-items: flex-start; padding: 12px; border-radius: 12px; margin: 0 0 12px; text-align: left; border: 1px solid transparent; }
.state::before { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; font-weight: 800; color: var(--bg-elevated); }
.state.good { background: var(--success-tint); } .state.good::before { content: "✓"; background: var(--success); }
.state.unsure { background: var(--warning-tint); } .state.unsure::before { content: "?"; background: var(--warning); }
.state.bad { background: var(--error-tint); } .state.bad::before { content: "!"; background: var(--error); }
.state p { margin: 0; }

/* Waiting: the person's picture inside a turning ring. */
.loading { display: grid; justify-items: center; gap: 12px; padding: 10px 0 8px; color: var(--text-secondary); text-align: center; }
.ring { position: relative; display: grid; place-items: center; width: 76px; height: 76px; }
.ring::before { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 3px solid var(--brand-light); border-top-color: var(--brand); animation: spin .9s linear infinite; }
.spinner { width: 22px; height: 22px; border-radius: 50%; border: 3px solid var(--brand-light); border-top-color: var(--brand); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .spinner, .skeleton, .ring::before, .backdrop, .card, .avatar img { animation: none; }
  * { transition: none !important; }
}
`;

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) if (value !== undefined) el.setAttribute(key, value);
  for (const child of children) if (child) el.append(child);
  return el;
}

const sats = (n: number) => `${n.toLocaleString('en-US')} sats`;

/** A message preview, with the mention shown the way WhatsApp shows one. */
function previewParts(message: ChatMessage): Child[] {
  const m = message.mention;
  if (!m) return [message.text];
  return [m.before, h('span', { class: 'mention' }, `@${m.who.label.replace(/^@/, '')}`), m.after];
}

const SVG = 'http://www.w3.org/2000/svg';

/** The WhatZaps mark (as the extension icon), drawn inline: no image request the page could block. */
function brandMark(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 128 128');
  svg.setAttribute('class', 'brand');
  svg.setAttribute('aria-hidden', 'true');
  const shape = (tag: string, attrs: Record<string, string>) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  };
  shape('rect', { width: '128', height: '128', rx: '30', fill: '#00a884' });
  shape('path', { fill: '#ffffff', d: 'M64 20c25.4 0 46 17.9 46 40s-20.6 40-46 40c-6.2 0-12.1-1.1-17.5-3L24 106l7.2-19.6C23 79.3 18 70.1 18 60c0-22.1 20.6-40 46-40z' });
  shape('path', { fill: '#ffb800', stroke: '#e08e00', 'stroke-width': '2', 'stroke-linejoin': 'round', d: 'M71 30 45 66h17l-6 29 27-38H66l5-27z' });
  return svg;
}

/** A round initial in the theme's colours; a profile picture covers it when there is one. */
function avatar(label: string): HTMLElement {
  const initial = [...label.replace(/^[^\p{L}\p{N}]+/u, '')][0] ?? '?';
  return h('span', { class: 'avatar', 'aria-hidden': 'true' }, initial);
}

export class ZapDialog implements ZapUi, LinkUi {
  private host: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private onCancel: (() => void) | null = null;

  private readonly doc: Document;
  private readonly onClosed: () => void;
  private readonly shadowMode: ShadowRootMode;
  private readonly requireTrusted: boolean;
  private readonly search: ((query: string) => Promise<ProfileResult[]>) | null;
  private readonly avatar: ((url: string) => Promise<string | null>) | null;
  private readonly profile: ((pubkey: string) => Promise<ProfileResult | null>) | null;
  private readonly theme: (() => ThemeId) | null;
  /** Who the current zap is for, so the waiting screens can show them. */
  private person: { name: string; person?: PersonView } | null = null;

  /**
   * The shadow root is closed and buttons ignore synthetic events by default,
   * so WhatsApp's own scripts can neither read the dialog nor press Pay.
   * Tests open the root and accept synthetic clicks.
   */
  constructor(options: {
    doc?: Document;
    onClosed?: () => void;
    shadowMode?: ShadowRootMode;
    requireTrusted?: boolean;
    /** Nostr profile search; without it the address prompt offers no search. */
    search?: (query: string) => Promise<ProfileResult[]>;
    /** Profile pictures as data: URLs (fetched by the background); initials without it. */
    avatar?: (url: string) => Promise<string | null>;
    /** A linked contact's current Nostr profile, for a picture that was not saved with the link. */
    profile?: (pubkey: string) => Promise<ProfileResult | null>;
    /** The Nostr WoT theme to draw in (see themes.ts); Nostr WoT Light without it. */
    theme?: () => ThemeId;
  } = {}) {
    this.doc = options.doc ?? document;
    this.onClosed = options.onClosed ?? (() => {});
    this.shadowMode = options.shadowMode ?? 'closed';
    this.requireTrusted = options.requireTrusted ?? true;
    this.search = options.search ?? null;
    this.avatar = options.avatar ?? null;
    this.profile = options.profile ?? null;
    this.theme = options.theme ?? null;
  }

  /** Run `handler` on click, but only for clicks a person made. */
  private onClick(el: HTMLElement, handler: () => void): void {
    el.addEventListener('click', event => {
      if (this.requireTrusted && !event.isTrusted) return;
      handler();
    });
  }

  get isOpen(): boolean {
    return this.host !== null;
  }

  private mount(): HTMLElement {
    if (this.card) return this.card;
    this.host = h('div', { 'data-whatsapp-zaps': '' });
    if (this.theme) this.host.dataset.theme = this.theme();
    const shadow = this.host.attachShadow({ mode: this.shadowMode });
    const backdrop = h('div', { class: 'backdrop' });
    this.card = h('div', { class: 'card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'WhatZaps' });
    backdrop.append(this.card);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) this.onCancel?.(); });
    // Keep keystrokes away from WhatsApp's global shortcuts while the dialog is open.
    backdrop.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') this.onCancel?.();
    });
    attachStyles(shadow, STYLE);
    shadow.append(backdrop);
    this.doc.body.append(this.host);
    return this.card;
  }

  private render(...children: Child[]): HTMLElement {
    const card = this.mount();
    card.replaceChildren(...children.filter((c): c is Node | string => !!c));
    // Every screen's header band gets the logo, and a close button while it can be dismissed.
    const title = card.querySelector('h2');
    if (title) {
      title.prepend(brandMark());
      if (this.onCancel) {
        const close = h('button', { type: 'button', class: 'close', 'aria-label': 'Close', title: 'Close' }, '×');
        this.onClick(close, () => this.onCancel?.());
        title.append(close);
      }
    }
    return card;
  }

  /**
   * A person's avatar: their Nostr picture when linked (saved with the link, or
   * fetched by their pubkey when it was not), otherwise their initial.
   */
  private personFace(name: string, person: PersonView | undefined, size: 'lg' | '' = ''): HTMLElement {
    const face = avatar(person?.nostr?.name ?? name);
    if (size) face.classList.add(size);
    if (person?.nostr?.picture) {
      this.loadPicture(face, person.nostr.picture);
    } else if (person?.pubkey && this.profile) {
      void this.profile(person.pubkey).then(p => this.loadPicture(face, p?.picture ?? null), () => {});
    }
    return face;
  }

  /** The person card: picture, name, Nostr badges and Lightning Address. */
  private personCard(name: string, person: PersonView | undefined, address: string): HTMLElement {
    const nostrName = person?.nostr?.name;
    return h('div', { class: 'person' },
      this.personFace(name, person, 'lg'),
      h('div', { class: 'who' },
        h('span', { class: 'name' }, name),
        h('span', { class: 'chips' },
          nostrName && nostrName !== name ? h('span', { class: 'muted' }, nostrName) : null,
          person?.nostr?.nip05 ? h('span', { class: 'chip verified' }, `✓ ${person.nostr.nip05}`) : null,
          person?.pubkey && !person.nostr?.nip05 ? h('span', { class: 'chip nostr' }, 'Nostr') : null),
        h('span', { class: 'ln' }, `⚡ ${address}`)));
  }

  private focusFirst(card: HTMLElement, selector = 'input, button.primary, button') {
    (card.querySelector(selector) as HTMLElement | null)?.focus();
  }

  showLoading(message: string): void {
    this.onCancel = null;
    const who = this.person;
    this.render(
      h('h2', {}, who ? `Zap ${who.name}` : 'Zap'),
      h('div', { class: 'loading', 'aria-live': 'polite' },
        who ? h('div', { class: 'ring' }, this.personFace(who.name, who.person, 'lg')) : h('span', { class: 'spinner' }),
        h('span', {}, message)),
    );
  }

  askAddress(name: string, chatTitle: string | null, error?: string): Promise<AddressAnswer | null> {
    return new Promise(resolve => {
      const input = h('input', {
        type: 'text', placeholder: 'name@wallet.com, npub… or a name', autocomplete: 'off', spellcheck: 'false',
        'aria-label': 'Lightning Address, or a Nostr name, npub or NIP-05 to search for',
      });
      const scopeName = 'scope';
      const radio = (value: string, text: string, checked = false) => {
        const r = h('input', { type: 'radio', name: scopeName, value });
        r.checked = checked;
        return h('label', { class: 'choice' }, r, text);
      };
      const message = h('p', { class: 'error', role: 'alert' }, error ?? '');
      const status = h('p', { class: 'muted', 'aria-live': 'polite' });
      const results = h('div', { class: 'results' });
      const cancel = h('button', { type: 'button' }, 'Cancel');
      const searchButton = h('button', { type: 'button' }, 'Search Nostr');
      const form = h('form', {},
        h('h2', {}, `Zap @${name}`),
        h('div', { class: 'intro' }, this.personFace(name, undefined),
          h('p', {}, `What is ${name}'s Lightning Address? Type it, or find ${name} on Nostr.`)),
        h('div', { class: 'row' }, input, this.search ? searchButton : null),
        status,
        results,
        chatTitle ? radio('chat', `Remember for “${chatTitle}”`, true) : null,
        radio('global', 'Remember in every chat', !chatTitle),
        radio('once', 'Use once, don’t remember'),
        message,
        h('div', { class: 'actions' }, cancel, h('button', { type: 'submit', class: 'primary' }, 'Continue')),
      );

      // Set when the address came from a search result; cleared if the user edits it.
      let picked: { pubkey: string; address: string; profile: ProfileResult } | null = null;
      let searchRun = 0;
      input.addEventListener('input', () => {
        if (picked && input.value.trim() !== picked.address) picked = null;
      });

      const runSearch = async () => {
        const query = input.value.trim();
        if (!this.search || !query) return;
        const run = ++searchRun;
        message.textContent = '';
        this.showSearching(status, results);
        try {
          const found = await this.search(query);
          if (run !== searchRun) return;
          this.showResults(found, status, results, input, profile => {
            input.value = profile.lud16!;
            picked = { pubkey: profile.pubkey, address: profile.lud16!, profile };
            status.textContent = `Selected ${profile.displayName ?? profile.name ?? shortNpub(profile.npub)} — ${profile.lud16}`;
            results.replaceChildren();
            input.focus();
          });
        } catch (err) {
          if (run !== searchRun) return;
          status.textContent = '';
          message.textContent = err instanceof Error ? err.message : String(err);
        }
      };

      const done = (value: AddressAnswer | null) => { searchRun++; this.onCancel = null; resolve(value); };
      this.onCancel = () => done(null);
      this.onClick(cancel, () => done(null));
      this.onClick(searchButton, () => { void runSearch(); });
      this.liveSearch(input, () => { void runSearch(); }, () => picked !== null && input.value.trim() === picked.address);
      const finish = (address: string, profile: ProfileResult | null) => {
        const choice = (form.querySelector(`input[name="${scopeName}"]:checked`) as HTMLInputElement | null)?.value;
        const from = profile ?? (picked && picked.address === address ? picked.profile : null);
        done({
          address,
          remember: choice === 'global' || choice === 'chat' ? choice : null,
          // Keep who they are on Nostr with the link: name, verified NIP-05, picture.
          ...(from ? {
            pubkey: from.pubkey,
            nostr: { name: from.displayName ?? from.name, nip05: from.nip05Verified ? from.nip05 : null, picture: from.picture },
          } : {}),
        });
      };
      // Addresses already checked and confirmed as plain Lightning Addresses.
      const plain = new Set<string>();
      form.addEventListener('submit', e => {
        e.preventDefault();
        if (this.requireTrusted && !e.isTrusted) return;
        const address = input.value.trim();
        if (!isLightningAddress(address)) {
          // Not an address: treat Enter as "search for this".
          if (this.search && address) { void runSearch(); return; }
          message.textContent = 'That is not a Lightning Address (name@domain).';
          input.focus();
          return;
        }
        if ((picked && picked.address === address) || plain.has(address)) { finish(address, null); return; }
        message.textContent = '';
        const run = ++searchRun;
        void this.checkTypedAddress(address, { status, results, isCurrent: () => run === searchRun }, {
          pick: profile => finish(profile.lud16!, profile),
          plain: () => { plain.add(address); finish(address, null); },
        });
      });
      this.focusFirst(this.render(form), 'input');
    });
  }

  link(view: LinkView, notice?: { text: string; error?: boolean }): Promise<LinkAnswer> {
    return new Promise(resolve => {
      const { contact } = view;
      const isGroup = contact.kind === 'group';
      const done = (value: LinkAnswer) => { searchRun++; this.onCancel = null; resolve(value); };
      this.onCancel = () => done(null);

      const unlinkButton = (member: LinkedMember, label: string) => {
        const b = h('button', { type: 'button', class: 'small' }, 'Unlink');
        b.setAttribute('aria-label', `Unlink ${label}`);
        this.onClick(b, () => done({ action: 'unlink', contactKey: member.contactKey }));
        return b;
      };

      // ── Who, and what they are linked to now ──
      const header: Child[] = isGroup
        ? [h('h2', {}, 'Nostr profiles'), h('p', { class: 'muted' }, `Members of ${contact.title}`)]
        : [h('h2', {}, 'Nostr profile'), h('p', {}, h('strong', {}, contact.name),
          contact.id ? h('span', { class: 'muted' }, ` · ${contact.id.replace(/@.*/, '')}`) : null)];

      let linked: Child;
      if (isGroup) {
        linked = view.members.length
          ? h('div', { class: 'linked' }, ...view.members.map(m => h('div', { class: 'link-row' },
            this.linkSummary(m.mapping, m.mapping.displayName), unlinkButton(m, m.mapping.displayName))))
          : h('p', { class: 'empty' }, 'No members of this group are linked yet.');
      } else {
        linked = view.current
          ? h('div', { class: 'linked' }, h('div', { class: 'link-row' },
            this.linkSummary(view.current.mapping, null), unlinkButton(view.current, contact.name)))
          : h('p', { class: 'empty' }, 'Not linked to a Nostr profile or Lightning Address yet.');
      }

      // ── Link a profile or an address ──
      const memberInput = isGroup
        ? h('input', { type: 'text', id: 'wz-member', placeholder: 'Name as shown in the group', autocomplete: 'off', 'aria-label': 'Member name' })
        : null;
      const input = h('input', {
        type: 'text', id: 'wz-query', autocomplete: 'off', spellcheck: 'false',
        placeholder: 'Name, npub, NIP-05 or Lightning Address',
        'aria-label': 'Search Nostr, or type a Lightning Address',
      });
      // Prefilled for convenience; nothing is searched until the person asks.
      if (!isGroup) input.value = contact.name;
      const status = h('p', { class: 'muted', 'aria-live': 'polite' });
      const results = h('div', { class: 'results' });
      const message = h('p', { class: notice?.error ? 'error' : 'ok', role: 'status' }, notice?.text ?? '');
      const searchButton = h('button', { type: 'button' }, 'Search Nostr');
      const close = h('button', { type: 'button' }, 'Close');
      const linkButton = h('button', { type: 'submit', class: 'primary' }, view.current ? 'Replace link' : 'Link');

      let picked: ProfileResult | null = null;
      let searchRun = 0;
      // Addresses already checked and confirmed as plain Lightning Addresses.
      const plain = new Set<string>();
      const pick = (profile: ProfileResult) => {
        picked = profile;
        input.value = profile.lud16!;
        if (memberInput && !memberInput.value.trim()) memberInput.value = profile.displayName ?? profile.name ?? '';
        status.textContent = `Selected ${profile.displayName ?? profile.name ?? shortNpub(profile.npub)} — ${profile.lud16}`;
        results.replaceChildren();
        refresh();
        linkButton.focus();
      };
      const finish = (profile: ProfileResult | null) => {
        const answer: LinkAnswer = { action: 'link', address: profile?.lud16 ?? input.value.trim() };
        if (memberInput) answer.memberName = memberInput.value.trim();
        if (profile) {
          answer.pubkey = profile.pubkey;
          answer.nostr = { name: profile.displayName ?? profile.name, nip05: profile.nip05Verified ? profile.nip05 : null, picture: profile.picture };
        }
        done(answer);
      };
      const refresh = () => {
        const value = input.value.trim();
        if (picked && value !== picked.lud16) picked = null;
        linkButton.disabled = !picked && !isLightningAddress(value);
      };
      input.addEventListener('input', refresh);

      const runSearch = async () => {
        const query = input.value.trim();
        if (!this.search || !query) return;
        const run = ++searchRun;
        this.showSearching(status, results);
        try {
          const found = await this.search(query);
          if (run !== searchRun) return;
          this.showResults(found, status, results, input, pick);
        } catch (err) {
          if (run !== searchRun) return;
          status.textContent = err instanceof Error ? err.message : String(err);
        }
      };

      const form = h('form', {},
        ...header,
        linked,
        h('h3', {}, isGroup ? 'Link a member' : view.current ? 'Change link' : 'Link'),
        memberInput,
        h('div', { class: 'row' }, input, this.search ? searchButton : null),
        status,
        results,
        message,
        h('p', { class: 'muted small-print' },
          'Links are saved only in this browser. Searching sends what you type to public Nostr relays.'),
        h('div', { class: 'actions' }, close, linkButton),
      );
      this.onClick(close, () => done(null));
      this.onClick(searchButton, () => { void runSearch(); });
      this.liveSearch(input, () => { void runSearch(); }, () => picked !== null && input.value.trim() === picked.lud16);
      form.addEventListener('submit', e => {
        e.preventDefault();
        if (this.requireTrusted && !e.isTrusted) return;
        const address = input.value.trim();
        if (!picked && !isLightningAddress(address)) { void runSearch(); return; }
        if (picked || plain.has(address)) { finish(picked); return; }
        const run = ++searchRun;
        void this.checkTypedAddress(address, { status, results, isCurrent: () => run === searchRun }, {
          pick: profile => finish(profile),
          plain: () => { plain.add(address); finish(null); },
        });
      });
      refresh();
      this.focusFirst(this.render(form), isGroup ? '#wz-member' : '#wz-query');
    });
  }

  /**
   * A typed `name@domain` can be a NIP-05 Nostr address rather than a
   * Lightning Address: the two look the same, but a NIP-05 server usually has
   * no Lightning support and answers 404. So look it up on Nostr first. When it
   * is the verified NIP-05 of a profile with a Lightning Address, that profile
   * is used (`pick`) — the person meant them, and the Lightning Address shown
   * from here on is the profile's. Otherwise the text is used as typed (`plain`).
   */
  private async checkTypedAddress(
    address: string,
    ui: { status: HTMLElement; results: HTMLElement; isCurrent: () => boolean },
    on: { pick: (p: ProfileResult) => void; plain: () => void },
  ): Promise<void> {
    if (!this.search) { on.plain(); return; }
    ui.status.textContent = `Checking ${address}…`;
    ui.results.replaceChildren();
    let found: ProfileResult[] = [];
    try {
      found = await this.search(address);
    } catch {
      // Lookup trouble is not a reason to refuse what was typed.
    }
    if (!ui.isCurrent()) return;
    const lower = address.toLowerCase();
    const profile = found.find(p => p.lud16 && (p.lud16 === lower || (p.nip05Verified && p.nip05 === lower)));
    ui.status.textContent = '';
    if (profile) on.pick(profile);
    else on.plain();
  }

  /** A saved link: the Nostr name and verified NIP-05 when there is one, the npub, the address. */
  private linkSummary(mapping: Mapping, member: string | null): HTMLElement {
    const npub = mapping.pubkey ? npubEncode(mapping.pubkey) : null;
    const npubEl = npub ? h('span', { class: 'muted mono' }, shortNpub(npub)) : null;
    if (npubEl && npub) npubEl.title = npub;
    const title = member ?? mapping.nostr?.name ?? (npub ? 'Nostr profile' : 'Lightning Address');
    const face = this.personFace(member ?? mapping.nostr?.name ?? mapping.address, { pubkey: mapping.pubkey ?? null, nostr: mapping.nostr ?? null });
    return h('div', { class: 'who-row' },
      face,
      h('div', { class: 'who' },
        h('div', { class: 'chips' },
          h('span', { class: 'name' }, title),
          member && mapping.nostr?.name ? h('span', { class: 'muted' }, ` · ${mapping.nostr.name}`) : null,
          mapping.nostr?.nip05 ? h('span', { class: 'chip verified' }, ` ✓ ${mapping.nostr.nip05}`) : null),
        npubEl,
        h('span', { class: 'ln' }, `⚡ ${mapping.address}`),
      ),
    );
  }

  /**
   * Search as the person types: after a pause, from two characters. Only typing
   * starts it; text that was filled in for them (a contact's name) is never sent
   * to the relays until they edit it or press Search. `settled` skips searching
   * when the text is a result they just picked.
   */
  private liveSearch(input: HTMLInputElement, run: () => void, settled: () => boolean): void {
    if (!this.search) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    input.addEventListener('input', event => {
      if (this.requireTrusted && !event.isTrusted) return;
      clearTimeout(timer);
      if (input.value.trim().length < 2 || settled()) return;
      timer = setTimeout(run, 450);
    });
    // Down arrow moves from the search box into the results.
    input.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown') return;
      const first = input.closest('form')?.querySelector<HTMLButtonElement>('.results button.option:not(:disabled)');
      if (first) { event.preventDefault(); first.focus(); }
    });
  }

  private showSearching(status: HTMLElement, results: HTMLElement): void {
    status.textContent = 'Searching Nostr…';
    results.replaceChildren(...[0, 1, 2].map(() => h('div', { class: 'skeleton', 'aria-hidden': 'true' },
      h('span', { class: 'avatar skeleton-dot' }), h('span', { class: 'skeleton-lines' }, h('span'), h('span')))));
  }

  /**
   * Show results: payable profiles, with those that have no Lightning Address
   * folded away behind a button (they cannot be paid). Arrow keys move between
   * results; Enter picks one.
   */
  private showResults(found: ProfileResult[], status: HTMLElement, results: HTMLElement, input: HTMLInputElement, onPick: (p: ProfileResult) => void): void {
    const payable = found.filter(p => p.lud16);
    const unpayable = found.filter(p => !p.lud16);
    status.textContent = payable.length
      ? (payable.some(p => p.followed) ? 'People you follow come first. ' : '') + 'Check the npub if names look alike.'
      : found.length ? 'None of these profiles has a Lightning Address.' : 'No Nostr profiles found.';
    const items: Child[] = payable.map(p => this.profileOption(p, () => onPick(p)));
    if (unpayable.length) {
      const more = h('button', { type: 'button', class: 'small more' },
        `Show ${unpayable.length} without a Lightning Address`);
      this.onClick(more, () => { more.replaceWith(...unpayable.map(p => this.profileOption(p, () => {}))); });
      items.push(payable.length ? more : null, ...(payable.length ? [] : unpayable.map(p => this.profileOption(p, () => {}))));
    }
    results.replaceChildren(...items.filter((c): c is HTMLElement => !!c));
    results.onkeydown = event => {
      const options = [...results.querySelectorAll<HTMLButtonElement>('button.option:not(:disabled)')];
      const at = options.indexOf(event.target as HTMLButtonElement);
      if (at < 0) return;
      if (event.key === 'ArrowDown' && at < options.length - 1) { event.preventDefault(); options[at + 1].focus(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); (at > 0 ? options[at - 1] : input).focus(); }
    };
  }

  /** Swap the initial for the profile picture once the background has fetched it. */
  private loadPicture(avatarEl: HTMLElement, url: string | null): void {
    if (!url || !this.avatar) return;
    void this.avatar(url).then(data => {
      if (!data || !avatarEl.isConnected) return;
      const img = h('img', { alt: '', src: data });
      img.addEventListener('error', () => img.remove());
      avatarEl.append(img);
    }, () => {});
  }

  /** One search result as a button; profiles without a Lightning Address are shown but disabled. */
  private profileOption(profile: ProfileResult, onPick: () => void): HTMLElement {
    const title = profile.displayName ?? profile.name ?? 'Unnamed profile';
    const face = avatar(title);
    this.loadPicture(face, profile.picture);
    const button = h('button', { type: 'button', class: 'option' },
      face,
      h('span', { class: 'who' },
        h('span', { class: 'chips' },
          h('span', { class: 'name' }, title),
          profile.name ? h('span', { class: 'muted' }, ` @${profile.name}`) : null,
          profile.followed ? h('span', { class: 'chip follows' }, 'You follow') : null),
        profile.nip05
          ? h('span', { class: 'chips' }, profile.nip05Verified
            ? h('span', { class: 'chip verified' }, `✓ ${profile.nip05}`)
            : h('span', { class: 'chip unverified' }, `${profile.nip05} (not verified)`))
          : null,
        h('span', { class: 'muted mono' }, shortNpub(profile.npub)),
        profile.lud16 ? h('span', { class: 'ln' }, `⚡ ${profile.lud16}`) : h('span', { class: 'ln none' }, 'No Lightning Address'),
      ),
    );
    button.title = profile.npub;
    if (profile.lud16) this.onClick(button, onPick);
    else button.disabled = true;
    return button;
  }

  choose(name: string, candidates: Candidate[]): Promise<Candidate | null> {
    return new Promise(resolve => {
      const done = (value: Candidate | null) => { this.onCancel = null; resolve(value); };
      this.onCancel = () => done(null);
      const options = candidates.map(c => {
        const b = h('button', { type: 'button', class: 'option' },
          this.personFace(c.mapping.displayName, { pubkey: c.mapping.pubkey ?? null, nostr: c.mapping.nostr ?? null }),
          h('span', { class: 'who' },
            h('span', { class: 'name' }, c.mapping.displayName),
            c.mapping.nostr?.nip05 ? h('span', { class: 'chips' }, h('span', { class: 'chip verified' }, `✓ ${c.mapping.nostr.nip05}`)) : null,
            h('span', { class: 'ln' }, `⚡ ${c.mapping.address}`)));
        this.onClick(b, () => done(c));
        return b;
      });
      const cancel = h('button', { type: 'button' }, 'Cancel');
      this.onClick(cancel, () => done(null));
      this.focusFirst(this.render(
        h('h2', {}, `Which ${name}?`),
        h('p', { class: 'muted' }, 'More than one saved contact has this name.'),
        h('div', { class: 'results' }, ...options),
        h('div', { class: 'actions' }, cancel),
      ), 'button.option');
    });
  }

  confirm(details: ConfirmDetails): Promise<ConfirmAnswer> {
    this.person = { name: details.name, person: details.person };
    return new Promise(resolve => {
      const done = (value: ConfirmAnswer) => { this.onCancel = null; resolve(value); };
      this.onCancel = () => done(false);
      const cancel = h('button', { type: 'button' }, 'Cancel');
      const pay = h('button', { type: 'button', class: 'primary' }, `Pay ${sats(details.amountSats)}`);
      const post = h('input', { type: 'checkbox', id: 'wz-post', class: 'switch', role: 'switch' });
      post.checked = details.postByDefault;
      this.onClick(cancel, () => done(false));
      this.onClick(pay, () => done({ post: details.chatMessage !== null && post.checked }));
      const { recipient } = details;
      this.focusFirst(this.render(
        h('h2', {}, 'Confirm zap'),
        // The amount first, then who: "21 sats to <person>".
        h('div', { class: 'hero' },
          h('span', { class: 'amount' }, h('span', { class: 'bolt', 'aria-hidden': 'true' }, '⚡'),
            details.amountSats.toLocaleString('en-US'), h('span', { class: 'unit' }, 'sats'))),
        h('p', { class: 'to' }, 'to'),
        this.personCard(details.name, details.person, recipient.address),
        details.comment ? h('div', { class: 'bubble', title: 'Your comment, sent with the payment' }, details.comment) : null,
        details.comment && recipient.commentAllowed === 0
          ? h('p', { class: 'warn' }, 'This address does not accept comments; it will not be sent.') : null,
        details.comment && recipient.commentAllowed > 0 && details.comment.length > recipient.commentAllowed
          ? h('p', { class: 'warn' }, `The comment will be cut to ${recipient.commentAllowed} characters.`) : null,
        recipient.description ? h('p', { class: 'says' }, `Recipient says: ${recipient.description}`) : null,
        details.reason ? h('p', { class: 'muted' }, details.reason) : null,
        details.chatMessage ? h('label', { class: 'post', for: 'wz-post' },
          h('span', {}, 'Post in the chat once the payment is confirmed',
            h('span', { class: 'preview' }, ...previewParts(details.chatMessage))),
          post) : null,
        h('p', { class: 'muted' }, 'Your Nostr WoT wallet pays this and may ask you to approve it.'),
        h('div', { class: 'actions' }, cancel, pay),
      ), 'button.primary');
    });
  }

  confirmRepeat(minutesAgo: number, details: { name: string; amountSats: number; reaction?: boolean }): Promise<boolean> {
    return new Promise(resolve => {
      const done = (value: boolean) => { this.onCancel = null; resolve(value); };
      this.onCancel = () => done(false);
      const stop = h('button', { type: 'button', class: 'primary' }, 'Don’t pay again');
      const again = h('button', { type: 'button' }, 'Pay again');
      this.onClick(stop, () => done(false));
      this.onClick(again, () => done(true));
      const when = minutesAgo < 1 ? 'less than a minute ago' : minutesAgo === 1 ? 'a minute ago' : `${minutesAgo} minutes ago`;
      this.focusFirst(this.render(
        h('h2', {}, 'Already paid'),
        h('div', { class: 'result' }, h('div', { class: 'face' }, this.personFace(details.name, this.person?.person, 'lg'),
          h('span', { class: 'badge unsure', 'aria-hidden': 'true' }, '!'))),
        h('div', { class: 'state unsure' },
          h('p', {}, 'You paid ', h('strong', {}, sats(details.amountSats)), ` to ${details.name} ${details.reaction ? 'for a ⚡ reaction to this same message' : 'with this same command'} ${when}.`)),
        h('p', {}, details.reaction
          ? 'Pay again only if you mean to send a second zap.'
          : 'Pay again only if you mean to send a second zap. “Don’t pay again” removes the command from the message box.'),
        h('div', { class: 'actions' }, again, stop),
      ), 'button.primary');
    });
  }

  showResult(outcome: PayOutcome, details: ConfirmDetails, aftermath: ChatAftermath | null): Promise<void> {
    return new Promise(resolve => {
      const done = () => { this.onCancel = null; resolve(); };
      this.onCancel = done;
      const close = h('button', { type: 'button', class: 'primary' }, 'Close');
      this.onClick(close, done);
      let body: Child[];
      if (outcome.outcome === 'paid') {
        const notes: Child[] = [];
        if (aftermath?.message === 'sent') {
          notes.push(h('p', { class: 'muted' }, 'Posted in the chat: ', h('span', { class: 'preview-inline' }, ...previewParts(details.chatMessage!))));
        } else if (aftermath?.message === 'not_sent') {
          const copy = h('button', { type: 'button', class: 'small' }, 'Copy');
          this.onClick(copy, () => {
            void navigator.clipboard?.writeText(details.chatMessage!.text).then(() => { copy.textContent = 'Copied'; }, () => {});
          });
          notes.push(
            h('p', { class: 'warn' }, 'The message could not be posted in the chat. Copy it and send it yourself:'),
            h('div', { class: 'copy-box' }, h('output', {}, details.chatMessage!.text), copy),
          );
        }
        if (aftermath && !aftermath.commandCleared) {
          notes.push(h('div', { class: 'state bad' }, h('p', { class: 'error', role: 'alert' },
            'The /zap command is still in the message box. Delete it before you press Enter — sending it again would start another zap.')));
        }
        body = [
          h('h2', {}, 'Zap sent'),
          this.resultHead(details, 'good', '✓'),
          h('div', { class: 'state good' },
            h('p', {}, h('strong', {}, sats(details.amountSats)), ` to ${details.name} (${details.recipient.address}). Payment confirmed.`)),
          ...notes,
          h('div', { class: 'actions' }, close),
        ];
      } else if (outcome.outcome === 'not_paid') {
        body = [
          h('h2', {}, 'Zap not sent'),
          this.resultHead(details, 'bad', '✕'),
          h('div', { class: 'state bad' }, h('p', { class: 'error', role: 'alert' }, outcome.error)),
          h('p', { class: 'muted' }, 'Nothing was paid and nothing was posted. Your command is still in the message box.'),
          h('div', { class: 'actions' }, close),
        ];
      } else {
        body = [
          h('h2', {}, 'Payment status unknown'),
          this.resultHead(details, 'unsure', '?'),
          h('div', { class: 'state unsure' }, h('p', { class: 'warn', role: 'alert' }, outcome.error)),
          h('p', {}, 'The payment may have gone through, so nothing was posted. Check your wallet’s activity in Nostr WoT before you try again — sending the command again would be a second payment.'),
          h('div', { class: 'actions' }, close),
        ];
      }
      this.focusFirst(this.render(...body), 'button.primary');
    });
  }

  /** The person's picture with a ✓ / ✕ / ? badge, above a result. */
  private resultHead(details: ConfirmDetails, tone: 'good' | 'bad' | 'unsure', mark: string): HTMLElement {
    return h('div', { class: 'result' },
      h('div', { class: 'face' }, this.personFace(details.name, details.person, 'lg'),
        h('span', { class: `badge ${tone}`, 'aria-hidden': 'true' }, mark)));
  }

  showError(message: string): Promise<void> {
    return new Promise(resolve => {
      const close = h('button', { type: 'button', class: 'primary' }, 'Close');
      const done = () => { this.onCancel = null; resolve(); };
      this.onCancel = done;
      this.onClick(close, done);
      this.focusFirst(this.render(
        h('h2', {}, 'Zap not sent'),
        h('div', { class: 'state bad' }, h('p', { class: 'error', role: 'alert' }, message)),
        h('div', { class: 'actions' }, close),
      ), 'button');
    });
  }

  close(): void {
    this.person = null;
    this.host?.remove();
    this.host = null;
    this.card = null;
    this.onCancel = null;
    this.onClosed();
  }
}
