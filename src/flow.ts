/**
 * The zap flow, from parsed command to paid invoice.
 *
 * Every side effect is injected so the order of operations — and in
 * particular "one invoice, one payment attempt, never retried" — can be tested
 * without WhatsApp, a wallet or the network.
 */
import { parseZapCommand, zapMessage, type Mention } from './domain/command.ts';
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
  /** Show the payment summary. True when the user confirms. */
  confirm(details: ConfirmDetails): Promise<boolean>;
  /** Show the result. Resolves 'insert' when the user wants the chat message. */
  showResult(outcome: PayOutcome, details: ConfirmDetails): Promise<'insert' | 'close'>;
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
  /** Replace the composer text with the post-zap message (not sent). */
  insertMessage(text: string): void;
  /** Remove the `/zap` command from the composer. */
  clearComposer(): void;
}

export interface ChatContext {
  chatKey: string | null;
  chatTitle: string | null;
  /** The other person, in a one-to-one chat. `/zap 1000` with no mention pays them. */
  contact?: Mention | null;
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
  const parsed = parseZapCommand(text, mentions);
  if (!parsed.ok) {
    await deps.ui.showError(parsed.error);
    deps.ui.close();
    return 'invalid';
  }
  const { amountSats, comment } = parsed.command;
  const recipient = parsed.command.recipient ?? chat.contact ?? null;
  if (!recipient) {
    await deps.ui.showError('In a group, say who to zap: /zap @name amount');
    deps.ui.close();
    return 'invalid';
  }

  try {
    const picked = await pickAddress(deps, chat, recipient);
    if (!picked) {
      deps.ui.close();
      return 'cancelled';
    }
    const details: ConfirmDetails = { name: recipient.label, recipient: picked.info, amountSats, comment };

    if (amountSats < picked.info.minSats || amountSats > picked.info.maxSats) {
      await deps.ui.showError(
        picked.info.maxSats < picked.info.minSats
          ? `${picked.address} does not accept any whole-sat amount.`
          : `${picked.address} accepts between ${picked.info.minSats.toLocaleString('en-US')} and ${picked.info.maxSats.toLocaleString('en-US')} sats.`,
      );
      deps.ui.close();
      return 'error';
    }

    if (!(await deps.ui.confirm(details))) {
      deps.ui.close();
      return 'cancelled';
    }

    deps.ui.showLoading('Requesting invoice…');
    const invoice = await deps.invoice(picked.address, amountSats, comment);

    // From here on, exactly one payment attempt. No retry on any outcome.
    deps.ui.showLoading('Waiting for your wallet…');
    const outcome: PayOutcome = await deps.pay(invoice.bolt11)
      .catch((err: unknown) => ({ outcome: 'unknown' as const, error: errorMessage(err) }));

    if (outcome.outcome === 'paid') deps.clearComposer();
    const choice = await deps.ui.showResult(outcome, details);
    if (outcome.outcome === 'paid' && choice === 'insert') deps.insertMessage(zapMessage(recipient.label, amountSats));
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
