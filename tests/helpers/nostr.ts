import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';

export interface Person { sk: Uint8Array; pubkey: string }

export function person(): Person {
  const sk = generateSecretKey();
  return { sk, pubkey: getPublicKey(sk) };
}

/** A signed kind-0 profile. */
export function profileEvent(who: Person, content: Record<string, unknown> | string, createdAt = 1_700_000_000): Event {
  return finalizeEvent({
    kind: 0,
    created_at: createdAt,
    tags: [],
    content: typeof content === 'string' ? content : JSON.stringify(content),
  }, who.sk);
}
