/**
 * The zap dialog: a shadow-DOM overlay so WhatsApp's CSS cannot reach it and
 * its CSS cannot reach WhatsApp. All user and server text goes in through
 * textContent / value, never innerHTML.
 */
import { isLightningAddress } from '../domain/lnurl.ts';
import type { PayOutcome } from '../domain/bridge.ts';
import type { AddressAnswer, Candidate, ConfirmDetails, ZapUi } from '../flow.ts';
import { shortNpub, type ProfileResult } from '../domain/nostr.ts';
import { npubEncode } from 'nostr-tools/nip19';
import type { Mapping } from '../domain/mappings.ts';
import type { LinkAnswer, LinkUi, LinkView, LinkedMember } from '../linkFlow.ts';
import { attachStyles } from './styles.ts';

const STYLE = `
:host { all: initial; }
.backdrop {
  /* Zap violet on WhatsApp's own neutrals, so the overlay feels native in either theme. */
  --card: #ffffff; --fg: #111b21; --muted: #667781; --line: #e9e4f5; --field: #ffffff;
  --tint: #f5f1ff; --tint-line: #e2d9fb;
  --zap: #7c3aed; --zap-strong: #6d28d9; --zap-fg: #ffffff; --zap-soft: #ede7fe;
  --ok: #0a7d5a; --ok-soft: #e3f6ee; --warn: #9a5b00; --warn-soft: #fff4e0; --bad: #c62828; --bad-soft: #fdecea;
  --scrim: rgba(17, 27, 33, .5); --shadow: 0 24px 60px rgba(32, 16, 64, .28);
  position: fixed; inset: 0; z-index: 2147483646;
  display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box;
  background: var(--scrim); backdrop-filter: blur(2px);
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  .backdrop {
    --card: #1f2c34; --fg: #e9edef; --muted: #8696a0; --line: #2f3d46; --field: #111b21;
    --tint: #261f3d; --tint-line: #3a2f5c;
    --zap: #a78bfa; --zap-strong: #c4b5fd; --zap-fg: #1a1033; --zap-soft: #2e2550;
    --ok: #34d399; --ok-soft: #12352b; --warn: #fbbf24; --warn-soft: #3a2c0c; --bad: #f28b82; --bad-soft: #3d1f1d;
    --scrim: rgba(0, 0, 0, .6); --shadow: 0 24px 60px rgba(0, 0, 0, .55);
    color-scheme: dark;
  }
}
.card {
  background: var(--card); color: var(--fg);
  width: min(440px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; box-sizing: border-box;
  border-radius: 16px; padding: 0 20px 20px; box-shadow: var(--shadow);
  border: 1px solid var(--line);
}
/* The first heading is the dialog's header band. */
h2 {
  display: flex; align-items: center; gap: 10px;
  margin: 0 -20px 16px; padding: 14px 20px;
  background: var(--tint); border-bottom: 1px solid var(--tint-line);
  font-size: 16px; font-weight: 650; letter-spacing: -.01em;
  position: sticky; top: 0; z-index: 1;
}
h2::before {
  content: "⚡"; display: inline-grid; place-items: center; flex: none;
  width: 28px; height: 28px; border-radius: 8px;
  background: var(--zap); color: var(--zap-fg); font-size: 15px;
}
h3 { margin: 18px 0 8px; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
p { margin: 0 0 12px; }
form { display: block; }
.muted { color: var(--muted); font-size: 13px; }
.small-print { font-size: 12px; margin-top: 4px; }
.error { color: var(--bad); }
.warn { color: var(--warn); }
.ok { color: var(--ok); }
.error:empty, .ok:empty, .muted:empty { display: none; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }

input[type="text"] {
  width: 100%; box-sizing: border-box; height: 40px; padding: 0 12px; margin: 0;
  border: 1.5px solid var(--line); border-radius: 10px; background: var(--field); color: var(--fg); font: inherit;
  transition: border-color .15s;
}
input[type="text"]:focus { outline: none; border-color: var(--zap); box-shadow: 0 0 0 3px var(--zap-soft); }
input[type="radio"] { accent-color: var(--zap); margin: 0; }
label.choice { display: flex; gap: 10px; align-items: center; padding: 6px 2px; cursor: pointer; }
.row { display: flex; gap: 8px; align-items: center; margin: 0 0 10px; }
.row input { flex: 1; min-width: 0; }
#wz-member { margin-bottom: 10px; }

button {
  font: inherit; font-weight: 550; border-radius: 999px; padding: 0 16px; height: 36px; cursor: pointer;
  border: 1.5px solid var(--line); background: transparent; color: var(--fg); white-space: nowrap;
  transition: background .15s, border-color .15s, transform .05s;
}
button:hover:not(:disabled) { border-color: var(--zap); color: var(--zap-strong); }
button:active:not(:disabled) { transform: translateY(1px); }
button.primary { background: var(--zap); border-color: var(--zap); color: var(--zap-fg); }
button.primary:hover:not(:disabled) { background: var(--zap-strong); border-color: var(--zap-strong); color: var(--zap-fg); }
button.small { height: 30px; padding: 0 12px; font-size: 13px; flex: none; }
button:disabled { opacity: .45; cursor: default; }
button:focus-visible, label.choice:focus-within { outline: 2px solid var(--zap); outline-offset: 2px; }

.actions {
  display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap;
  position: sticky; bottom: -20px; z-index: 1;
  margin: 16px -20px -20px; padding: 12px 20px;
  background: var(--card); border-top: 1px solid var(--line);
}

/* People: search results, saved links, name pickers. */
.results { display: grid; gap: 6px; max-height: 300px; overflow-y: auto; margin: 0 0 10px; }
.results:empty { display: none; }
button.option {
  display: flex; gap: 12px; align-items: flex-start; width: 100%; height: auto; text-align: left;
  padding: 10px 12px; border-radius: 12px; border: 1.5px solid var(--line); white-space: normal; font-weight: 400;
}
button.option:hover:not(:disabled) { background: var(--tint); border-color: var(--zap); color: var(--fg); }
button.option:disabled { opacity: .55; }
.avatar {
  flex: none; width: 36px; height: 36px; border-radius: 50%;
  display: grid; place-items: center; font-weight: 700; font-size: 15px; color: #fff; text-transform: uppercase;
}
.hue-0 { background: #7c3aed; } .hue-1 { background: #0e7490; } .hue-2 { background: #b45309; }
.hue-3 { background: #be185d; } .hue-4 { background: #15803d; } .hue-5 { background: #4338ca; }
.who { display: grid; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.who .name { font-weight: 600; }
.chips { display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; }
.chip { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 550; }
.verified { color: var(--ok); }
.chip.verified { background: var(--ok-soft); }
.chip.unverified { background: var(--line); color: var(--muted); }
.ln { color: var(--zap-strong); font-weight: 550; }
.ln.none { color: var(--muted); font-weight: 400; }
.linked { display: grid; gap: 8px; margin: 0 0 4px; }
.link-row {
  display: flex; gap: 12px; align-items: center;
  padding: 12px; border-radius: 12px; background: var(--tint); border: 1px solid var(--tint-line);
}
.link-row .who-row { flex: 1; }
.who-row { display: flex; gap: 12px; align-items: flex-start; min-width: 0; }
.empty { padding: 12px; border-radius: 12px; border: 1.5px dashed var(--line); color: var(--muted); font-size: 13px; margin: 0 0 4px; }

/* Confirm: the amount is the point. */
.amount-panel {
  display: grid; justify-items: center; gap: 2px; padding: 18px 12px; margin: 0 0 14px;
  border-radius: 14px; background: var(--tint); border: 1px solid var(--tint-line);
}
.amount { font-size: 34px; font-weight: 750; letter-spacing: -.02em; color: var(--zap-strong); font-variant-numeric: tabular-nums; line-height: 1.1; }
.amount-to { color: var(--muted); font-size: 13px; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; margin: 0 0 14px; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }

/* Outcomes. */
.state { display: flex; gap: 12px; align-items: flex-start; padding: 12px; border-radius: 12px; margin: 0 0 12px; }
.state::before { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; font-weight: 700; }
.state.good { background: var(--ok-soft); } .state.good::before { content: "✓"; background: var(--ok); color: var(--card); }
.state.unsure { background: var(--warn-soft); } .state.unsure::before { content: "?"; background: var(--warn); color: var(--card); }
.state.bad { background: var(--bad-soft); } .state.bad::before { content: "!"; background: var(--bad); color: var(--card); }
.state p { margin: 0; }

.loading { display: flex; gap: 12px; align-items: center; color: var(--muted); padding: 8px 0 4px; }
.spinner { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--zap-soft); border-top-color: var(--zap); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } * { transition: none !important; } }
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

/** A round initial, coloured from a stable key so the same person keeps the same colour. */
function avatar(label: string, key: string): HTMLElement {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const initial = [...label.replace(/^[^\p{L}\p{N}]+/u, '')][0] ?? '?';
  return h('span', { class: `avatar hue-${hash % 6}`, 'aria-hidden': 'true' }, initial);
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
  } = {}) {
    this.doc = options.doc ?? document;
    this.onClosed = options.onClosed ?? (() => {});
    this.shadowMode = options.shadowMode ?? 'closed';
    this.requireTrusted = options.requireTrusted ?? true;
    this.search = options.search ?? null;
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
    const shadow = this.host.attachShadow({ mode: this.shadowMode });
    const backdrop = h('div', { class: 'backdrop' });
    this.card = h('div', { class: 'card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Zap' });
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
    return card;
  }

  private focusFirst(card: HTMLElement, selector = 'input, button.primary, button') {
    (card.querySelector(selector) as HTMLElement | null)?.focus();
  }

  showLoading(message: string): void {
    this.onCancel = null;
    this.render(h('h2', {}, 'Zap'), h('div', { class: 'loading', 'aria-live': 'polite' }, h('span', { class: 'spinner' }), message));
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
        h('p', {}, `What is ${name}'s Lightning Address? Type it, or find ${name} on Nostr.`),
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
      let picked: { pubkey: string; address: string } | null = null;
      let searchRun = 0;
      input.addEventListener('input', () => {
        if (picked && input.value.trim() !== picked.address) picked = null;
      });

      const runSearch = async () => {
        const query = input.value.trim();
        if (!this.search || !query) return;
        const run = ++searchRun;
        message.textContent = '';
        status.textContent = 'Searching Nostr…';
        results.replaceChildren();
        try {
          const found = await this.search(query);
          if (run !== searchRun) return;
          status.textContent = found.length ? 'Pick the right person. Check the npub if names look alike.' : 'No Nostr profiles found.';
          results.replaceChildren(...found.map(profile => this.profileOption(profile, () => {
            input.value = profile.lud16!;
            picked = { pubkey: profile.pubkey, address: profile.lud16! };
            status.textContent = `Selected ${profile.displayName ?? profile.name ?? shortNpub(profile.npub)} — ${profile.lud16}`;
            results.replaceChildren();
            input.focus();
          })));
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
      const finish = (address: string, profile: ProfileResult | null) => {
        const choice = (form.querySelector(`input[name="${scopeName}"]:checked`) as HTMLInputElement | null)?.value;
        done({
          address,
          remember: choice === 'global' || choice === 'chat' ? choice : null,
          ...(profile ? { pubkey: profile.pubkey } : picked && picked.address === address ? { pubkey: picked.pubkey } : {}),
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
          answer.nostr = { name: profile.displayName ?? profile.name, nip05: profile.nip05Verified ? profile.nip05 : null };
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
        status.textContent = 'Searching Nostr…';
        results.replaceChildren();
        try {
          const found = await this.search(query);
          if (run !== searchRun) return;
          status.textContent = found.length ? 'Pick the right person. Check the npub if names look alike.' : 'No Nostr profiles found.';
          results.replaceChildren(...found.map(profile => this.profileOption(profile, () => pick(profile))));
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
    return h('div', { class: 'who-row' },
      avatar(member ?? mapping.nostr?.name ?? mapping.address, mapping.pubkey ?? mapping.address),
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

  /** One search result as a button; profiles without a Lightning Address are shown but disabled. */
  private profileOption(profile: ProfileResult, onPick: () => void): HTMLElement {
    const title = profile.displayName ?? profile.name ?? 'Unnamed profile';
    const button = h('button', { type: 'button', class: 'option' },
      avatar(title, profile.pubkey),
      h('span', { class: 'who' },
        h('span', { class: 'chips' },
          h('span', { class: 'name' }, title),
          profile.name ? h('span', { class: 'muted' }, ` @${profile.name}`) : null),
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
          avatar(c.mapping.displayName, c.mapping.pubkey ?? c.mapping.address),
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

  confirm(details: ConfirmDetails): Promise<boolean> {
    return new Promise(resolve => {
      const done = (value: boolean) => { this.onCancel = null; resolve(value); };
      this.onCancel = () => done(false);
      const cancel = h('button', { type: 'button' }, 'Cancel');
      const pay = h('button', { type: 'button', class: 'primary' }, `Pay ${sats(details.amountSats)}`);
      this.onClick(cancel, () => done(false));
      this.onClick(pay, () => done(true));
      const { recipient } = details;
      this.focusFirst(this.render(
        h('h2', {}, 'Confirm zap'),
        h('div', { class: 'amount-panel' },
          h('span', { class: 'amount' }, sats(details.amountSats)),
          h('span', { class: 'amount-to' }, `to ${details.name}`)),
        h('dl', {},
          h('dt', {}, 'To'), h('dd', {}, details.name),
          h('dt', {}, 'Address'), h('dd', { class: 'ln' }, recipient.address),
          details.comment ? h('dt', {}, 'Comment') : null,
          details.comment ? h('dd', {}, details.comment) : null,
          recipient.description ? h('dt', {}, 'Recipient says') : null,
          recipient.description ? h('dd', { class: 'muted' }, recipient.description) : null,
        ),
        details.comment && recipient.commentAllowed === 0
          ? h('p', { class: 'warn' }, 'This address does not accept comments; it will not be sent.') : null,
        details.comment && recipient.commentAllowed > 0 && details.comment.length > recipient.commentAllowed
          ? h('p', { class: 'warn' }, `The comment will be cut to ${recipient.commentAllowed} characters.`) : null,
        h('p', { class: 'muted' }, 'Your Nostr WoT wallet pays this and may ask you to approve it.'),
        h('div', { class: 'actions' }, cancel, pay),
      ), 'button.primary');
    });
  }

  showResult(outcome: PayOutcome, details: ConfirmDetails): Promise<'insert' | 'close'> {
    return new Promise(resolve => {
      const done = (value: 'insert' | 'close') => { this.onCancel = null; resolve(value); };
      this.onCancel = () => done('close');
      const close = h('button', { type: 'button', class: outcome.outcome === 'paid' ? '' : 'primary' }, 'Close');
      this.onClick(close, () => done('close'));
      let body: Child[];
      if (outcome.outcome === 'paid') {
        const insert = h('button', { type: 'button', class: 'primary' }, 'Add message to chat');
        this.onClick(insert, () => done('insert'));
        body = [
          h('h2', {}, 'Zap sent'),
          h('div', { class: 'state good' },
            h('p', {}, h('strong', {}, sats(details.amountSats)), ` to ${details.name} (${details.recipient.address}).`)),
          h('p', { class: 'muted' }, 'Add a message to the chat? You can edit it before sending.'),
          h('div', { class: 'actions' }, close, insert),
        ];
      } else if (outcome.outcome === 'not_paid') {
        body = [
          h('h2', {}, 'Zap not sent'),
          h('div', { class: 'state bad' }, h('p', { class: 'error', role: 'alert' }, outcome.error)),
          h('p', { class: 'muted' }, 'Nothing was paid. Your command is still in the message box.'),
          h('div', { class: 'actions' }, close),
        ];
      } else {
        body = [
          h('h2', {}, 'Payment status unknown'),
          h('div', { class: 'state unsure' }, h('p', { class: 'warn', role: 'alert' }, outcome.error)),
          h('p', {}, 'The payment may have gone through. Check your wallet’s activity in Nostr WoT before you try again — sending the command again would be a second payment.'),
          h('div', { class: 'actions' }, close),
        ];
      }
      this.focusFirst(this.render(...body), 'button.primary');
    });
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
    this.host?.remove();
    this.host = null;
    this.card = null;
    this.onCancel = null;
    this.onClosed();
  }
}
