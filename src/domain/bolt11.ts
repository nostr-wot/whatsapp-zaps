/**
 * Read the amount out of a BOLT11 invoice.
 *
 * Only the amount is needed here: the LNURL client compares it to the amount
 * the user confirmed. Signature and tagged fields are the wallet's business —
 * Nostr WoT decodes the full invoice again before it pays.
 *
 * The amount rules follow Nostr WoT's src/domain/wallet/bolt11.ts.
 *
 * @see https://github.com/lightning/bolts/blob/master/11-payment-encoding.md
 */
import { bech32 } from '@scure/base';

export interface InvoiceAmount {
  amountSats: number | null;
  amountMsats: number | null;
  network: string;
}

// 1 BTC in msats, per HRP multiplier. 'p' (pico) is handled separately.
const FACTORS: Record<string, bigint> = { '': 100_000_000_000n, m: 100_000_000n, u: 100_000n, n: 100n };

/** Parse `ln{network}{amount}{multiplier}`; null when malformed. */
export function parseInvoiceHrp(hrp: string): InvoiceAmount | null {
  const match = /^ln(bcrt|bc|tb)(?:([0-9]+)([munp]?))?$/.exec(hrp);
  if (!match) return null;
  const network = match[1];
  if (!match[2]) return { amountSats: null, amountMsats: null, network };
  const value = BigInt(match[2]);
  // 10 pBTC = 1 msat; anything finer cannot be paid.
  if (match[3] === 'p' && value % 10n !== 0n) return null;
  const msats = match[3] === 'p' ? value / 10n : value * FACTORS[match[3]];
  if (msats <= 0n || msats > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const amountMsats = Number(msats);
  return { amountSats: amountMsats / 1000, amountMsats, network };
}

/**
 * Checksum-verify an invoice and return its amount.
 * Returns null for anything that is not a well-formed BOLT11 string.
 */
export function decodeBolt11Amount(invoice: string): InvoiceAmount | null {
  const trimmed = invoice.trim();
  if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) return null;
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith('lnbc') && !lower.startsWith('lntb')) return null;
  let prefix: string;
  let words: number;
  try {
    const decoded = bech32.decode(lower as `${string}1${string}`, 5000);
    prefix = decoded.prefix;
    words = decoded.words.length;
  } catch {
    return null;
  }
  // Seven timestamp words plus a 104-word signature is the minimum invoice.
  if (words < 111) return null;
  return parseInvoiceHrp(prefix);
}
