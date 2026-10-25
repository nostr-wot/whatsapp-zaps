/**
 * MAIN-world script on web.whatsapp.com: pays invoices with `window.webln`.
 * See src/domain/bridge.ts for why this channel is safe to expose to the page.
 */
import { BRIDGE_RESPONSE, WEBLN_WAIT_MS } from '../constants.ts';
import { isPayRequest, payWithWebln, type PayResponse } from '../domain/bridge.ts';

type WeblnWindow = Window & { webln?: Parameters<typeof payWithWebln>[0] };

/** Resolve with window.webln once Nostr WoT has installed it, or undefined after a wait. */
function waitForWebln(): Promise<WeblnWindow['webln']> {
  const w = window as WeblnWindow;
  if (w.webln) return Promise.resolve(w.webln);
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener('webln-ready', done);
      resolve(w.webln);
    };
    const timer = setTimeout(done, WEBLN_WAIT_MS);
    window.addEventListener('webln-ready', done);
  });
}

window.addEventListener('message', async event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (!isPayRequest(event.data)) return;
  const { id, bolt11 } = event.data;
  const outcome = await payWithWebln(await waitForWebln(), bolt11);
  const response: PayResponse = { type: BRIDGE_RESPONSE, id, ...outcome };
  window.postMessage(response, window.location.origin);
});
