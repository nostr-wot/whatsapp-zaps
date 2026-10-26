/**
 * Surviving an extension update or removal while WhatsApp stays open.
 *
 * When the extension is replaced or removed, Chrome cuts the scripts it had
 * put into open tabs off from the extension: `chrome.storage` and friends
 * disappear ("Cannot read properties of undefined (reading 'local')"), but
 * their event listeners keep running. A new version only loads after the tab
 * is reloaded, or (when the new one is injected) runs next to the old copy.
 *
 * Each copy marks the page with its own id on start. A copy that lost the
 * extension then either steps aside (a newer copy owns the page) or, when it
 * is the only one left, keeps `/zap` from being sent and asks for a reload.
 */
export const INSTANCE_ATTR = 'data-whatsapp-zaps-instance';

export type LifecycleState = 'active' | 'replaced' | 'orphaned';

interface ChromeLike {
  runtime?: { id?: string };
  storage?: { local?: unknown };
}

/** True while this script can still reach the extension. */
export function isExtensionAlive(chromeLike: ChromeLike | undefined = (globalThis as { chrome?: ChromeLike }).chrome): boolean {
  try {
    return !!chromeLike?.runtime?.id && !!chromeLike.storage?.local;
  } catch {
    return false;
  }
}

/** Mark the page as handled by this copy. A newer copy overwrites it. */
export function claimPage(doc: Document, id: string): void {
  doc.documentElement.setAttribute(INSTANCE_ATTR, id);
}

export function lifecycleState(doc: Document, id: string, alive: boolean): LifecycleState {
  if (alive) return 'active';
  const owner = doc.documentElement.getAttribute(INSTANCE_ATTR);
  return owner && owner !== id ? 'replaced' : 'orphaned';
}

export const RELOAD_MESSAGE = 'WhatZaps was updated or removed. Reload this page (F5) to use /zap again. Nothing was paid.';
