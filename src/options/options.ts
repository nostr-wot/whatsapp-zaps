/**
 * Contacts page, also the toolbar popup: saved contacts, Nostr search,
 * settings, backup and diagnostics.
 */
import {
  DEFAULT_REACTION_SATS, DIAGNOSTICS_KEY, MAPPINGS_STORAGE_KEY, MY_PUBKEY_KEY, REACTION_AMOUNT_KEY,
  REACTION_HOOK_STATUS_KEY, TRACE_REACTIONS_MS, TRACE_REACTIONS_UNTIL_KEY, ZAP_BUTTON_KEY,
} from '../constants.ts';
import {
  normalizeName, removeMapping, saveMapping, mergeStores, sanitizeStore, withSnapshot,
  type Mapping, type MappingScope, type MappingStore,
} from '../domain/mappings.ts';
import { loadMappings, storeMappings, updateMappings } from '../services/mappingStore.ts';
import { parseSearchQuery, shortNpub, type ProfileResult } from '../domain/nostr.ts';
import type { BackgroundResponse } from '../domain/messages.ts';
import { clearDiagnostics, formatDiagnostics, loadDiagnostics } from '../services/diagnostics.ts';
import { npubEncode } from 'nostr-tools/nip19';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let statusTimer: ReturnType<typeof setTimeout> | undefined;
/** A snackbar at the bottom, as WhatsApp shows them. */
function setStatus(message: string, isError = false) {
  const status = $('status');
  status.textContent = message;
  status.className = `show${isError ? ' error' : ''}`;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => status.classList.remove('show'), isError ? 6000 : 3500);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

async function ask<T>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as BackgroundResponse<T> | undefined;
  if (!response) throw new Error('The extension background did not answer.');
  if (!response.ok) throw new Error(response.error);
  return response.value;
}

// ── People ──

/** A round initial coloured from a stable key; the picture replaces it once fetched. */
function avatar(label: string, key: string, picture: string | null | undefined): HTMLElement {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const face = el('span', `avatar hue-${hash % 6}`, [...label.replace(/^[^\p{L}\p{N}]+/u, '')][0] ?? '?');
  face.setAttribute('aria-hidden', 'true');
  if (picture) showPicture(face, picture);
  return face;
}

/** Put a profile picture (fetched by the background) over an initial. */
function showPicture(face: HTMLElement, picture: string): void {
  void ask<string | null>({ type: 'avatar', url: picture }).then(data => {
    if (!data || face.querySelector('img')) return;
    const img = el('img');
    img.alt = '';
    img.src = data;
    img.addEventListener('error', () => img.remove());
    face.append(img);
  }, () => {});
}

function chatLabel(chatKey: string): string {
  if (chatKey.startsWith('title:')) return chatKey.slice('title:'.length);
  if (chatKey.startsWith('jid:')) return chatKey.endsWith('@g.us') ? `Group ${chatKey.slice(4)}` : `Chat ${chatKey.slice(4)}`;
  return chatKey;
}

/**
 * A linked contact's picture, when the link was saved without one (older
 * links): fetch their current profile and keep its picture with the link.
 */
function refreshPicture(face: HTMLElement, scope: MappingScope, contactKey: string, mapping: Mapping): void {
  if (!mapping.pubkey || mapping.nostr?.picture) return;
  void ask<ProfileResult | null>({ type: 'profile', pubkey: mapping.pubkey }).then(async profile => {
    if (!profile?.picture) return;
    showPicture(face, profile.picture);
    await updateMappings(s => withSnapshot(s, scope, contactKey, {
      name: mapping.nostr?.name ?? profile.displayName ?? profile.name,
      nip05: mapping.nostr?.nip05 ?? (profile.nip05Verified ? profile.nip05 : null),
      picture: profile.picture,
    }));
  }, () => {});
}

/** One saved contact: who, their Nostr profile if linked, their Lightning Address. */
function contactRow(mapping: Mapping, onDelete: () => void): HTMLElement {
  const row = el('div', 'contact');
  const who = el('div', 'who');
  const top = el('div', 'line');
  top.append(el('strong', '', mapping.displayName));
  if (mapping.nostr?.name && mapping.nostr.name !== mapping.displayName) top.append(el('span', 'muted', mapping.nostr.name));
  if (mapping.nostr?.nip05) top.append(el('span', 'chip verified', `✓ ${mapping.nostr.nip05}`));
  else if (mapping.pubkey) top.append(el('span', 'chip nostr', 'Nostr'));
  who.append(top, el('span', 'ln', `⚡ ${mapping.address}`));
  if (mapping.pubkey) {
    const npub = npubEncode(mapping.pubkey);
    const line = el('span', 'muted mono', shortNpub(npub));
    line.title = npub;
    who.append(line);
  }
  const remove = el('button', 'icon', '');
  remove.type = 'button';
  remove.title = `Delete ${mapping.displayName}`;
  remove.setAttribute('aria-label', `Delete ${mapping.displayName}`);
  remove.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
  remove.addEventListener('click', onDelete);
  row.append(avatar(mapping.nostr?.name ?? mapping.displayName, mapping.pubkey ?? mapping.address, mapping.nostr?.picture), who, remove);
  return row;
}

function contactList(store: MappingStore, scope: MappingScope): HTMLElement {
  const bucket = scope.kind === 'global' ? store.global : store.groups[scope.chatKey] ?? {};
  const rows = Object.entries(bucket).sort(([, a], [, b]) => a.displayName.localeCompare(b.displayName));
  if (rows.length === 0) return el('p', 'empty', 'None saved yet.');
  const list = el('div', 'list');
  list.append(...rows.map(([contactKey, mapping]) => {
    const row = contactRow(mapping, async () => {
      await updateMappings(s => removeMapping(s, scope, contactKey));
      setStatus(`Deleted ${mapping.displayName}.`);
    });
    refreshPicture(row.querySelector('.avatar') as HTMLElement, scope, contactKey, mapping);
    return row;
  }));
  return list;
}

async function render() {
  const store = await loadMappings();
  $('global').replaceChildren(contactList(store, { kind: 'global' }));
  const count = Object.keys(store.global).length;
  $('global-count').textContent = count ? String(count) : '';
  const groups = $('groups');
  const keys = Object.keys(store.groups).sort();
  if (keys.length === 0) {
    groups.replaceChildren(el('p', 'empty', 'None saved yet.'));
    return;
  }
  groups.replaceChildren(...keys.flatMap(chatKey => [el('h3', '', chatLabel(chatKey)), contactList(store, { kind: 'chat', chatKey })]));
}

$('add-global').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const name = String(data.get('name') ?? '').trim();
  const address = String(data.get('address') ?? '').trim();
  try {
    await updateMappings(s => saveMapping(s, { kind: 'global' }, `name:${normalizeName(name)}`, name, address));
    form.reset();
    setStatus(`Saved ${name}.`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
});

// ── Nostr search ──

/** One search result, with a form to save its address under a WhatsApp name. */
function profileRow(profile: ProfileResult): HTMLElement {
  const row = el('div', 'profile');
  const who = el('div', 'who');
  const top = el('div', 'line');
  top.append(el('strong', '', profile.displayName ?? profile.name ?? 'Unnamed profile'));
  if (profile.name) top.append(el('span', 'muted', ` @${profile.name}`));
  if (profile.followed) top.append(el('span', 'chip follows', 'You follow'));
  who.append(top);
  if (profile.nip05) {
    who.append(profile.nip05Verified
      ? el('span', 'chip verified', `✓ ${profile.nip05}`)
      : el('span', 'chip unverified', `${profile.nip05} (not verified)`));
  }
  const npub = el('span', 'muted mono', shortNpub(profile.npub));
  npub.title = profile.npub;
  who.append(npub, profile.lud16 ? el('span', 'ln', `⚡ ${profile.lud16}`) : el('span', 'muted', 'No Lightning Address'));
  row.append(avatar(profile.displayName ?? profile.name ?? '?', profile.pubkey, profile.picture), who);

  if (profile.lud16) {
    const form = el('form', 'save');
    const name = el('input');
    name.required = true;
    name.value = profile.displayName ?? profile.name ?? '';
    name.placeholder = 'Name in WhatsApp';
    name.setAttribute('aria-label', `WhatsApp name for ${profile.displayName ?? profile.npub}`);
    const save = el('button', 'primary', 'Save');
    save.type = 'submit';
    form.append(name, save);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const label = name.value.trim();
      try {
        await updateMappings(s => saveMapping(s, { kind: 'global' }, `name:${normalizeName(label)}`, label, profile.lud16!, Date.now(), profile.pubkey, {
          name: profile.displayName ?? profile.name, nip05: profile.nip05Verified ? profile.nip05 : null, picture: profile.picture,
        }));
        setStatus(`Saved ${label} → ${profile.lud16}.`);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err), true);
      }
    });
    row.append(form);
  }
  return row;
}

function showSearching() {
  const status = $('search-status');
  status.textContent = 'Searching Nostr…';
  status.className = 'muted';
  $('search-results').replaceChildren(...[0, 1, 2].map(() => {
    const row = el('div', 'skeleton');
    const lines = el('span', 'skeleton-lines');
    lines.append(el('span'), el('span'));
    row.append(el('span', 'avatar skeleton-dot'), lines);
    return row;
  }));
}

function showResults(found: ProfileResult[]) {
  const status = $('search-status');
  const payable = found.filter(p => p.lud16);
  const unpayable = found.filter(p => !p.lud16);
  status.className = 'muted';
  status.textContent = payable.length
    ? (payable.some(p => p.followed) ? 'People you follow come first. ' : '') + 'Check the npub or a verified NIP-05 before saving: anyone can use any name.'
    : found.length ? 'None of these profiles has a Lightning Address.' : 'No Nostr profiles found.';
  const rows: HTMLElement[] = payable.map(profileRow);
  if (unpayable.length) {
    const more = el('button', 'small', `Show ${unpayable.length} without a Lightning Address`);
    more.type = 'button';
    more.addEventListener('click', () => more.replaceWith(...unpayable.map(profileRow)));
    rows.push(...(payable.length ? [more] : unpayable.map(profileRow)));
  }
  $('search-results').replaceChildren(...rows);
}

let searchRun = 0;
async function runSearch(query: string) {
  if (!query) return;
  const run = ++searchRun;
  showSearching();
  try {
    const found = await ask<ProfileResult[]>({ type: 'search', query });
    if (run === searchRun) showResults(found);
  } catch (err) {
    if (run !== searchRun) return;
    $('search-results').replaceChildren();
    const status = $('search-status');
    status.textContent = err instanceof Error ? err.message : String(err);
    status.className = 'error';
  }
}

const queryInput = $<HTMLInputElement>('search-query');
let typing: ReturnType<typeof setTimeout> | undefined;
queryInput.addEventListener('input', () => {
  clearTimeout(typing);
  const query = queryInput.value.trim();
  if (query.length >= 2) typing = setTimeout(() => { void runSearch(query); }, 450);
});
$('search').addEventListener('submit', event => {
  event.preventDefault();
  clearTimeout(typing);
  void runSearch(queryInput.value.trim());
});

// ── Tabs ──

const TAB_KEY = 'wz-tab';
function selectTab(id: string) {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
    const on = tab.id === id;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(tab.getAttribute('aria-controls')!).hidden = !on;
  }
  try { localStorage.setItem(TAB_KEY, id); } catch { /* a remembered tab is only a convenience */ }
}
for (const tab of document.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
  tab.addEventListener('click', () => selectTab(tab.id));
  tab.addEventListener('keydown', event => {
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const at = tabs.indexOf(tab);
    const next = event.key === 'ArrowRight' ? tabs[(at + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(at - 1 + tabs.length) % tabs.length] : null;
    if (next) { event.preventDefault(); selectTab(next.id); next.focus(); }
  });
}
try {
  const saved = localStorage.getItem(TAB_KEY);
  if (saved && document.getElementById(saved)?.getAttribute('role') === 'tab') selectTab(saved);
} catch { /* first visit, or storage blocked: People */ }

$('version').textContent = `Version ${chrome.runtime.getManifest().version}`;

const clearSearch = $<HTMLButtonElement>('search-clear');
queryInput.addEventListener('input', () => { clearSearch.hidden = !queryInput.value; });
clearSearch.addEventListener('click', () => {
  queryInput.value = '';
  clearSearch.hidden = true;
  searchRun++;
  $('search-results').replaceChildren();
  $('search-status').textContent = '';
  queryInput.focus();
});

// ── Settings ──

$<HTMLInputElement>('zap-button').addEventListener('change', async event => {
  const on = (event.currentTarget as HTMLInputElement).checked;
  await chrome.storage.local.set({ [ZAP_BUTTON_KEY]: on });
  setStatus(on ? 'The ⚡ button shows beside messages.' : 'The ⚡ button is off.');
});

async function renderSettings() {
  const stored = await chrome.storage.local.get([MY_PUBKEY_KEY, REACTION_AMOUNT_KEY, ZAP_BUTTON_KEY]);
  $<HTMLInputElement>('zap-button').checked = stored[ZAP_BUTTON_KEY] !== false;
  const me = stored[MY_PUBKEY_KEY];
  $<HTMLInputElement>('my-npub').value = typeof me === 'string' && /^[0-9a-f]{64}$/.test(me) ? npubEncode(me) : '';
  const amount = stored[REACTION_AMOUNT_KEY];
  $<HTMLInputElement>('reaction-amount').value = String(typeof amount === 'number' ? amount : DEFAULT_REACTION_SATS);
}

$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  const npubText = $<HTMLInputElement>('my-npub').value.trim();
  const amount = Number($<HTMLInputElement>('reaction-amount').value);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) {
    setStatus('The reaction amount must be a whole number of sats, from 1 to 1,000,000.', true);
    return;
  }
  let pubkey: string | null = null;
  if (npubText) {
    const parsed = parseSearchQuery(npubText);
    if (parsed?.kind !== 'pubkey') {
      setStatus('That is not an npub. Paste the npub of your own Nostr account, or leave it empty.', true);
      return;
    }
    pubkey = parsed.pubkey;
  }
  if (pubkey) await chrome.storage.local.set({ [MY_PUBKEY_KEY]: pubkey, [REACTION_AMOUNT_KEY]: amount });
  else {
    await chrome.storage.local.remove(MY_PUBKEY_KEY);
    await chrome.storage.local.set({ [REACTION_AMOUNT_KEY]: amount });
  }
  setStatus(pubkey ? 'Saved. People you follow now come first in searches.' : 'Saved.');
});

// ── Backup ──

$('export').addEventListener('click', async () => {
  const blob = new Blob([JSON.stringify(await loadMappings(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'whatsapp-zaps-mappings.json';
  a.click();
  URL.revokeObjectURL(url);
});

$('import-button').addEventListener('click', () => $<HTMLInputElement>('import').click());
$<HTMLInputElement>('import').addEventListener('change', async event => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const incoming = sanitizeStore(JSON.parse(await file.text()));
    const count = Object.keys(incoming.global).length
      + Object.values(incoming.groups).reduce((n, g) => n + Object.keys(g).length, 0);
    if (count === 0) throw new Error('No valid mappings found in that file.');
    await storeMappings(mergeStores(await loadMappings(), incoming));
    setStatus(`Imported ${count} mapping${count === 1 ? '' : 's'}.`);
  } catch (err) {
    setStatus(err instanceof SyntaxError ? 'That file is not valid JSON.' : err instanceof Error ? err.message : String(err), true);
  }
});

// ── Diagnostics ──

async function renderDiagnosticsCount() {
  const count = (await loadDiagnostics()).length;
  $('diagnostics-count').textContent = count ? `${count} recorded` : 'Nothing recorded';
  $<HTMLButtonElement>('copy-diagnostics').disabled = count === 0;
}

$('copy-diagnostics').addEventListener('click', async () => {
  const report = formatDiagnostics(await loadDiagnostics(), navigator.userAgent);
  try {
    await navigator.clipboard.writeText(report);
    setStatus('Diagnostics copied. Paste them into your message.');
  } catch {
    setStatus('Could not copy. Open the full page and try again.', true);
  }
});

async function renderReactionStatus() {
  const status = (await chrome.storage.local.get(REACTION_HOOK_STATUS_KEY))[REACTION_HOOK_STATUS_KEY] as { ok?: boolean; detail?: string; at?: number } | undefined;
  const el = $('reaction-status');
  if (!status || typeof status.at !== 'number') {
    el.textContent = '⚡ reactions: not seen yet. Open a chat in WhatsApp Web (reload the tab after installing).';
  } else if (status.ok) {
    el.textContent = `⚡ reactions: active — reading WhatsApp's own reaction data (since ${new Date(status.at).toLocaleTimeString()}).`;
  } else {
    el.textContent = `⚡ reactions: WhatsApp's reaction data is not available (${status.detail}); falling back to reading the screen.`;
  }
}

async function renderTrace() {
  const until = Number((await chrome.storage.local.get(TRACE_REACTIONS_UNTIL_KEY))[TRACE_REACTIONS_UNTIL_KEY]) || 0;
  $<HTMLInputElement>('trace-reactions').checked = until > Date.now();
}

$<HTMLInputElement>('trace-reactions').addEventListener('change', async event => {
  const on = (event.currentTarget as HTMLInputElement).checked;
  await chrome.storage.local.set({ [TRACE_REACTIONS_UNTIL_KEY]: on ? Date.now() + TRACE_REACTIONS_MS : 0 });
  setStatus(on ? 'Recording for 10 minutes. Reload WhatsApp, react with ⚡ once, then copy the diagnostics.' : 'Stopped recording.');
});

$('clear-diagnostics').addEventListener('click', async () => {
  await clearDiagnostics();
  setStatus('Diagnostics cleared.');
});

// In the toolbar popup, backup (which needs file dialogs that close popups) lives on the full page.
document.getElementById('open-full')?.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); window.close(); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (MAPPINGS_STORAGE_KEY in changes) void render();
  if (DIAGNOSTICS_KEY in changes) void renderDiagnosticsCount();
  if (REACTION_HOOK_STATUS_KEY in changes) void renderReactionStatus();
void renderTrace();
void renderReactionStatus();
});

void render();
void renderSettings();
void renderDiagnosticsCount();
void renderTrace();
void renderReactionStatus();
