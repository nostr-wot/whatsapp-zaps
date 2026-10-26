/**
 * A typed `name@domain` is either a Nostr address (NIP-05) or a Lightning
 * Address. A Nostr search says which profile, if any, it stands for; when none
 * does, it is checked as a Lightning Address straight away, so the person sees
 * whether it works before pressing anything.
 */
import { isLightningAddress } from './lnurl.ts';
import type { RecipientInfo } from './messages.ts';
import type { ProfileResult } from './nostr.ts';

/**
 * The profile among search results that a typed name@domain stands for: one
 * whose Lightning Address it is, or whose verified NIP-05 it is (that
 * profile's Lightning Address is then the one to pay).
 */
export function profileForTyped(text: string, found: ProfileResult[]): ProfileResult | null {
  const typed = text.trim().toLowerCase();
  return found.find(p => p.lud16 && (p.lud16 === typed || (p.nip05Verified && p.nip05 === typed))) ?? null;
}

/** Whether to check a typed text as a Lightning Address: it looks like one, and no profile found stands for it. */
export function shouldCheckAsAddress(text: string, found: ProfileResult[]): boolean {
  return isLightningAddress(text.trim()) && !profileForTyped(text, found);
}

const sats = (n: number) => n.toLocaleString('en-US');

/** What a working Lightning Address says about itself, in one short line. */
export function recipientSummary(info: RecipientInfo): string {
  const range = info.minSats === info.maxSats ? `${sats(info.minSats)} sats only` : `${sats(info.minSats)}–${sats(info.maxSats)} sats`;
  const about = info.description?.replace(/\s+/g, ' ').trim();
  if (!about) return range;
  return `${about.length > 80 ? `${about.slice(0, 79)}…` : about} · ${range}`;
}
