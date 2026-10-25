/**
 * Find Nostr profiles by npub, NIP-05 identifier or name, for the Lightning
 * Address in their profile. Runs in the background worker.
 *
 * Profiles are only trusted when correctly signed (see profileFromEvent), and
 * a NIP-05 name is only shown as verified after its nostr.json was fetched and
 * points at the same key.
 */
import type { Event } from 'nostr-tools/pure';
import type { Filter } from 'nostr-tools/filter';
import { SimplePool } from 'nostr-tools/pool';
import {
  MAX_SEARCH_RESULTS, NIP05_TIMEOUT_MS, NIP05_VERIFY_LIMIT, NOSTR_QUERY_MAX_WAIT_MS, PROFILE_RELAYS, SEARCH_RELAYS,
} from '../constants.ts';
import { assertPublicHttpsUrl } from '../domain/lnurl.ts';
import {
  followsFromEvent, latestProfiles, parseNip05, parseSearchQuery, pubkeyFromNostrJson, rankProfiles, type ProfileResult,
} from '../domain/nostr.ts';
import { fetchCappedJson, type FetchFn } from './http.ts';

export type RelayQuery = (relays: string[], filter: Filter) => Promise<Event[]>;

export interface SearchDeps {
  query: RelayQuery;
  fetchFn: FetchFn;
  /** Pubkeys the person follows (empty when they set no npub); ranks those first. */
  follows?: () => Promise<Set<string>>;
}

/** A relay query backed by a short-lived pool, with a hard deadline. */
export function poolQuery(maxWait = NOSTR_QUERY_MAX_WAIT_MS): RelayQuery {
  return async (relays, filter) => {
    const pool = new SimplePool();
    try {
      return await Promise.race([
        pool.querySync(relays, filter, { maxWait }),
        new Promise<Event[]>(resolve => setTimeout(() => resolve([]), maxWait + 1_000)),
      ]);
    } catch {
      return [];
    } finally {
      pool.close(relays);
    }
  };
}

/** Resolve a NIP-05 identifier to a pubkey; null when it does not resolve. */
export async function resolveNip05(identifier: string, fetchFn: FetchFn): Promise<string | null> {
  const parsed = parseNip05(identifier);
  if (!parsed) return null;
  try {
    const url = assertPublicHttpsUrl(`https://${parsed.domain}/.well-known/nostr.json?name=${encodeURIComponent(parsed.name)}`);
    return pubkeyFromNostrJson(await fetchCappedJson(url.toString(), fetchFn, 'NIP-05', NIP05_TIMEOUT_MS), parsed.name);
  } catch {
    return null;
  }
}

async function verifyNip05(profiles: ProfileResult[], fetchFn: FetchFn, known?: { identifier: string; pubkey: string }) {
  await Promise.all(profiles.slice(0, NIP05_VERIFY_LIMIT).map(async profile => {
    if (!profile.nip05) return;
    if (known && profile.nip05 === known.identifier) {
      profile.nip05Verified = profile.pubkey === known.pubkey;
      return;
    }
    profile.nip05Verified = (await resolveNip05(profile.nip05, fetchFn)) === profile.pubkey;
  }));
}

/**
 * Search for profiles. Never throws for network trouble: unreachable relays or
 * hosts just contribute no results.
 * @throws only for input that is not a usable query.
 */
export async function searchProfiles(input: string, deps: SearchDeps): Promise<ProfileResult[]> {
  const query = parseSearchQuery(input);
  if (!query) throw new Error('Type a name, an npub or a NIP-05 address.');

  let profiles: ProfileResult[];
  let known: { identifier: string; pubkey: string } | undefined;
  if (query.kind === 'pubkey') {
    const relays = [...new Set([...query.relays, ...PROFILE_RELAYS])];
    profiles = latestProfiles(await deps.query(relays, { kinds: [0], authors: [query.pubkey], limit: 5 }));
  } else if (query.kind === 'nip05') {
    const identifier = `${query.name}@${query.domain}`;
    const pubkey = await resolveNip05(identifier, deps.fetchFn);
    if (!pubkey) return [];
    known = { identifier, pubkey };
    profiles = latestProfiles(await deps.query(PROFILE_RELAYS, { kinds: [0], authors: [pubkey], limit: 5 }))
      .filter(p => p.pubkey === pubkey);
  } else {
    profiles = latestProfiles(await deps.query(SEARCH_RELAYS, { kinds: [0], search: query.text, limit: MAX_SEARCH_RESULTS }));
  }

  const follows = await (deps.follows?.() ?? Promise.resolve(new Set<string>())).catch(() => new Set<string>());
  for (const profile of profiles) profile.followed = follows.has(profile.pubkey);

  // Rank once to pick which NIP-05s are worth checking, then again with the results.
  profiles = rankProfiles(profiles, query.kind === 'text' ? query.text : '').slice(0, MAX_SEARCH_RESULTS);
  await verifyNip05(profiles, deps.fetchFn, known);
  return rankProfiles(profiles, query.kind === 'text' ? query.text : known?.identifier ?? '');
}

/** The follow list (kind 3) of `pubkey`, newest correctly signed one. */
export async function fetchFollows(pubkey: string, query: RelayQuery): Promise<string[]> {
  const events = (await query(PROFILE_RELAYS, { kinds: [3], authors: [pubkey], limit: 3 }))
    .filter(e => e.pubkey === pubkey)
    .sort((a, b) => b.created_at - a.created_at);
  for (const event of events) {
    const follows = followsFromEvent(event);
    if (follows.length || event.tags.length === 0) return follows;
  }
  return [];
}

/** Remember search results for a while: typing back and forth repeats queries. */
export function cachedSearch(
  search: (input: string) => Promise<ProfileResult[]>,
  ttlMs: number,
  now: () => number = Date.now,
): (input: string) => Promise<ProfileResult[]> {
  const cache = new Map<string, { at: number; results: Promise<ProfileResult[]> }>();
  return input => {
    const key = input.trim().toLowerCase();
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.results;
    const results = search(input);
    cache.set(key, { at: now(), results });
    // Failures are not cached; the next keystroke tries again.
    results.catch(() => cache.delete(key));
    if (cache.size > 100) cache.delete(cache.keys().next().value!);
    return results;
  };
}
