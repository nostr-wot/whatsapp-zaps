/**
 * Local diagnostics for problems on WhatsApp's page that cannot be reproduced
 * without its real markup (above all, making mentions).
 *
 * Kept only in this browser. They contain the markup of WhatsApp's message
 * box and mention list, including the names shown there, and leave the
 * browser only if the person copies them.
 */
import { DIAGNOSTICS_KEY, MAX_DIAGNOSTICS } from '../constants.ts';

export interface Diagnostic {
  at: number;
  what: string;
  version: string;
  details: Record<string, string>;
}

export async function recordDiagnostic(what: string, details: Record<string, string>): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(DIAGNOSTICS_KEY);
    const list = Array.isArray(stored[DIAGNOSTICS_KEY]) ? stored[DIAGNOSTICS_KEY] as Diagnostic[] : [];
    const entry: Diagnostic = { at: Date.now(), what, version: chrome.runtime.getManifest().version, details };
    await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: [...list, entry].slice(-MAX_DIAGNOSTICS) });
  } catch {
    // Diagnostics must never get in the way of the zap itself.
  }
}

export async function loadDiagnostics(): Promise<Diagnostic[]> {
  const stored = await chrome.storage.local.get(DIAGNOSTICS_KEY);
  return Array.isArray(stored[DIAGNOSTICS_KEY]) ? stored[DIAGNOSTICS_KEY] as Diagnostic[] : [];
}

export async function clearDiagnostics(): Promise<void> {
  await chrome.storage.local.remove(DIAGNOSTICS_KEY);
}

/** Plain-text report for pasting into a message. */
export function formatDiagnostics(list: Diagnostic[], userAgent: string): string {
  if (list.length === 0) return 'No diagnostics recorded.';
  return [
    `WhatsApp Web Zaps diagnostics — ${list.length} entr${list.length === 1 ? 'y' : 'ies'}`,
    `Browser: ${userAgent}`,
    ...list.map(d => [
      '',
      `── ${new Date(d.at).toISOString()} · ${d.what} · v${d.version}`,
      ...Object.entries(d.details).map(([k, v]) => `[${k}]\n${v}`),
    ].join('\n')),
  ].join('\n');
}
