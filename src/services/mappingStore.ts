/** chrome.storage.local persistence for contact → Lightning Address mappings. */
import { MAPPINGS_STORAGE_KEY } from '../constants.ts';
import { sanitizeStore, type MappingStore } from '../domain/mappings.ts';

export async function loadMappings(): Promise<MappingStore> {
  const stored = await chrome.storage.local.get(MAPPINGS_STORAGE_KEY);
  return sanitizeStore(stored[MAPPINGS_STORAGE_KEY]);
}

export async function storeMappings(store: MappingStore): Promise<void> {
  await chrome.storage.local.set({ [MAPPINGS_STORAGE_KEY]: store });
}

/** Load, transform, save. Returns the saved store. */
export async function updateMappings(change: (store: MappingStore) => MappingStore): Promise<MappingStore> {
  const next = change(await loadMappings());
  await storeMappings(next);
  return next;
}
