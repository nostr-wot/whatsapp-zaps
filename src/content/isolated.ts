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
import { readChatContact, readChatKey, readChatTitle, setComposerText } from '../whatsapp/dom.ts';
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
    clearComposer: () => { setComposerText(composer, ''); updateHighlight(); },
    insertMessage: message => { setComposerText(composer, message); updateHighlight(); },
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
