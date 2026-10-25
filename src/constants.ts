// ── LNURL (values mirror Nostr WoT's src/constants/lnurl.ts and wallet.ts) ──

// LUD-16 keeps the local part to `a-z0-9-_.` (lowercase). Domains are the
// usual dot-separated labels; a trailing dot or an empty label is rejected.
export const LOCAL_PART = /^[a-z0-9-_.]+$/;

export const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export const PRIVATE_IPV4 = /^(0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2[0-9]|3[01])\./;

export const LNURL_MAX_RESPONSE_BYTES = 64 * 1024;

export const LNURL_REQUEST_TIMEOUT_MS = 15_000;

// ── Zap command ──

/** Largest amount one command may request. A typo guard, not a wallet limit. */
export const MAX_ZAP_SATS = 10_000_000;

export const MAX_COMMENT_LENGTH = 280;

// ── Storage ──

export const MAPPINGS_STORAGE_KEY = 'zapMappings';

// ── MAIN ↔ ISOLATED bridge ──

export const BRIDGE_REQUEST = 'WAZAPS_PAY_REQUEST';

export const BRIDGE_RESPONSE = 'WAZAPS_PAY_RESPONSE';

/** How long to wait for Nostr WoT to install window.webln. */
export const WEBLN_WAIT_MS = 10_000;

// ── Nostr profile search ──

/** Relays asked for a known pubkey's profile (kind 0). */
export const PROFILE_RELAYS = ['wss://purplepag.es', 'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

/** NIP-50 relays asked for name searches. They see what you search for. */
export const SEARCH_RELAYS = ['wss://relay.nostr.band', 'wss://search.nos.today'];

export const NOSTR_QUERY_MAX_WAIT_MS = 4_000;

export const MAX_SEARCH_RESULTS = 20;

/** How many results get their NIP-05 checked (one HTTPS request each). */
export const NIP05_VERIFY_LIMIT = 10;
