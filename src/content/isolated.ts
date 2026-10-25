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
import { runZap } from '../flow.ts';
import { runLinkPopup } from '../linkFlow.ts';
import { loadMappings, updateMappings } from '../services/mappingStore.ts';
import { ZapDialog } from '../ui/dialog.ts';
import { installInterceptor } from '../whatsapp/intercept.ts';
import {
  findComposer, readChatContact, readChatKey, readChatTitle, replaceComposerText, rewriteAroundMention, sendComposer, writeWithMention,
} from '../whatsapp/dom.ts';
import { POST_PREFERENCE_KEY, RECENT_ZAPS_KEY, REPEAT_WINDOW_MS } from '../constants.ts';
import { installMenuItem } from '../whatsapp/menu.ts';
import { installCommandHighlight, updateHighlight } from '../whatsapp/highlight.ts';

async function ask<T>(request: BackgroundRequest): Promise<T> {
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
void chrome.storage.local.get([RECENT_ZAPS_KEY, POST_PREFERENCE_KEY]).then(stored => {
  const now = Date.now();
  const saved = stored[RECENT_ZAPS_KEY];
  if (saved && typeof saved === 'object') {
    for (const [key, at] of Object.entries(saved as Record<string, unknown>)) {
      if (typeof at === 'number' && now - at < REPEAT_WINDOW_MS) recentZaps[key] = at;
    }
  }
  if (typeof stored[POST_PREFERENCE_KEY] === 'boolean') postByDefault = stored[POST_PREFERENCE_KEY];
});

let busy = false;
const dialog = new ZapDialog({
  onClosed: () => { busy = false; },
  search: query => ask<ProfileResult[]>({ type: 'search', query }),
});

installInterceptor(({ text, mentions, composer }) => {
  busy = true;
  const contact = readChatContact();
  const chat = {
    chatKey: readChatKey(),
    chatTitle: readChatTitle(),
    contact: contact?.kind === 'contact' ? { label: contact.name, id: contact.id } : null,
    isGroup: contact ? contact.kind === 'group' : null,
  };
  void runZap(text, mentions, chat, {
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
      const box = findComposer() ?? composer;
      const cleared = await replaceComposerText(box, '');
      updateHighlight();
      return cleared;
    },
    postMessage: async message => {
      const box = findComposer() ?? composer;
      // Never send unless the box holds exactly the intended message: anything
      // else (a half-replaced /zap command above all) must not go out.
      let ready = false;
      const m = message.mention;
      if (m) {
        // Keep the mention the person picked in their command, so it stays a real one;
        // otherwise make one through WhatsApp's own mention list.
        ready = await rewriteAroundMention(box, m.who, m.before, m.after)
          || await writeWithMention(box, m.who, m.before, m.after);
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
      void chrome.storage.local.set({ [RECENT_ZAPS_KEY]: recentZaps });
    },
    postByDefault,
    setPostPreference: post => {
      postByDefault = post;
      void chrome.storage.local.set({ [POST_PREFERENCE_KEY]: post });
    },
  }).finally(() => { busy = false; });
}, () => busy);

// "⚡ Nostr profile" in the chat header's ⋮ menu.
installMenuItem(() => {
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
});

installCommandHighlight();
