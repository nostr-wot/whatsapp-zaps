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

/** Commands paid recently, `{ "<chat>|<command>": paidAtMs }`. */
export const RECENT_ZAPS_KEY = 'recentZaps';

/** Whether to post the ⚡ message after a confirmed payment (the last choice made). */
export const POST_PREFERENCE_KEY = 'postZapMessage';

/** Local diagnostics about mentions and the message box (see services/diagnostics.ts). */
export const DIAGNOSTICS_KEY = 'diagnostics';

export const MAX_DIAGNOSTICS = 25;

/** Troubleshooting: record reaction clicks until this time (ms epoch). */
export const TRACE_REACTIONS_UNTIL_KEY = 'traceReactionsUntil';

export const TRACE_REACTIONS_MS = 10 * 60_000;

/** How long the same command in the same chat asks before being paid again. */
export const REPEAT_WINDOW_MS = 30 * 60_000;

// ── MAIN ↔ ISOLATED bridge ──

export const BRIDGE_REQUEST = 'WAZAPS_PAY_REQUEST';

export const BRIDGE_RESPONSE = 'WAZAPS_PAY_RESPONSE';

/** How long to wait for Nostr WoT to install window.webln. */
export const WEBLN_WAIT_MS = 10_000;

// ── Nostr profile search ──

/** Relays asked for a known pubkey's profile (kind 0). */
export const PROFILE_RELAYS = ['wss://purplepag.es', 'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

/** NIP-50 relays asked for name searches. They see what you search for. */
export const SEARCH_RELAYS = ['wss://relay.nostr.band', 'wss://search.nos.today', 'wss://relay.noswhere.com', 'wss://relay.ditto.pub'];

/** How long a relay query waits for slow relays before answering with what it has. */
export const NOSTR_QUERY_MAX_WAIT_MS = 2_500;

/** NIP-05 checks during a search give up sooner than payments do. */
export const NIP05_TIMEOUT_MS = 4_000;

/** Search results are reused for this long. */
export const SEARCH_CACHE_MS = 5 * 60_000;

/** The person's own Nostr pubkey (hex), optional: people they follow rank first. */
export const MY_PUBKEY_KEY = 'myPubkey';

/** Sats sent when reacting to a message with ⚡. */
export const REACTION_AMOUNT_KEY = 'reactionZapSats';

export const DEFAULT_REACTION_SATS = 21;

/** How ⚡ reactions are detected in the open WhatsApp tab: `{ ok, detail, at }`. */
export const REACTION_HOOK_STATUS_KEY = 'reactionHookStatus';

/** Show the ⚡ zap button beside messages on hover (default on). */
export const ZAP_BUTTON_KEY = 'zapButton';

/** Their follow list, cached: `{ pubkey, at, follows: string[] }`. */
export const FOLLOWS_CACHE_KEY = 'followsCache';

export const FOLLOWS_CACHE_MS = 60 * 60_000;

/** Profile pictures kept in memory by the background. */
export const AVATAR_CACHE_SIZE = 300;

/** The chosen look: `{ palette, appearance }` (see ui/themes.ts), Nostr WoT's themes. */
export const THEME_KEY = 'theme';

/** Load pictures whose host refuses cross-origin reads through the wsrv.nl image proxy (default on). */
export const PICTURE_PROXY_KEY = 'pictureProxy';

export const MAX_SEARCH_RESULTS = 20;

/** How many results get their NIP-05 checked (one HTTPS request each). */
export const NIP05_VERIFY_LIMIT = 10;
