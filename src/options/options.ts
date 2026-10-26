/**
 * Contacts page, also the toolbar popup: saved contacts, Nostr search,
 * settings, backup and diagnostics.
 */
import {
  DEFAULT_REACTION_SATS, DIAGNOSTICS_KEY, MAPPINGS_STORAGE_KEY, MY_PUBKEY_KEY, REACTION_AMOUNT_KEY,
  PICTURE_PROXY_KEY, REACTION_HOOK_STATUS_KEY, THEME_KEY, TRACE_REACTIONS_MS, TRACE_REACTIONS_UNTIL_KEY, ZAP_BUTTON_KEY,
} from '../constants.ts';
import {
  connectMapping, editMapping, normalizeName, removeMapping, saveMapping, mergeStores, sanitizeStore, withSnapshot,
  type Mapping, type MappingScope, type MappingStore,
} from '../domain/mappings.ts';
import { PALETTES, hasAppearance, parseThemeChoice, resolveTheme, type Appearance, type PaletteId, type ThemeChoice } from '../ui/themes.ts';
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

/** A round initial in the theme's colours; the picture covers it once loaded. */
function avatar(label: string, picture: string | null | undefined): HTMLElement {
  const face = el('span', 'avatar', [...label.replace(/^[^\p{L}\p{N}]+/u, '')][0] ?? '?');
  face.setAttribute('aria-hidden', 'true');
  if (picture) showPicture(face, picture);
  return face;
}

/**
 * Put a profile picture over an initial. Extension pages may show outside
 * images directly, so no fetch, size limit or CORS gets in the way here; a
 * broken link just leaves the initial.
 */
function showPicture(face: HTMLElement, picture: string): void {
  if (face.querySelector('img') || !/^https:\/\//.test(picture)) return;
  const img = el('img');
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.addEventListener('error', () => img.remove());
  img.src = picture;
  face.append(img);
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

const PENCIL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m14 6 4 4"/></svg>';

/** The row turned into a small form to change the name and Lightning Address. */
function editRow(row: HTMLElement, mapping: Mapping, scope: MappingScope, contactKey: string): void {
  const form = el('form', 'edit');
  const name = el('input');
  name.value = mapping.displayName;
  name.required = true;
  name.setAttribute('aria-label', 'Name as shown in WhatsApp');
  const address = el('input');
  address.value = mapping.address;
  address.required = true;
  address.spellcheck = false;
  address.setAttribute('aria-label', 'Lightning Address');
  const save = el('button', 'primary small', 'Save');
  save.type = 'submit';
  const cancel = el('button', 'small', 'Cancel');
  cancel.type = 'button';
  const buttons = el('div', 'edit-actions');
  buttons.append(cancel, save);
  form.append(name, address, buttons);
  const face = row.querySelector('.avatar');
  row.replaceChildren(...(face ? [face] : []), form);
  row.classList.add('editing');
  name.focus();
  name.select();
  cancel.addEventListener('click', () => { void render(); });
  form.addEventListener('keydown', event => { if (event.key === 'Escape') void render(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await updateMappings(s => editMapping(s, scope, contactKey, name.value, address.value).store);
      setStatus(`Saved ${name.value.trim()}.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), true);
    }
  });
}

/**
 * One saved contact: who, their Nostr profile if linked, their Lightning
 * Address. Contacts not linked to a profile yet offer to connect one.
 */
function contactRow(mapping: Mapping, onDelete: () => void, onEdit?: (row: HTMLElement) => void, onConnect?: () => void): HTMLElement {
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
  } else if (onConnect) {
    const connect = el('button', 'small secondary connect', 'Connect Nostr');
    connect.type = 'button';
    connect.title = `Find ${mapping.displayName}'s Nostr profile`;
    connect.setAttribute('aria-label', `Connect ${mapping.displayName} to a Nostr profile`);
    connect.addEventListener('click', onConnect);
    who.append(connect);
  }
  const remove = el('button', 'icon', '');
  remove.type = 'button';
  remove.title = `Delete ${mapping.displayName}`;
  remove.setAttribute('aria-label', `Delete ${mapping.displayName}`);
  remove.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
  remove.addEventListener('click', onDelete);
  const tools = el('div', 'tools');
  if (onEdit) {
    const edit = el('button', 'icon edit', '');
    edit.type = 'button';
    edit.title = `Edit ${mapping.displayName}`;
    edit.setAttribute('aria-label', `Edit ${mapping.displayName}`);
    edit.innerHTML = PENCIL;
    edit.addEventListener('click', () => onEdit(row));
    tools.append(edit);
  }
  tools.append(remove);
  row.append(avatar(mapping.nostr?.name ?? mapping.displayName, mapping.nostr?.picture), who, tools);
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
    }, r => editRow(r, mapping, scope, contactKey), () => startConnect(scope, contactKey, mapping));
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
  row.append(avatar(profile.displayName ?? profile.name ?? '?', profile.picture), who);

  if (connecting) {
    const target = connecting;
    const form = el('form', 'save');
    const connect = el('button', 'primary', 'Connect');
    connect.type = 'submit';
    connect.setAttribute('aria-label', `Connect ${target.mapping.displayName} to ${profile.displayName ?? profile.name ?? shortNpub(profile.npub)}`);
    form.append(connect);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        await updateMappings(s => connectMapping(s, target.scope, target.contactKey, {
          pubkey: profile.pubkey,
          lud16: profile.lud16,
          nostr: { name: profile.displayName ?? profile.name, nip05: profile.nip05Verified ? profile.nip05 : null, picture: profile.picture },
        }));
        const changed = profile.lud16 && profile.lud16 !== target.mapping.address ? ` Lightning Address: ${profile.lud16}.` : '';
        setStatus(`Connected ${target.mapping.displayName} to ${profile.displayName ?? profile.name ?? shortNpub(profile.npub)}.${changed}`);
        stopConnect();
        clearQuery();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err), true);
      }
    });
    row.append(form);
  } else if (profile.lud16) {
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
  // Connecting a saved contact, a profile without a Lightning Address is fine:
  // the contact keeps the one it has.
  const payable = connecting ? found : found.filter(p => p.lud16);
  const unpayable = connecting ? [] : found.filter(p => !p.lud16);
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
  $('search-hint').hidden = true;
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

/** The saved contact being connected to a Nostr profile, while its search is open. */
let connecting: { scope: MappingScope; contactKey: string; mapping: Mapping } | null = null;

/** Search Nostr for a saved contact's name; the results offer to connect it. */
function startConnect(scope: MappingScope, contactKey: string, mapping: Mapping) {
  connecting = { scope, contactKey, mapping };
  selectTab('tab-people');
  $('connecting-text').textContent = `Connecting ${mapping.displayName}: pick their Nostr profile below, or search another name.`;
  $('connecting').hidden = false;
  queryInput.value = mapping.displayName;
  $<HTMLButtonElement>('search-clear').hidden = false;
  $('panel-people').scrollTop = 0;
  window.scrollTo({ top: 0 });
  queryInput.focus();
  void runSearch(mapping.displayName);
}

function stopConnect() {
  connecting = null;
  $('connecting').hidden = true;
}

/** Empty the search box and go back to the idle state. */
function clearQuery() {
  clearTimeout(typing);
  queryInput.value = '';
  $<HTMLButtonElement>('search-clear').hidden = true;
  resetSearch();
}

$('connecting-cancel').addEventListener('click', () => {
  stopConnect();
  clearQuery();
  queryInput.focus();
});
/** Back to the idle state: no results, the hint shown again. */
function resetSearch() {
  searchRun++;
  $('search-results').replaceChildren();
  $('search-status').textContent = '';
  $('search-hint').hidden = false;
}

queryInput.addEventListener('input', () => {
  clearTimeout(typing);
  const query = queryInput.value.trim();
  if (!query) { resetSearch(); return; }
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
  resetSearch();
  queryInput.focus();
});

// ── Theme ──

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
let themeChoice: ThemeChoice = parseThemeChoice(undefined);

const paletteInputs = PALETTES.map(palette => {
  const swatch = el('label', 'swatch');
  const input = el('input');
  input.type = 'radio';
  input.name = 'palette';
  input.value = palette.id;
  input.addEventListener('change', () => { if (input.checked) void saveTheme({ ...themeChoice, palette: palette.id }); });
  // A small picture of the palette: its background, a line of text, a button.
  const preview = el('span', 'preview');
  preview.setAttribute('aria-hidden', 'true');
  preview.append(el('i'), el('b'));
  swatch.append(input, preview, el('span', 'name', palette.label));
  $('palettes').append(swatch);
  return { palette: palette.id as PaletteId, preview, input };
});
const appearanceInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="appearance"]')];
for (const input of appearanceInputs) {
  input.addEventListener('change', () => { if (input.checked) void saveTheme({ ...themeChoice, appearance: input.value as Appearance }); });
}

/** Show the choice: the selected palette, each swatch in its colours now, the appearance. */
function showTheme(choice: ThemeChoice) {
  themeChoice = choice;
  for (const { palette, preview, input } of paletteInputs) {
    input.checked = palette === choice.palette;
    // Only the picture takes the palette's colours; the label stays in the page's.
    preview.dataset.theme = resolveTheme({ palette, appearance: choice.appearance }, prefersDark.matches);
  }
  const fixed = !hasAppearance(choice.palette);
  for (const input of appearanceInputs) {
    input.checked = input.value === choice.appearance;
    input.disabled = fixed;
  }
  $('appearance-modes').setAttribute('aria-disabled', String(fixed));
  $('appearance-hint').textContent = fixed
    ? 'La Crypta has one palette and always looks like this.'
    : choice.appearance === 'auto' ? 'Auto follows WhatsApp\'s light or dark theme inside WhatsApp, and your system\'s here.' : '';
}

async function saveTheme(choice: ThemeChoice) {
  showTheme(choice);
  await chrome.storage.local.set({ [THEME_KEY]: choice });
}

async function renderTheme() {
  showTheme(parseThemeChoice((await chrome.storage.local.get(THEME_KEY))[THEME_KEY]));
}
prefersDark.addEventListener('change', () => showTheme(themeChoice));

// ── Settings ──

$<HTMLInputElement>('picture-proxy').addEventListener('change', async event => {
  const on = (event.currentTarget as HTMLInputElement).checked;
  await chrome.storage.local.set({ [PICTURE_PROXY_KEY]: on });
  setStatus(on ? 'Pictures blocked by their host load through wsrv.nl.' : 'Pictures load only from their own host.');
});

$<HTMLInputElement>('zap-button').addEventListener('change', async event => {
  const on = (event.currentTarget as HTMLInputElement).checked;
  await chrome.storage.local.set({ [ZAP_BUTTON_KEY]: on });
  setStatus(on ? 'The ⚡ button shows beside messages.' : 'The ⚡ button is off.');
});

async function renderSettings() {
  const stored = await chrome.storage.local.get([MY_PUBKEY_KEY, REACTION_AMOUNT_KEY, ZAP_BUTTON_KEY, PICTURE_PROXY_KEY]);
  $<HTMLInputElement>('zap-button').checked = stored[ZAP_BUTTON_KEY] !== false;
  $<HTMLInputElement>('picture-proxy').checked = stored[PICTURE_PROXY_KEY] !== false;
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
  a.download = 'whatzaps-contacts.json';
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
  if (TRACE_REACTIONS_UNTIL_KEY in changes) void renderTrace();
  if (THEME_KEY in changes) showTheme(parseThemeChoice(changes[THEME_KEY].newValue));
});

void render();
void renderTheme();
void renderSettings();
void renderDiagnosticsCount();
void renderTrace();
void renderReactionStatus();
