/**
 * The "Nostr profile" popup opened from the chat header's ⋮ menu.
 *
 * It shows who the open chat's contact (or a group's members) is linked to,
 * and links or unlinks a Nostr profile or a plain Lightning Address. Links
 * are stored only in this browser (chrome.storage.local). Nothing is looked
 * up until the person asks: a search goes to Nostr relays, and a new address
 * is checked once against its own Lightning server before it is saved.
 */
import {
  findMapping, normalizeName, type Mapping, type MappingScope, type MappingStore, type NostrSnapshot,
} from './domain/mappings.ts';
import type { ChatContact } from './whatsapp/dom.ts';
import type { RecipientInfo } from './domain/messages.ts';
import { explainLookupError } from './domain/errors.ts';

export interface LinkedMember {
  contactKey: string;
  mapping: Mapping;
}

export interface LinkView {
  contact: ChatContact;
  /** A one-to-one chat's current link. */
  current: LinkedMember | null;
  /** A group's linked members. */
  members: LinkedMember[];
}

export type LinkAnswer =
  | { action: 'link'; memberName?: string; address: string; pubkey?: string; nostr?: NostrSnapshot }
  | { action: 'unlink'; contactKey: string }
  | null;

export interface LinkUi {
  /** Show the popup; resolves with what the person did, or null when closed. */
  link(view: LinkView, notice?: { text: string; error?: boolean }): Promise<LinkAnswer>;
  close(): void;
}

export interface LinkDeps {
  ui: LinkUi;
  loadMappings(): Promise<MappingStore>;
  saveMapping(scope: MappingScope, contactKey: string, displayName: string, address: string, pubkey?: string, nostr?: NostrSnapshot): Promise<void>;
  removeMapping(scope: MappingScope, contactKey: string): Promise<void>;
  /** Check that a Lightning Address answers before saving it. */
  resolve(address: string): Promise<RecipientInfo>;
}

/** Where a contact's link lives: globally for a person, in the group for a member. */
export function linkScope(contact: ChatContact): MappingScope {
  return contact.kind === 'group' ? { kind: 'chat', chatKey: contact.chatKey } : { kind: 'global' };
}

/** Keys a one-to-one contact may be stored under, best first. */
export function contactKeys(contact: Extract<ChatContact, { kind: 'contact' }>): string[] {
  return [...(contact.id ? [`id:${contact.id}`] : []), `name:${normalizeName(contact.name)}`];
}

export function buildLinkView(store: MappingStore, contact: ChatContact): LinkView {
  if (contact.kind === 'group') {
    const bucket = store.groups[contact.chatKey] ?? {};
    const members = Object.entries(bucket)
      .map(([contactKey, mapping]) => ({ contactKey, mapping }))
      .sort((a, b) => a.mapping.displayName.localeCompare(b.mapping.displayName));
    return { contact, current: null, members };
  }
  for (const key of contactKeys(contact)) {
    const mapping = findMapping(store, { kind: 'global' }, key);
    if (mapping) return { contact, current: { contactKey: key, mapping }, members: [] };
  }
  return { contact, current: null, members: [] };
}

/** Run the popup until the person closes it. */
export async function runLinkPopup(contact: ChatContact, deps: LinkDeps): Promise<void> {
  const scope = linkScope(contact);
  let notice: { text: string; error?: boolean } | undefined;
  try {
    for (;;) {
      const view = buildLinkView(await deps.loadMappings(), contact);
      const answer = await deps.ui.link(view, notice);
      if (!answer) return;

      if (answer.action === 'unlink') {
        await deps.removeMapping(scope, answer.contactKey);
        notice = { text: 'Unlinked.' };
        continue;
      }

      const displayName = contact.kind === 'group' ? (answer.memberName ?? '').trim() : contact.name;
      if (!displayName) {
        notice = { text: 'Type the member’s name as it appears in this group.', error: true };
        continue;
      }
      try {
        const info = await deps.resolve(answer.address);
        // A one-to-one chat replaces whatever key the contact had; a group member is keyed by name.
        const key = contact.kind === 'group' ? `name:${normalizeName(displayName)}` : contactKeys(contact)[0];
        if (view.current && view.current.contactKey !== key) await deps.removeMapping(scope, view.current.contactKey);
        await deps.saveMapping(scope, key, displayName, info.address, answer.pubkey, answer.pubkey ? answer.nostr : undefined);
        notice = { text: `Linked ${displayName} → ${info.address}.` };
      } catch (err) {
        notice = { text: explainLookupError(answer.address, err), error: true };
      }
    }
  } finally {
    deps.ui.close();
  }
}
