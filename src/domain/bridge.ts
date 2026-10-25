/**
 * MAIN ↔ ISOLATED bridge for paying through `window.webln`.
 *
 * Only the MAIN world can see the `window.webln` object Nostr WoT installs, so
 * a small script there pays the invoice and posts the result back.
 *
 * The bridge travels over `window.postMessage`, which WhatsApp's own scripts
 * can read and write. That is acceptable because it grants nothing the page
 * does not already have: any script on web.whatsapp.com can call
 * `window.webln.sendPayment` itself, and Nostr WoT's consent, spending
 * allowance and approval prompt apply to every caller alike. The worst a
 * hostile page could do through the bridge is forge a result, which only
 * changes what this extension's dialog says.
 */
import { BRIDGE_REQUEST, BRIDGE_RESPONSE } from '../constants.ts';

export interface PayRequest {
  type: typeof BRIDGE_REQUEST;
  id: string;
  bolt11: string;
}

/**
 * - `paid`: the wallet returned a preimage.
 * - `not_paid`: refused before any payment was attempted (declined, no wallet, …).
 * - `unknown`: the payment may or may not have gone through. Never retry these
 *   automatically: a fresh LNURL invoice would be a second payment.
 */
export type PayOutcome =
  | { outcome: 'paid'; preimage: string }
  | { outcome: 'not_paid'; error: string }
  | { outcome: 'unknown'; error: string };

export type PayResponse = { type: typeof BRIDGE_RESPONSE; id: string } & PayOutcome;

// Nostr WoT's errors that are raised before the wallet is asked to pay.
const NOT_PAID_PATTERNS = [
  /payment denied by user/i,
  /permission denied/i,
  /webln access denied/i,
  /site not connected/i,
  /webln not enabled/i,
  /no wallet configured/i,
  /no active account/i,
  /provider not available/i,
  /missing paymentrequest/i,
  /webln is not available/i,
];

/** Sort a WebLN error into "certainly not paid" or "unknown". */
export function classifyPaymentError(message: string): PayOutcome {
  if (NOT_PAID_PATTERNS.some(p => p.test(message))) return { outcome: 'not_paid', error: message };
  return { outcome: 'unknown', error: message };
}

export function isPayRequest(data: unknown): data is PayRequest {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.type === BRIDGE_REQUEST
    && typeof d.id === 'string' && d.id.length > 0 && d.id.length <= 64
    && typeof d.bolt11 === 'string' && /^ln(bc|tb)[0-9a-z]+$/i.test(d.bolt11) && d.bolt11.length <= 5000;
}

export function isPayResponse(data: unknown, id: string): data is PayResponse {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d.type !== BRIDGE_RESPONSE || d.id !== id) return false;
  if (d.outcome === 'paid') return typeof d.preimage === 'string';
  return (d.outcome === 'not_paid' || d.outcome === 'unknown') && typeof d.error === 'string';
}

interface WebLNLike {
  enabled?: boolean;
  enable(): Promise<void>;
  sendPayment(paymentRequest: string): Promise<{ preimage: string }>;
}

/** Pay through a WebLN provider, enabling it first when needed. */
export async function payWithWebln(webln: WebLNLike | undefined, bolt11: string): Promise<PayOutcome> {
  if (!webln) {
    return { outcome: 'not_paid', error: 'WebLN is not available. Install or unlock the Nostr WoT extension.' };
  }
  try {
    if (!webln.enabled) await webln.enable();
  } catch (err) {
    // Enabling never moves money.
    return { outcome: 'not_paid', error: errorMessage(err) };
  }
  try {
    const result = await webln.sendPayment(bolt11);
    if (typeof result?.preimage !== 'string') return { outcome: 'unknown', error: 'The wallet returned no payment proof.' };
    return { outcome: 'paid', preimage: result.preimage };
  } catch (err) {
    return classifyPaymentError(errorMessage(err));
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
