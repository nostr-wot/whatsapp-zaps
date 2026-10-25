/**
 * ISOLATED-world content script on web.whatsapp.com: wires the interceptor,
 * the dialog, storage, the background worker and the MAIN-world payer.
 */
import { BRIDGE_REQUEST } from '../constants.ts';
import { isPayResponse, type PayOutcome, type PayRequest } from '../domain/bridge.ts';
import { removeMapping, saveMapping } from '../domain/mappings.ts';
import type { BackgroundRequest, BackgroundResponse, RecipientInfo } from '../domain/messages.ts';
import type { ResolvedInvoice } from '../domain/lnurl.ts';
import type { ProfileResult } from '../domain/nostr.ts';
import { runReactionZap, runZap, type ChatContext, type ZapDeps } from '../flow.ts';
import { runLinkPopup } from '../linkFlow.ts';
import { loadMappings as loadStoredMappings, updateMappings as updateStoredMappings } from '../services/mappingStore.ts';
import type { MappingStore } from '../domain/mappings.ts';
import { ZapDialog } from '../ui/dialog.ts';
import { installInterceptor } from '../whatsapp/intercept.ts';
import {
  footerTextsOutsideComposer, readMessageAuthor, replyAuthor, findComposer, lastMentionAttempt, readChatContact, readChatKey, readChatTitle, replaceComposerText, rewriteAroundMention,
  sendComposer, writeWithMention,
} from '../whatsapp/dom.ts';
import { recordDiagnostic } from '../services/diagnostics.ts';
import { RELOAD_MESSAGE, claimPage, isExtensionAlive, lifecycleState } from './lifecycle.ts';

/** Storage, failing with the reload message instead of a TypeError once cut off. */
function loadMappings(): Promise<MappingStore> {
  return isExtensionAlive() ? loadStoredMappings() : Promise.reject(new Error(RELOAD_MESSAGE));
}
function updateMappings(change: (store: MappingStore) => MappingStore): Promise<MappingStore> {
  return isExtensionAlive() ? updateStoredMappings(change) : Promise.reject(new Error(RELOAD_MESSAGE));
}

// See lifecycle.ts: this copy may outlive the extension that loaded it.
const INSTANCE_ID = crypto.randomUUID();
claimPage(document, INSTANCE_ID);
const uninstallers: Array<() => void> = [];
const state = () => lifecycleState(document, INSTANCE_ID, isExtensionAlive());
/** Handle events while this copy is current; a replaced copy removes itself. */
function current(): boolean {
  if (state() !== 'replaced') return true;
  for (const uninstall of uninstallers.splice(0)) uninstall();
  return false;
}
/** A copy cut off from the extension cannot zap: say so instead of crashing. */
function orphaned(): boolean {
  if (state() !== 'orphaned') return false;
  void dialog.showError(RELOAD_MESSAGE).then(() => dialog.close());
  return true;
}
import { POST_PREFERENCE_KEY, RECENT_ZAPS_KEY, REPEAT_WINDOW_MS } from '../constants.ts';
import { installMenuItem } from '../whatsapp/menu.ts';
import { installReplyTracker } from '../whatsapp/replies.ts';
import { installReactionWatcher } from '../whatsapp/reactions.ts';
import { DEFAULT_REACTION_SATS, REACTION_AMOUNT_KEY, TRACE_REACTIONS_UNTIL_KEY } from '../constants.ts';
import { installCommandHighlight, updateHighlight } from '../whatsapp/highlight.ts';

async function ask<T>(request: BackgroundRequest): Promise<T> {
  if (!isExtensionAlive()) throw new Error(RELOAD_MESSAGE);
  const response = await chrome.runtime.sendMessage(request) as BackgroundResponse<T> | undefined;
  if (!response) throw new Error('The extension background did not answer. Reload the page and try again.');
  if (!response.ok) throw new Error(response.error);
  return response.value;
}

/**
 * Ask the MAIN-world script to pay. There is deliberately no timeout here:
 * Nostr WoT bounds the WebLN call itself and reports a timeout, which the
 * bridge turns into an "unknown" outcome.
 */
function pay(bolt11: string): Promise<PayOutcome> {
  const id = crypto.randomUUID();
  return new Promise(resolve => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window || !isPayResponse(event.data, id)) return;
      window.removeEventListener('message', onMessage);
      const { type: _type, id: _id, ...outcome } = event.data;
      resolve(outcome as PayOutcome);
    }
    window.addEventListener('message', onMessage);
    const request: PayRequest = { type: BRIDGE_REQUEST, id, bolt11 };
    window.postMessage(request, window.location.origin);
  });
}

// Commands paid recently, kept across reloads so a command left in the box
// cannot be paid twice without a warning.
let recentZaps: Record<string, number> = {};
let postByDefault = true;
if (isExtensionAlive()) void chrome.storage.local.get([RECENT_ZAPS_KEY, POST_PREFERENCE_KEY]).then(stored => {
  const now = Date.now();
  const saved = stored[RECENT_ZAPS_KEY];
  if (saved && typeof saved === 'object') {
    for (const [key, at] of Object.entries(saved as Record<string, unknown>)) {
      if (typeof at === 'number' && now - at < REPEAT_WINDOW_MS) recentZaps[key] = at;
    }
  }
  if (typeof stored[POST_PREFERENCE_KEY] === 'boolean') postByDefault = stored[POST_PREFERENCE_KEY];
});

async function reactionAmount(): Promise<number> {
  if (!isExtensionAlive()) return DEFAULT_REACTION_SATS;
  const stored = await chrome.storage.local.get(REACTION_AMOUNT_KEY);
  const amount = stored[REACTION_AMOUNT_KEY];
  return typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0 ? amount : DEFAULT_REACTION_SATS;
}

let busy = false;
const replies = installReplyTracker();
uninstallers.push(replies.uninstall);
const dialog = new ZapDialog({
  onClosed: () => { busy = false; },
  search: query => ask<ProfileResult[]>({ type: 'search', query }),
  avatar: url => ask<string | null>({ type: 'avatar', url }),
});

/** What the flows need to know about the open chat. */
function chatContext(): ChatContext {
  const contact = readChatContact();
  return {
    chatKey: readChatKey(),
    chatTitle: readChatTitle(),
    contact: contact?.kind === 'contact' ? { label: contact.name, id: contact.id } : null,
    // Certain only with a chat id: a group id, or a person's. Without one, unknown.
    isGroup: contact?.kind === 'group' ? true : contact?.kind === 'contact' && contact.id ? false : null,
    replyTo: replyAuthor(replies.lastRow()),
  };
}

/** The flows' side effects. `composer` is the box a command was typed in. */
function zapDeps(composer: HTMLElement | null): ZapDeps {
  return {
    ui: dialog,
    loadMappings,
    saveMapping: async (scope, contactKey, displayName, address, pubkey) => {
      await updateMappings(store => saveMapping(store, scope, contactKey, displayName, address, Date.now(), pubkey));
    },
    resolve: address => ask<RecipientInfo>({ type: 'resolve', address }),
    invoice: (address, amountSats, comment) => ask<ResolvedInvoice>({ type: 'invoice', address, amountSats, comment }),
    pay,
    // WhatsApp may have re-rendered the box while the dialog was open.
    clearComposer: async () => {
      const box = findComposer() ?? composer!;
      const cleared = await replaceComposerText(box, '');
      updateHighlight();
      return cleared;
    },
    postMessage: async message => {
      const box = findComposer() ?? composer!;
      // Never send unless the box holds exactly the intended message: anything
      // else (a half-replaced /zap command above all) must not go out.
      let ready = false;
      const m = message.mention;
      if (m) {
        // Keep the mention the person picked in their command, so it stays a real one;
        // otherwise make one through WhatsApp's own mention list.
        const commandHtml = box.outerHTML.slice(0, 20_000);
        ready = await rewriteAroundMention(box, m.who, m.before, m.after)
          || await writeWithMention(box, m.who, m.before, m.after);
        if (!ready) {
          const attempt = lastMentionAttempt();
          void recordDiagnostic('mention could not be made; posted as plain text', {
            wanted: `${m.who.label}${m.who.id ? ` (${m.who.id})` : ''}`,
            'message box with the command': commandHtml,
            'stage reached': attempt?.stage ?? 'rewrite only',
            'message box after the attempt': attempt?.composerHtml ?? box.outerHTML.slice(0, 20_000),
            'what appeared after typing @': attempt?.listHtml || '(nothing)',
            'chat as detected': JSON.stringify({ chatKey: readChatKey(), title: readChatTitle(), contact: readChatContact() }),
            'chat header': document.querySelector('#main header')?.outerHTML.slice(0, 8_000) ?? '(no header found)',
            'first message rows': [...document.querySelectorAll('#main [data-id]')].slice(0, 3)
              .map(el => el.getAttribute('data-id')).join('\n') || '(no [data-id] rows)',
          });
        }
      }
      if (!ready) ready = await replaceComposerText(box, message.text);
      updateHighlight();
      return ready && sendComposer(box);
    },
    lastPaid: key => {
      const at = recentZaps[key];
      return at !== undefined && Date.now() - at < REPEAT_WINDOW_MS ? at : null;
    },
    markPaid: key => {
      const now = Date.now();
      recentZaps = Object.fromEntries(Object.entries(recentZaps).filter(([, at]) => now - at < REPEAT_WINDOW_MS));
      recentZaps[key] = now;
      if (isExtensionAlive()) void chrome.storage.local.set({ [RECENT_ZAPS_KEY]: recentZaps });
    },
    postByDefault,
    setPostPreference: post => {
      postByDefault = post;
      if (isExtensionAlive()) void chrome.storage.local.set({ [POST_PREFERENCE_KEY]: post });
    },
  };
}

uninstallers.push(installInterceptor(({ text, mentions, composer }) => {
  if (orphaned()) return;
  busy = true;
  const chat = chatContext();
  // A group zap with no mention relies on the reply: if a reply box seems open
  // but no message on screen fits it, keep what the page showed for diagnostics.
  if (!chat.replyTo && chat.isGroup !== false && mentions.length === 0 && !/@/.test(text)) {
    const footer = document.querySelector('#main footer') ?? document.querySelector('footer');
    void recordDiagnostic('reply not tied to a message', {
      'texts around the message box': footerTextsOutsideComposer().join(' | ') || '(none)',
      'footer': footer?.outerHTML.slice(0, 15_000) ?? '(no footer)',
      'last message rows': [...document.querySelectorAll('#main [data-id]')].slice(-3).map(el => el.outerHTML.slice(0, 3000)).join('\n') || '(no [data-id] rows)',
    });
  }
  void runZap(text, mentions, chat, zapDeps(composer)).finally(() => { busy = false; });
}, () => busy, document, current));

// ⚡ reaction to a message: zap its author.
const reactions = installReactionWatcher(row => {
  if (orphaned() || busy) return;
  const author = readMessageAuthor(row);
  if (author.fromMe) return;
  busy = true;
  void reactionAmount()
    .then(amount => runReactionZap({ ...author, messageId: row.getAttribute('data-id') ?? '' }, amount, chatContext(), zapDeps(null)))
    .finally(() => { busy = false; });
}, replies.lastRow, document, current, Date.now, missed => {
  void recordDiagnostic(`⚡ reaction not tied to a message: ${missed.reason}`, {
    'reaction picker': missed.pickerHtml,
    'chat as detected': JSON.stringify({ chatKey: readChatKey(), title: readChatTitle(), contact: readChatContact() }),
    'first message rows': [...document.querySelectorAll('#main [data-id]')].slice(0, 3).map(el => el.outerHTML.slice(0, 3000)).join('\n') || '(no [data-id] rows)',
  });
}, undefined, (what, html) => traceReaction(what, html));
uninstallers.push(reactions.uninstall);

// Troubleshooting (Settings → "Record reaction clicks"): for ten minutes, keep
// the markup of clicks outside the chat and of what appears inside messages.
let traceUntil = 0;
if (isExtensionAlive()) {
  void chrome.storage.local.get(TRACE_REACTIONS_UNTIL_KEY).then(s => { traceUntil = Number(s[TRACE_REACTIONS_UNTIL_KEY]) || 0; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && TRACE_REACTIONS_UNTIL_KEY in changes) traceUntil = Number(changes[TRACE_REACTIONS_UNTIL_KEY].newValue) || 0;
  });
}
function traceReaction(what: string, html: string) {
  if (Date.now() > traceUntil) return;
  void recordDiagnostic(`reaction trace: ${what}`, { html });
}

// "⚡ Nostr profile" in the chat header's ⋮ menu.
uninstallers.push(installMenuItem(() => {
  if (orphaned()) return;
  const contact = readChatContact();
  if (busy || !contact) return;
  busy = true;
  void runLinkPopup(contact, {
    ui: dialog,
    loadMappings,
    saveMapping: async (scope, contactKey, displayName, address, pubkey, nostr) => {
      await updateMappings(store => saveMapping(store, scope, contactKey, displayName, address, Date.now(), pubkey, nostr));
    },
    removeMapping: async (scope, contactKey) => {
      await updateMappings(store => removeMapping(store, scope, contactKey));
    },
    resolve: address => ask<RecipientInfo>({ type: 'resolve', address }),
  }).finally(() => { busy = false; });
}, document, current));

uninstallers.push(installCommandHighlight());
