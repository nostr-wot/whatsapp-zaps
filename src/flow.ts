/**
 * The zap flow, from parsed command to paid invoice.
 *
 * Every side effect is injected so the order of operations — and in
 * particular "one invoice, one payment attempt, never retried" — can be tested
 * without WhatsApp, a wallet or the network.
 */
import {
  normalizeText, parseZapCommand, zapChatMessage, zapMessage, type ChatKind, type ChatMessage, type Mention,
} from './domain/command.ts';
import { contactKeyFor, resolveRecipient, type Mapping, type MappingScope, type MappingStore } from './domain/mappings.ts';
import type { RecipientInfo } from './domain/messages.ts';
import type { PayOutcome } from './domain/bridge.ts';
import { explainLookupError } from './domain/errors.ts';

export interface Candidate {
  contactKey: string;
  mapping: Mapping;
  scope: MappingScope;
}

export interface ConfirmDetails {
  name: string;
  recipient: RecipientInfo;
  amountSats: number;
  comment: string;
  /** The message that would be posted in the chat once the payment is confirmed. */
  chatMessage: ChatMessage;
  /** Whether "post it after paying" starts ticked (the person's last choice). */
  postByDefault: boolean;
}

/** The person's answer on the confirm screen. */
export type ConfirmAnswer = false | { post: boolean };

/** What happened in the chat after a confirmed payment. */
export interface ChatAftermath {
  /** The `/zap` command is gone from the message box. */
  commandCleared: boolean;
  /** 'sent': the message was posted; 'not_sent': it could not be (shown for copying); null: not asked for. */
  message: 'sent' | 'not_sent' | null;
}

export interface AddressAnswer {
  address: string;
  /** Where to remember it; null means "just this once". */
  remember: 'chat' | 'global' | null;
  /** Nostr pubkey when the address was picked from a profile search. */
  pubkey?: string;
}

export interface ZapUi {
  /**
   * Ask for a Lightning Address for `name`. `chatTitle` is null when the chat
   * cannot be identified, and then "remember for this chat" is not offered.
   * Null when cancelled.
   */
  askAddress(name: string, chatTitle: string | null, error?: string): Promise<AddressAnswer | null>;
  /** Pick one of several contacts that share a name. Null when cancelled. */
  choose(name: string, candidates: Candidate[]): Promise<Candidate | null>;
  showLoading(message: string): void;
  /** Show the payment summary. False when cancelled, otherwise whether to post the message after paying. */
  confirm(details: ConfirmDetails): Promise<ConfirmAnswer>;
  /** The same command was paid moments ago: ask before paying again. True to pay again. */
  confirmRepeat(minutesAgo: number, details: { name: string; amountSats: number }): Promise<boolean>;
  /** Show the result, and for a confirmed payment what happened in the chat. */
  showResult(outcome: PayOutcome, details: ConfirmDetails, aftermath: ChatAftermath | null): Promise<void>;
  /** Show an error that ended the flow before anything was paid. */
  showError(message: string): Promise<void>;
  close(): void;
}

export interface ZapDeps {
  ui: ZapUi;
  loadMappings(): Promise<MappingStore>;
  saveMapping(scope: MappingScope, contactKey: string, displayName: string, address: string, pubkey?: string): Promise<void>;
  resolve(address: string): Promise<RecipientInfo>;
  invoice(address: string, amountSats: number, comment: string): Promise<{ bolt11: string; amountSats: number }>;
  pay(bolt11: string): Promise<PayOutcome>;
  /** Replace the `/zap` command in the box with `message` and send it. True once sent. */
  postMessage(message: ChatMessage): Promise<boolean>;
  /** Remove the `/zap` command from the box. True once the box was checked empty. */
  clearComposer(): Promise<boolean>;
  /** When this exact command was last paid in this chat (ms epoch), if recently. */
  lastPaid(commandKey: string): number | null;
  /** Remember that this command was paid, so a repeat asks first. */
  markPaid(commandKey: string): void;
  /** Remember whether the person wants the message posted after paying. */
  setPostPreference(post: boolean): void;
  postByDefault: boolean;
  now?: () => number;
}

/** A command plus where it was typed: the same text in another chat is a different zap. */
export function commandKey(text: string, chatKey: string | null): string {
  return `${chatKey ?? '?'}|${normalizeText(text).toLowerCase()}`;
}

export interface ChatContext {
  chatKey: string | null;
  chatTitle: string | null;
  /** The other person, in a one-to-one chat. `/zap 1000` with no mention pays them. */
  contact?: Mention | null;
  /** True only when the chat is known to be a group; null when it could not be told. */
  isGroup?: boolean | null;
  /** The author of the message being replied to, when a reply is open. */
  replyTo?: { name: string | null; id: string | null; fromMe: boolean } | null;
}

function chatKind(chat: ChatContext): ChatKind {
  if (chat.isGroup === true) return 'group';
  if (chat.isGroup === false) return 'private';
  return 'unknown';
}

export type FlowResult = 'invalid' | 'cancelled' | 'error' | PayOutcome['outcome'];

/** Pick the address: from mappings, a disambiguation, or by asking. */
async function pickAddress(
  deps: ZapDeps,
  chat: ChatContext,
  recipient: Mention,
): Promise<{ address: string; info: RecipientInfo } | null> {
  const store = await deps.loadMappings();
  const resolution = resolveRecipient(store, chat.chatKey, recipient);

  let address: string | null = null;
  if (resolution.kind === 'found') address = resolution.mapping.address;
  if (resolution.kind === 'ambiguous') {
    const picked = await deps.ui.choose(recipient.label, resolution.candidates);
    if (!picked) return null;
    address = picked.mapping.address;
  }

  let error: string | undefined;
  for (;;) {
    let answer: AddressAnswer | null = null;
    if (!address) {
      answer = await deps.ui.askAddress(recipient.label, chat.chatKey ? chat.chatTitle ?? 'this chat' : null, error);
      if (!answer) return null;
      address = answer.address;
    }
    deps.ui.showLoading(`Looking up ${address}…`);
    try {
      const info = await deps.resolve(address);
      // Only remember an address that resolved.
      const scope: MappingScope | null = answer?.remember === 'global' ? { kind: 'global' }
        : answer?.remember === 'chat' && chat.chatKey ? { kind: 'chat', chatKey: chat.chatKey } : null;
      if (scope) await deps.saveMapping(scope, contactKeyFor(recipient), recipient.label, info.address, answer?.pubkey);
      return { address: info.address, info };
    } catch (err) {
      error = explainLookupError(address, err);
      address = null;
    }
  }
}

/**
 * Run one `/zap`. Returns how it ended; the caller only needs this for tests
 * and logging — all user-facing feedback goes through `deps.ui`.
 */
export async function runZap(text: string, mentions: Mention[], chat: ChatContext, deps: ZapDeps): Promise<FlowResult> {
  const detected = chatKind(chat);
  const parsed = parseZapCommand(text, mentions, detected);
  if (!parsed.ok) {
    await deps.ui.showError(parsed.error);
    deps.ui.close();
    return 'invalid';
  }
  const { amountSats, comment } = parsed.command;
  // A mention picked from WhatsApp's list only exists in groups: trust it over
  // the page-based guess, which can fail on WhatsApp's real markup.
  const kind: ChatKind = parsed.command.recipientPicked ? 'group' : detected;
  // Who is paid, in order: someone mentioned in the command; the author of the
  // message being replied to; in a private chat (or one that could not be told
  // apart), the person the chat is with. Only a group needs one of the first two.
  const reply = kind === 'private' ? null : chat.replyTo ?? null;
  if (!parsed.command.recipient && reply?.fromMe) {
    await deps.ui.showError('That is your own message. Reply to someone else’s message, or mention them: /zap @name amount');
    deps.ui.close();
    return 'invalid';
  }
  const replyRecipient: Mention | null = reply && (reply.name || reply.id)
    ? { label: reply.name ?? reply.id!.replace(/@.*/, ''), id: reply.id }
    : null;
  const source = parsed.command.recipient ? 'command' : replyRecipient ? 'reply' : 'chat';
  const recipient = parsed.command.recipient
    ?? replyRecipient
    ?? chat.contact
    ?? (kind === 'group' ? null : { label: chat.chatTitle ?? 'this contact', id: null });
  if (!recipient) {
    await deps.ui.showError('This is a group: reply to their message with /zap amount, or mention them: /zap @name amount');
    deps.ui.close();
    return 'invalid';
  }

  try {
    const picked = await pickAddress(deps, chat, recipient);
    if (!picked) {
      deps.ui.close();
      return 'cancelled';
    }
    const details: ConfirmDetails = {
      name: recipient.label, recipient: picked.info, amountSats, comment,
      // - paying the person the chat is with: "Zapped you";
      // - a picked mention: kept as the real mention, whatever the page guess says;
      // - a typed name or a reply's author: plain text in a chat known to be
      //   private (WhatsApp has no mentions there), otherwise a mention made
      //   through WhatsApp's list. Sent while the reply is open, the message
      //   also goes out as a reply to their message.
      chatMessage: source === 'chat'
        ? zapChatMessage(null, amountSats, comment)
        : kind === 'private'
          ? { text: zapMessage(recipient.label, amountSats, comment) }
          : zapChatMessage(recipient, amountSats, comment),
      postByDefault: deps.postByDefault,
    };

    if (amountSats < picked.info.minSats || amountSats > picked.info.maxSats) {
      await deps.ui.showError(
        picked.info.maxSats < picked.info.minSats
          ? `${picked.address} does not accept any whole-sat amount.`
          : `${picked.address} accepts between ${picked.info.minSats.toLocaleString('en-US')} and ${picked.info.maxSats.toLocaleString('en-US')} sats.`,
      );
      deps.ui.close();
      return 'error';
    }

    // The same command, just paid: almost always a box that was not cleared, not a second zap.
    const key = commandKey(text, chat.chatKey);
    const paidAt = deps.lastPaid(key);
    if (paidAt !== null) {
      const minutesAgo = Math.max(0, Math.round(((deps.now?.() ?? Date.now()) - paidAt) / 60_000));
      if (!(await deps.ui.confirmRepeat(minutesAgo, { name: recipient.label, amountSats }))) {
        await deps.clearComposer();
        deps.ui.close();
        return 'cancelled';
      }
    }

    const answer = await deps.ui.confirm(details);
    if (!answer) {
      deps.ui.close();
      return 'cancelled';
    }
    deps.setPostPreference(answer.post);

    deps.ui.showLoading('Requesting invoice…');
    const invoice = await deps.invoice(picked.address, amountSats, comment);

    // From here on, exactly one payment attempt. No retry on any outcome.
    deps.ui.showLoading('Waiting for your wallet…');
    const outcome: PayOutcome = await deps.pay(invoice.bolt11)
      .catch((err: unknown) => ({ outcome: 'unknown' as const, error: errorMessage(err) }));

    // Only a confirmed payment (the wallet returned its proof) touches the chat.
    let aftermath: ChatAftermath | null = null;
    if (outcome.outcome === 'paid') {
      deps.markPaid(key);
      if (answer.post) {
        deps.ui.showLoading('Paid. Posting in the chat…');
        const sent = await deps.postMessage(details.chatMessage).catch(() => false);
        aftermath = sent
          ? { commandCleared: true, message: 'sent' }
          : { commandCleared: await deps.clearComposer().catch(() => false), message: 'not_sent' };
      } else {
        aftermath = { commandCleared: await deps.clearComposer().catch(() => false), message: null };
      }
    }
    await deps.ui.showResult(outcome, details, aftermath);
    deps.ui.close();
    return outcome.outcome;
  } catch (err) {
    // Lookup, mapping or invoice failures; pay() errors are caught above.
    await deps.ui.showError(errorMessage(err));
    deps.ui.close();
    return 'error';
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
