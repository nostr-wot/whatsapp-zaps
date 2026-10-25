/**
 * ISOLATED-world content script on web.whatsapp.com: wires the interceptor,
 * the dialog, storage, the background worker and the MAIN-world payer.
 */
import { BRIDGE_REQUEST } from '../constants.ts';
import { isPayResponse, type PayOutcome, type PayRequest } from '../domain/bridge.ts';
import { saveMapping } from '../domain/mappings.ts';
import type { BackgroundRequest, BackgroundResponse, RecipientInfo } from '../domain/messages.ts';
import type { ResolvedInvoice } from '../domain/lnurl.ts';
import { runZap } from '../flow.ts';
import { loadMappings, updateMappings } from '../services/mappingStore.ts';
import { ZapDialog } from '../ui/dialog.ts';
import { installInterceptor } from '../whatsapp/intercept.ts';
import { readChatKey, readChatTitle, setComposerText } from '../whatsapp/dom.ts';

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
const dialog = new ZapDialog({ onClosed: () => { busy = false; } });

installInterceptor(({ text, mentions, composer }) => {
  busy = true;
  const chat = { chatKey: readChatKey(), chatTitle: readChatTitle() };
  void runZap(text, mentions, chat, {
    ui: dialog,
    loadMappings,
    saveMapping: async (scope, contactKey, displayName, address) => {
      await updateMappings(store => saveMapping(store, scope, contactKey, displayName, address));
    },
    resolve: address => ask<RecipientInfo>({ type: 'resolve', address }),
    invoice: (address, amountSats, comment) => ask<ResolvedInvoice>({ type: 'invoice', address, amountSats, comment }),
    pay,
    clearComposer: () => setComposerText(composer, ''),
    insertMessage: message => setComposerText(composer, message),
  }).finally(() => { busy = false; });
}, () => busy);
