/**
 * Contact → Lightning Address mappings.
 *
 * A mapping is saved either for one chat (a group where "Alice" means a
 * particular person) or globally. Lookups try the chat first, then global.
 *
 * Contacts are keyed by WhatsApp contact id when the DOM gives one, and by
 * normalized display name otherwise. Display names are not unique, so a name
 * lookup can come back `ambiguous` and the UI asks which one was meant.
 *
 * Everything here is pure: storage lives in services/mappingStore.ts.
 */
import { parseLightningAddress } from './lnurl.ts';
import { safePictureUrl } from './nostr.ts';
import type { Mention } from './command.ts';

export interface Mapping {
  /** Normalized Lightning Address. */
  address: string;
  /** Name shown in WhatsApp when the mapping was saved. */
  displayName: string;
  updatedAt: number;
  /** Hex pubkey of the Nostr profile the address was taken from, if any. */
  pubkey?: string;
  /** What that profile showed when it was linked, for display only. */
  nostr?: NostrSnapshot;
}

/** A local copy of the linked profile's name and NIP-05, so nothing is fetched to show it. */
export interface NostrSnapshot {
  name: string | null;
  /** Only stored when it was verified at link time. */
  nip05: string | null;
  /** Profile picture address (https), fetched through the background when shown. */
  picture?: string | null;
}

const HEX_PUBKEY = /^[0-9a-f]{64}$/;

export interface MappingStore {
  global: Record<string, Mapping>;
  groups: Record<string, Record<string, Mapping>>;
}

export type MappingScope = { kind: 'global' } | { kind: 'chat'; chatKey: string };

export type Resolution =
  | { kind: 'found'; contactKey: string; mapping: Mapping; scope: MappingScope }
  | { kind: 'ambiguous'; candidates: Array<{ contactKey: string; mapping: Mapping; scope: MappingScope }> }
  | { kind: 'unknown' };

export function emptyStore(): MappingStore {
  return { global: {}, groups: {} };
}

/** Lowercased, accent-insensitive, whitespace-collapsed name used as a key. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^@\s*/, '')
    .toLowerCase();
}

/** Key a contact by id when known, by name otherwise. */
export function contactKeyFor(mention: Mention): string {
  return mention.id ? `id:${mention.id}` : `name:${normalizeName(mention.label)}`;
}

function entriesIn(scope: MappingScope, store: MappingStore): Array<[string, Mapping]> {
  const bucket = scope.kind === 'global' ? store.global : store.groups[scope.chatKey] ?? {};
  return Object.entries(bucket);
}

/**
 * Find the Lightning Address for a mention.
 *
 * Order: exact key in this chat, exact key globally, then a display-name match
 * in this chat, then globally. A name that matches more than one distinct
 * address within the first scope that has any match is `ambiguous`.
 */
export function resolveRecipient(store: MappingStore, chatKey: string | null, mention: Mention): Resolution {
  const scopes: MappingScope[] = chatKey ? [{ kind: 'chat', chatKey }, { kind: 'global' }] : [{ kind: 'global' }];
  const key = contactKeyFor(mention);

  for (const scope of scopes) {
    const hit = entriesIn(scope, store).find(([k]) => k === key);
    if (hit) return { kind: 'found', contactKey: hit[0], mapping: hit[1], scope };
  }

  const name = normalizeName(mention.label);
  for (const scope of scopes) {
    const matches = entriesIn(scope, store).filter(([, m]) => normalizeName(m.displayName) === name);
    if (matches.length === 0) continue;
    const addresses = new Set(matches.map(([, m]) => m.address));
    if (addresses.size === 1) {
      return { kind: 'found', contactKey: matches[0][0], mapping: matches[0][1], scope };
    }
    return {
      kind: 'ambiguous',
      candidates: matches.map(([contactKey, mapping]) => ({ contactKey, mapping, scope })),
    };
  }

  return { kind: 'unknown' };
}

/**
 * Return a copy of the store with the mapping saved.
 * @throws if the address is not a valid Lightning Address.
 */
export function saveMapping(
  store: MappingStore,
  scope: MappingScope,
  contactKey: string,
  displayName: string,
  address: string,
  now: number = Date.now(),
  pubkey?: string,
  nostr?: NostrSnapshot,
): MappingStore {
  const parsed = parseLightningAddress(address);
  if (!parsed) throw new Error('Not a valid Lightning Address');
  const mapping: Mapping = { address: `${parsed.name}@${parsed.domain}`, displayName: displayName.trim(), updatedAt: now };
  if (pubkey) {
    if (!HEX_PUBKEY.test(pubkey)) throw new Error('Invalid Nostr pubkey');
    mapping.pubkey = pubkey;
    if (nostr) {
      mapping.nostr = { name: nostr.name?.slice(0, 80) || null, nip05: nostr.nip05?.slice(0, 200) || null };
      const picture = safePictureUrl(nostr.picture);
      if (picture) mapping.nostr.picture = picture;
    }
  }
  if (scope.kind === 'global') {
    return { ...store, global: { ...store.global, [contactKey]: mapping } };
  }
  const group = { ...(store.groups[scope.chatKey] ?? {}), [contactKey]: mapping };
  return { ...store, groups: { ...store.groups, [scope.chatKey]: group } };
}

/** Return a copy of the store without the mapping. Empty chat buckets are dropped. */
export function removeMapping(store: MappingStore, scope: MappingScope, contactKey: string): MappingStore {
  if (scope.kind === 'global') {
    const global = { ...store.global };
    delete global[contactKey];
    return { ...store, global };
  }
  const group = { ...(store.groups[scope.chatKey] ?? {}) };
  delete group[contactKey];
  const groups = { ...store.groups };
  if (Object.keys(group).length === 0) delete groups[scope.chatKey];
  else groups[scope.chatKey] = group;
  return { ...store, groups };
}

function isMapping(value: unknown): value is Mapping {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return typeof m.address === 'string'
    && parseLightningAddress(m.address) !== null
    && typeof m.displayName === 'string'
    && typeof m.updatedAt === 'number'
    && (m.pubkey === undefined || (typeof m.pubkey === 'string' && HEX_PUBKEY.test(m.pubkey)))
    && (m.nostr === undefined || isSnapshot(m.nostr));
}

function isSnapshot(value: unknown): value is NostrSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const n = value as Record<string, unknown>;
  return (n.name === null || typeof n.name === 'string') && (n.nip05 === null || typeof n.nip05 === 'string')
    && (n.picture === undefined || n.picture === null || (typeof n.picture === 'string' && safePictureUrl(n.picture) === n.picture));
}

function sanitizeBucket(value: unknown): Record<string, Mapping> {
  const out: Record<string, Mapping> = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return out;
  for (const [key, mapping] of Object.entries(value)) {
    if (/^(id|name):./.test(key) && isMapping(mapping)) out[key] = mapping;
  }
  return out;
}

/**
 * Validate stored or imported data, dropping anything malformed.
 * Never throws: a bad import must not wipe the user's mappings by crashing.
 */
export function sanitizeStore(value: unknown): MappingStore {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return emptyStore();
  const raw = value as Record<string, unknown>;
  const groups: Record<string, Record<string, Mapping>> = {};
  if (typeof raw.groups === 'object' && raw.groups !== null && !Array.isArray(raw.groups)) {
    for (const [chatKey, bucket] of Object.entries(raw.groups)) {
      const clean = sanitizeBucket(bucket);
      if (chatKey && Object.keys(clean).length > 0) groups[chatKey] = clean;
    }
  }
  return { global: sanitizeBucket(raw.global), groups };
}

/** The mapping saved for exactly this contact key in this scope, if any. */
export function findMapping(store: MappingStore, scope: MappingScope, contactKey: string): Mapping | null {
  const bucket = scope.kind === 'global' ? store.global : store.groups[scope.chatKey];
  return bucket?.[contactKey] ?? null;
}

/** Merge an import into the store; imported entries win on conflict. */
export function mergeStores(base: MappingStore, incoming: MappingStore): MappingStore {
  const groups = { ...base.groups };
  for (const [chatKey, bucket] of Object.entries(incoming.groups)) {
    groups[chatKey] = { ...(groups[chatKey] ?? {}), ...bucket };
  }
  return { global: { ...base.global, ...incoming.global }, groups };
}
