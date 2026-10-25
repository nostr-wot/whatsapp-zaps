/**
 * The zap dialog: a shadow-DOM overlay so WhatsApp's CSS cannot reach it and
 * its CSS cannot reach WhatsApp. All user and server text goes in through
 * textContent / value, never innerHTML.
 */
import { isLightningAddress } from '../domain/lnurl.ts';
import type { PayOutcome } from '../domain/bridge.ts';
import type { AddressAnswer, Candidate, ConfirmDetails, ZapUi } from '../flow.ts';
import { shortNpub, type ProfileResult } from '../domain/nostr.ts';

const STYLE = `
:host { all: initial; }
.backdrop {
  --bg: #ffffff; --fg: #111b21; --muted: #54656f; --line: #e9edef;
  --accent: #f7931a; --accent-fg: #111b21; --danger: #d93025; --warn: #b26a00; --ok: #00806a;
  position: fixed; inset: 0; z-index: 2147483646;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  .backdrop { --bg: #233138; --fg: #e9edef; --muted: #aebac1; --line: #3b4a54; --danger: #f28b82; --warn: #fdd663; --ok: #00c79c; }
}
.card {
  background: var(--bg); color: var(--fg);
  width: min(420px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto; box-sizing: border-box;
  border-radius: 12px; padding: 20px; box-shadow: 0 12px 40px rgba(0,0,0,.3);
}
h2 { margin: 0 0 12px; font-size: 17px; font-weight: 600; }
p { margin: 0 0 12px; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0 0 16px; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }
.amount { font-size: 22px; font-weight: 600; }
.muted { color: var(--muted); font-size: 13px; }
.error { color: var(--danger); }
.warn { color: var(--warn); }
input[type="text"] {
  width: 100%; box-sizing: border-box; padding: 9px 10px; margin: 0 0 10px;
  border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--fg); font: inherit;
}
label.choice { display: flex; gap: 8px; align-items: center; margin: 0 0 6px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
button {
  font: inherit; border-radius: 18px; padding: 7px 16px; cursor: pointer;
  border: 1px solid var(--line); background: transparent; color: var(--fg);
}
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); font-weight: 600; }
button.option { display: block; width: 100%; text-align: left; border-radius: 8px; margin: 0 0 6px; }
button.option:disabled { opacity: .55; cursor: default; }
.row { display: flex; gap: 8px; align-items: flex-start; }
.row input { flex: 1; }
.results { max-height: 260px; overflow-y: auto; margin: 0 0 8px; }
.verified { color: var(--ok); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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

export class ZapDialog implements ZapUi {
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
    shadow.append(h('style', {}, STYLE), backdrop);
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
    this.render(h('h2', {}, '⚡ Zap'), h('p', { class: 'muted', 'aria-live': 'polite' }, message));
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
        h('h2', {}, `⚡ Zap @${name}`),
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
        const choice = (form.querySelector(`input[name="${scopeName}"]:checked`) as HTMLInputElement | null)?.value;
        done({
          address,
          remember: choice === 'global' || choice === 'chat' ? choice : null,
          ...(picked && picked.address === address ? { pubkey: picked.pubkey } : {}),
        });
      });
      this.focusFirst(this.render(form), 'input');
    });
  }

  /** One search result as a button; profiles without a Lightning Address are shown but disabled. */
  private profileOption(profile: ProfileResult, onPick: () => void): HTMLElement {
    const title = profile.displayName ?? profile.name ?? 'Unnamed profile';
    const button = h('button', { type: 'button', class: 'option' },
      h('strong', {}, title),
      profile.name ? h('span', { class: 'muted' }, ` @${profile.name}`) : null,
      h('br'),
      profile.nip05
        ? h('span', { class: profile.nip05Verified ? 'verified' : 'muted' }, profile.nip05Verified ? `✓ ${profile.nip05}` : `${profile.nip05} (not verified)`)
        : null,
      profile.nip05 ? h('br') : null,
      h('span', { class: 'muted mono' }, shortNpub(profile.npub)),
      h('br'),
      profile.lud16 ? h('span', {}, `⚡ ${profile.lud16}`) : h('span', { class: 'muted' }, 'No Lightning Address'),
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
          c.mapping.displayName, h('br'), h('span', { class: 'muted' }, c.mapping.address));
        this.onClick(b, () => done(c));
        return b;
      });
      const cancel = h('button', { type: 'button' }, 'Cancel');
      this.onClick(cancel, () => done(null));
      this.focusFirst(this.render(
        h('h2', {}, `⚡ Which ${name}?`),
        h('p', { class: 'muted' }, 'More than one saved contact has this name.'),
        ...options,
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
        h('h2', {}, '⚡ Confirm zap'),
        h('dl', {},
          h('dt', {}, 'To'), h('dd', {}, details.name),
          h('dt', {}, 'Address'), h('dd', {}, recipient.address),
          h('dt', {}, 'Amount'), h('dd', { class: 'amount' }, sats(details.amountSats)),
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
          h('h2', {}, '⚡ Zap sent'),
          h('p', {}, `${sats(details.amountSats)} to ${details.name} (${details.recipient.address}).`),
          h('p', { class: 'muted' }, 'Add a message to the chat? You can edit it before sending.'),
          h('div', { class: 'actions' }, close, insert),
        ];
      } else if (outcome.outcome === 'not_paid') {
        body = [
          h('h2', {}, 'Zap not sent'),
          h('p', { class: 'error', role: 'alert' }, outcome.error),
          h('p', { class: 'muted' }, 'Nothing was paid. Your command is still in the message box.'),
          h('div', { class: 'actions' }, close),
        ];
      } else {
        body = [
          h('h2', {}, 'Payment status unknown'),
          h('p', { class: 'warn', role: 'alert' }, outcome.error),
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
        h('p', { class: 'error', role: 'alert' }, message),
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
