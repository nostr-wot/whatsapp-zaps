/** Options page: view, add, delete, import and export saved mappings. */
import { MAPPINGS_STORAGE_KEY } from '../constants.ts';
import { normalizeName, removeMapping, saveMapping, mergeStores, sanitizeStore, type MappingScope, type MappingStore } from '../domain/mappings.ts';
import { loadMappings, storeMappings, updateMappings } from '../services/mappingStore.ts';
import { shortNpub, type ProfileResult } from '../domain/nostr.ts';
import type { BackgroundResponse } from '../domain/messages.ts';
import { clearDiagnostics, formatDiagnostics, loadDiagnostics } from '../services/diagnostics.ts';
import { DIAGNOSTICS_KEY } from '../constants.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function setStatus(message: string, isError = false) {
  const status = $('status');
  status.textContent = message;
  status.className = isError ? 'error' : '';
}

function chatLabel(chatKey: string): string {
  if (chatKey.startsWith('title:')) return chatKey.slice('title:'.length);
  if (chatKey.startsWith('jid:')) return chatKey.endsWith('@g.us') ? `Group ${chatKey.slice(4)}` : `Chat ${chatKey.slice(4)}`;
  return chatKey;
}

function table(store: MappingStore, scope: MappingScope): HTMLElement {
  const bucket = scope.kind === 'global' ? store.global : store.groups[scope.chatKey] ?? {};
  const rows = Object.entries(bucket).sort(([, a], [, b]) => a.displayName.localeCompare(b.displayName));
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'None saved yet.';
    return empty;
  }
  const tableEl = document.createElement('table');
  const head = tableEl.createTHead().insertRow();
  for (const label of ['Contact', 'Lightning Address', '']) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  const body = tableEl.createTBody();
  for (const [contactKey, mapping] of rows) {
    const row = body.insertRow();
    row.insertCell().textContent = mapping.displayName;
    const addressCell = row.insertCell();
    addressCell.append(el('span', 'ln', mapping.address));
    if (mapping.nostr?.name || mapping.nostr?.nip05) {
      const nostr = [mapping.nostr.name, mapping.nostr.nip05 && `✓ ${mapping.nostr.nip05}`].filter(Boolean).join(' ');
      addressCell.append(el('br'), el('span', 'muted', `Nostr: ${nostr}`));
    }
    if (mapping.pubkey) addressCell.title = `From Nostr profile ${mapping.pubkey}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete ${mapping.displayName}`);
    remove.addEventListener('click', async () => {
      await updateMappings(s => removeMapping(s, scope, contactKey));
      setStatus(`Deleted ${mapping.displayName}.`);
    });
    row.insertCell().append(remove);
  }
  return tableEl;
}

async function render() {
  const store = await loadMappings();
  $('global').replaceChildren(table(store, { kind: 'global' }));
  const groups = $('groups');
  const keys = Object.keys(store.groups).sort();
  if (keys.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'None saved yet.';
    groups.replaceChildren(empty);
    return;
  }
  groups.replaceChildren(...keys.flatMap(chatKey => {
    const title = document.createElement('h3');
    title.textContent = chatLabel(chatKey);
    return [title, table(store, { kind: 'chat', chatKey })];
  }));
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** One search result, with a form to save its address under a WhatsApp name. */
function profileRow(profile: ProfileResult): HTMLElement {
  const row = el('div', 'profile');
  const who = el('div', 'who');
  const title = el('div');
  title.append(el('strong', '', profile.displayName ?? profile.name ?? 'Unnamed profile'));
  if (profile.name) title.append(el('span', 'muted', ` @${profile.name}`));
  who.append(title);
  if (profile.nip05) {
    who.append(profile.nip05Verified
      ? el('span', 'chip verified', `✓ ${profile.nip05}`)
      : el('span', 'chip unverified', `${profile.nip05} (not verified)`));
  }
  const npub = el('span', 'muted mono', shortNpub(profile.npub));
  npub.title = profile.npub;
  who.append(npub,
    profile.lud16 ? el('span', 'ln', `⚡ ${profile.lud16}`) : el('span', 'muted', 'No Lightning Address'));
  row.append(who);

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
        await updateMappings(s => saveMapping(s, { kind: 'global' }, `name:${normalizeName(label)}`, label, profile.lud16!, Date.now(), profile.pubkey));
        setStatus(`Saved ${label} → ${profile.lud16}.`);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err), true);
      }
    });
    row.append(form);
  }
  return row;
}

let searchRun = 0;
$('search').addEventListener('submit', async event => {
  event.preventDefault();
  const query = String(new FormData(event.currentTarget as HTMLFormElement).get('query') ?? '').trim();
  if (!query) return;
  const run = ++searchRun;
  const status = $('search-status');
  status.textContent = 'Searching Nostr…';
  status.className = 'muted';
  $('search-results').replaceChildren();
  const response = await chrome.runtime.sendMessage({ type: 'search', query }) as BackgroundResponse<ProfileResult[]> | undefined;
  if (run !== searchRun) return;
  if (!response?.ok) {
    status.textContent = response?.error ?? 'Search failed.';
    status.className = 'error';
    return;
  }
  status.textContent = response.value.length
    ? 'Check the npub or a verified NIP-05 before saving: anyone can use any name.'
    : 'No Nostr profiles found.';
  $('search-results').replaceChildren(...response.value.map(profileRow));
});

// In the toolbar popup, backup (which needs file dialogs that close popups) lives on the full page.
document.getElementById('open-full')?.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); window.close(); });

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

$('clear-diagnostics').addEventListener('click', async () => {
  await clearDiagnostics();
  setStatus('Diagnostics cleared.');
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && MAPPINGS_STORAGE_KEY in changes) void render();
  if (area === 'local' && DIAGNOSTICS_KEY in changes) void renderDiagnosticsCount();
});
void renderDiagnosticsCount();

void render();
