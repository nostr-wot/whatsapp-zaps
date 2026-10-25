/** Turn a failed Lightning Address lookup into something a person can act on. */
export function explainLookupError(address: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const domain = address.split('@')[1] ?? address;
  if (/endpoint returned 404/.test(message)) {
    return `${address} is not a Lightning Address: ${domain} has no wallet by that name. Check the spelling, or search Nostr for the person — a Nostr address (NIP-05) looks the same but is not a Lightning Address.`;
  }
  if (/could not reach the endpoint/.test(message)) {
    return `${domain} did not answer. It may not support Lightning Addresses, or it may be down.`;
  }
  return `${address}: ${message}`;
}
