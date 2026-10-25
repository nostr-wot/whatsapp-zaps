/**
 * Nostr profile search: query parsing and profile (kind 0) handling.
 *
 * A search finds people on Nostr and reads the Lightning Address (`lud16`)
 * from their profile. Anyone can name themselves "Alice", so every result
 * carries what is needed to tell people apart: the npub, and whether the
 * profile's NIP-05 name actually resolves to that key.
 */
import * as nip19 from 'nostr-tools/nip19';
import { verifyEvent, type Event } from 'nostr-tools/pure';
import { DOMAIN, LOCAL_PART } from '../constants.ts';
import { parseLightningAddress } from './lnurl.ts';

export type SearchQuery =
  | { kind: 'pubkey'; pubkey: string; relays: string[] }
  | { kind: 'nip05'; name: string; domain: string; text: string }
  | { kind: 'text'; text: string };

export interface ProfileResult {
  pubkey: string;
  npub: string;
  /** `display_name`, else `name`, else null. */
  displayName: string | null;
  /** `name` (the handle), when it differs from displayName. */
  name: string | null;
  nip05: string | null;
  /** True only when the nip05 was checked and points at this pubkey. */
  nip05Verified: boolean;
  /** Normalized Lightning Address from `lud16`, or null when the profile has none. */
  lud16: string | null;
  /** Profile picture, https only; fetched through the background, never by the page. */
  picture: string | null;
  /** The person (whose npub was set in the contacts page) follows this profile. */
  followed: boolean;
  createdAt: number;
}

/** A picture URL worth fetching: https, a host name, not absurdly long. */
export function safePictureUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1000) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname.includes('.') && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Longest name search. */
export const MAX_QUERY_LENGTH = 100;

/** Longest npub/nprofile (an nprofile carries relay hints). */
export const MAX_BECH32_QUERY_LENGTH = 500;

const HEX_PUBKEY = /^[0-9a-f]{64}$/;

/**
 * Classify what the user typed.
 * - `npub1…`, `nprofile1…`, `nostr:` URIs or 64-char hex → a key lookup
 * - `name@domain` → a NIP-05 lookup (it may also be a Lightning Address)
 * - anything else → a full-text name search
 * Returns null for empty or overlong input.
 */
export function parseSearchQuery(input: string): SearchQuery | null {
  const text = input.trim().replace(/^@/, '');
  if (!text || text.length > MAX_BECH32_QUERY_LENGTH) return null;

  const bare = text.replace(/^nostr:/i, '');
  if (/^(npub|nprofile)1/i.test(bare)) {
    try {
      const decoded = nip19.decode(bare.toLowerCase());
      if (decoded.type === 'npub') return { kind: 'pubkey', pubkey: decoded.data, relays: [] };
      if (decoded.type === 'nprofile') {
        const relays = (decoded.data.relays ?? []).filter(r => /^wss:\/\//i.test(r)).slice(0, 3);
        return { kind: 'pubkey', pubkey: decoded.data.pubkey, relays };
      }
    } catch {
      return null;
    }
  }
  if (HEX_PUBKEY.test(bare.toLowerCase())) return { kind: 'pubkey', pubkey: bare.toLowerCase(), relays: [] };
  if (text.length > MAX_QUERY_LENGTH) return null;

  const nip05 = parseNip05(text);
  if (nip05) return { kind: 'nip05', ...nip05, text };

  return { kind: 'text', text };
}

/** Split a `name@domain` NIP-05 identifier. */
export function parseNip05(input: string): { name: string; domain: string } | null {
  const lower = input.trim().toLowerCase();
  const at = lower.indexOf('@');
  if (at <= 0 || at !== lower.lastIndexOf('@')) return null;
  const name = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  if (!LOCAL_PART.test(name) || !DOMAIN.test(domain)) return null;
  return { name, domain };
}

/** Pull the pubkey for `name` out of a nostr.json document; null when absent. */
export function pubkeyFromNostrJson(body: Record<string, unknown>, name: string): string | null {
  const names = body.names;
  if (typeof names !== 'object' || names === null) return null;
  const pubkey = (names as Record<string, unknown>)[name];
  return typeof pubkey === 'string' && HEX_PUBKEY.test(pubkey) ? pubkey : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2066-\u2069\ufeff]/g, '').trim();
  return clean ? clean.slice(0, max) : null;
}

/**
 * Read a kind-0 event into a result. Returns null unless the event is a
 * correctly signed profile with JSON content. The signature check matters:
 * a relay must not be able to hand us someone's profile with its own lud16.
 */
export function profileFromEvent(event: Event): ProfileResult | null {
  if (event?.kind !== 0) return null;
  // Verify a fresh object holding only the signed fields. nostr-tools caches a
  // passed check on the event object under a symbol, and copies made with
  // spread keep that mark — so a copy with swapped content would otherwise be
  // trusted without its signature ever being checked again.
  const { id, pubkey, created_at, kind, tags, content: raw, sig } = event;
  if (!verifyEvent({ id, pubkey, created_at, kind, tags, content: raw, sig })) return null;
  let content: Record<string, unknown>;
  try {
    const parsed = JSON.parse(event.content) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    content = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const name = text(content.name, 80);
  const displayName = text(content.display_name, 80) ?? text(content.displayName, 80) ?? name;
  const lud = typeof content.lud16 === 'string' ? parseLightningAddress(content.lud16) : null;
  const nip05 = text(content.nip05, 200);
  return {
    pubkey: event.pubkey,
    npub: nip19.npubEncode(event.pubkey),
    displayName,
    name: name && name !== displayName ? name : null,
    nip05: nip05 && parseNip05(nip05) ? nip05.toLowerCase() : null,
    nip05Verified: false,
    lud16: lud ? `${lud.name}@${lud.domain}` : null,
    picture: safePictureUrl(content.picture),
    followed: false,
    createdAt: event.created_at,
  };
}

/** Keep the newest valid profile per pubkey. */
export function latestProfiles(events: Event[]): ProfileResult[] {
  const byKey = new Map<string, ProfileResult>();
  for (const event of events) {
    const profile = profileFromEvent(event);
    if (!profile) continue;
    const current = byKey.get(profile.pubkey);
    if (!current || profile.createdAt > current.createdAt) byKey.set(profile.pubkey, profile);
  }
  return [...byKey.values()];
}

/**
 * Order results: an exact npub/NIP-05 hit first, then people the person
 * follows, then verified NIP-05, then profiles that can be paid, then by how
 * well the name matches.
 */
export function rankProfiles(profiles: ProfileResult[], query: string): ProfileResult[] {
  const q = query.trim().toLowerCase();
  const nameScore = (p: ProfileResult) => {
    const names = [p.displayName, p.name].filter((n): n is string => !!n).map(n => n.toLowerCase());
    if (names.some(n => n === q)) return 3;
    if (names.some(n => n.startsWith(q))) return 2;
    if (names.some(n => n.includes(q))) return 1;
    return 0;
  };
  const score = (p: ProfileResult) =>
    (p.nip05 === q && p.nip05Verified ? 1000 : 0)
    + (p.followed ? 500 : 0)
    + (p.nip05Verified ? 100 : 0)
    + (p.lud16 ? 50 : 0)
    + nameScore(p) * 10;
  return [...profiles].sort((a, b) => score(b) - score(a) || b.createdAt - a.createdAt);
}

/** Short npub for display: `npub1abcd…wxyz`. */
export function shortNpub(npub: string): string {
  return npub.length > 20 ? `${npub.slice(0, 10)}…${npub.slice(-6)}` : npub;
}

/** The followed pubkeys in a kind-3 contact list; empty unless correctly signed. */
export function followsFromEvent(event: Event): string[] {
  if (event?.kind !== 3) return [];
  const { id, pubkey, created_at, kind, tags, content, sig } = event;
  if (!verifyEvent({ id, pubkey, created_at, kind, tags, content, sig })) return [];
  return [...new Set(tags.filter(t => t[0] === 'p' && HEX_PUBKEY.test(t[1] ?? '')).map(t => t[1]))];
}
