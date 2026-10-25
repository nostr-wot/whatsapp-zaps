/**
 * ⚡ reactions, read from WhatsApp's own data rather than from its screen.
 *
 * Every reaction WhatsApp Web stores — sent, received, changed, removed —
 * passes through its `WAWebAddonReactionTableMode` module
 * (`reactionTableMode.bulkUpsert`); whatsapp-web.js listens there for its
 * `message_reaction` event. Wrapping that function lets this extension see the
 * person's own ⚡ reaction, the message it is on and that message's author,
 * whatever WhatsApp's reaction picker and badges look like.
 *
 * Read-only: WhatsApp's function always runs, unchanged and first; nothing
 * here can make it fail. Runs in the page (MAIN world), where WhatsApp's
 * modules live, and only once a chat is open, so it never interferes with
 * WhatsApp starting up.
 */

export const REACTION_EVENT = 'WAZAPS_REACTION';
export const HOOK_STATUS_EVENT = 'WAZAPS_REACTION_HOOK';

export interface ReactionZapEvent {
  type: typeof REACTION_EVENT;
  /** The message reacted to, serialized as in WhatsApp's data-id. */
  messageId: string;
  chatId: string | null;
  /** Its author's contact id; null when it is the person's own message. */
  authorId: string | null;
  authorName: string | null;
  parentFromMe: boolean;
}

export interface HookStatusEvent {
  type: typeof HOOK_STATUS_EVENT;
  ok: boolean;
  detail: string;
}

const LIGHTNING = /^⚡️?$/;

/** Only reactions this recent count: older ones arrive when WhatsApp syncs. */
const MAX_AGE_MS = 2 * 60_000;

/** And only right after the person used this page: not reactions made on their phone. */
const GESTURE_WINDOW_MS = 15_000;

type Wid = { _serialized?: string; $1?: string } | string | null | undefined;

/** WhatsApp ids are objects with `_serialized` (or a minified `$1`). */
export function serialize(id: Wid): string | null {
  if (!id) return null;
  if (typeof id === 'string') return id;
  return id._serialized ?? id.$1 ?? null;
}

interface RawReaction {
  id?: { fromMe?: boolean } & object;
  author?: Wid;
  from?: Wid;
  reactionText?: string;
  reactionTimestamp?: number;
  reactionParentKey?: { fromMe?: boolean; remote?: Wid; participant?: Wid } & object;
}

export interface ReactionContext {
  now: number;
  /** When the person last clicked or typed on this page. */
  gestureAt: number;
  contactName: (id: string) => string | null;
  /** The person's own ids (phone-number and LID), for reactions that do not say fromMe. */
  meIds?: () => string[];
}

/** The zap a stored reaction asks for, or null: only the person's own, fresh ⚡. */
export function reactionToZap(reaction: RawReaction, ctx: ReactionContext): ReactionZapEvent | null {
  if (!reaction || !LIGHTNING.test((reaction.reactionText ?? '').trim())) return null;
  const sender = serialize(reaction.author ?? reaction.from);
  const own = reaction.id?.fromMe === true
    || (reaction.id?.fromMe === undefined && !!sender && (ctx.meIds?.() ?? []).includes(sender));
  if (!own) return null;
  // Milliseconds as stored today; seconds are accepted too.
  let at = Number(reaction.reactionTimestamp);
  if (at > 0 && at < 1e12) at *= 1000;
  if (!Number.isFinite(at) || ctx.now - at > MAX_AGE_MS || at - ctx.now > MAX_AGE_MS) return null;
  if (ctx.now - ctx.gestureAt > GESTURE_WINDOW_MS) return null;
  const parent = reaction.reactionParentKey;
  const messageId = serialize(parent as Wid);
  if (!parent || !messageId) return null;
  const parentFromMe = parent.fromMe === true;
  const chatId = serialize(parent.remote);
  const authorId = parentFromMe ? null : serialize(parent.participant) ?? chatId;
  return {
    type: REACTION_EVENT,
    messageId,
    chatId,
    authorId,
    authorName: authorId ? ctx.contactName(authorId) : null,
    parentFromMe,
  };
}

type Require = (name: string) => unknown;

interface ReactionTable { bulkUpsert: (...args: never[]) => unknown }

/** Wrap the table's bulkUpsert so `observe` sees each batch; WhatsApp's function always runs first. */
export function wrapBulkUpsert(table: ReactionTable, observe: (reactions: RawReaction[]) => void): boolean {
  const original = table.bulkUpsert;
  if (typeof original !== 'function' || (original as { __wazaps?: boolean }).__wazaps) return false;
  const wrapped = function (this: unknown, ...args: unknown[]) {
    const result = (original as (...a: unknown[]) => unknown).apply(this ?? table, args);
    try {
      if (Array.isArray(args[0])) observe(args[0] as RawReaction[]);
    } catch {
      // Never let this extension affect WhatsApp.
    }
    return result;
  };
  (wrapped as { __wazaps?: boolean }).__wazaps = true;
  table.bulkUpsert = wrapped as ReactionTable['bulkUpsert'];
  return true;
}

function meIdsFrom(require: Require): () => string[] {
  return () => {
    try {
      const me = require('WAWebUserPrefsMeUser') as { getMaybeMePnUser?: () => Wid; getMaybeMeLidUser?: () => Wid };
      return [me?.getMaybeMePnUser?.(), me?.getMaybeMeLidUser?.()].map(serialize).filter((id): id is string => !!id);
    } catch {
      return [];
    }
  };
}

function contactNameFrom(require: Require): (id: string) => string | null {
  return id => {
    try {
      const collections = require('WAWebCollections') as { Contact?: { get(id: string): Record<string, unknown> | undefined } };
      const contact = collections?.Contact?.get(id);
      const name = contact?.name ?? contact?.pushname ?? contact?.verifiedName ?? contact?.formattedName;
      return typeof name === 'string' && name.trim() ? name.trim() : null;
    } catch {
      return null;
    }
  };
}

/**
 * Hook reactions once WhatsApp is up (a chat is open), retrying for a while
 * since its modules load after the page. Reports through `post`.
 */
export function installReactionHook(
  win: Window & { require?: Require },
  post: (message: ReactionZapEvent | HookStatusEvent) => void,
  options: { intervalMs?: number; giveUpMs?: number; now?: () => number } = {},
): () => void {
  const now = options.now ?? Date.now;
  let gestureAt = -Infinity;
  const onGesture = () => { gestureAt = now(); };
  win.addEventListener('pointerdown', onGesture, true);
  win.addEventListener('keydown', onGesture, true);

  const started = now();
  let lastError = 'WhatsApp has not opened a chat yet';
  const attempt = (): boolean => {
    if (!win.document.querySelector('#main')) return false;
    const require = win.require;
    if (typeof require !== 'function') { lastError = 'window.require is not available'; return false; }
    let table: ReactionTable | undefined;
    try {
      table = (require('WAWebAddonReactionTableMode') as { reactionTableMode?: ReactionTable })?.reactionTableMode;
    } catch (err) {
      lastError = `WAWebAddonReactionTableMode: ${err instanceof Error ? err.message : String(err)}`;
      return false;
    }
    if (!table || typeof table.bulkUpsert !== 'function') {
      lastError = 'reactionTableMode.bulkUpsert not found';
      return false;
    }
    const contactName = contactNameFrom(require);
    const meIds = meIdsFrom(require);
    wrapBulkUpsert(table, reactions => {
      for (const reaction of reactions) {
        const zap = reactionToZap(reaction, { now: now(), gestureAt, contactName, meIds });
        if (zap) post(zap);
      }
    });
    post({ type: HOOK_STATUS_EVENT, ok: true, detail: 'listening to WhatsApp’s reactions' });
    return true;
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  if (!attempt()) {
    timer = setInterval(() => {
      if (attempt()) { clearInterval(timer); return; }
      if (now() - started > (options.giveUpMs ?? 10 * 60_000)) {
        clearInterval(timer);
        post({ type: HOOK_STATUS_EVENT, ok: false, detail: lastError });
      }
    }, options.intervalMs ?? 1_000);
  }
  return () => {
    clearInterval(timer);
    win.removeEventListener('pointerdown', onGesture, true);
    win.removeEventListener('keydown', onGesture, true);
  };
}

/** Validate an event from the page before acting on it (the page can post anything). */
export function isReactionZapEvent(data: unknown): data is ReactionZapEvent {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  const optionalString = (v: unknown) => v === null || (typeof v === 'string' && v.length <= 200);
  return d.type === REACTION_EVENT
    && typeof d.messageId === 'string' && d.messageId.length > 0 && d.messageId.length <= 300
    && optionalString(d.chatId) && optionalString(d.authorId) && optionalString(d.authorName)
    && typeof d.parentFromMe === 'boolean';
}

export function isHookStatusEvent(data: unknown): data is HookStatusEvent {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.type === HOOK_STATUS_EVENT && typeof d.ok === 'boolean' && typeof d.detail === 'string' && d.detail.length <= 500;
}
