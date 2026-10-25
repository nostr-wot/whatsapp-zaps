/** Options page: view, add, delete, import and export saved mappings. */
import { MAPPINGS_STORAGE_KEY } from '../constants.ts';
import { normalizeName, removeMapping, saveMapping, mergeStores, sanitizeStore, type MappingScope, type MappingStore } from '../domain/mappings.ts';
import { loadMappings, storeMappings, updateMappings } from '../services/mappingStore.ts';

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
  const el = document.createElement('table');
  const head = el.createTHead().insertRow();
  for (const label of ['Contact', 'Lightning Address', '']) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  const body = el.createTBody();
  for (const [contactKey, mapping] of rows) {
    const row = body.insertRow();
    row.insertCell().textContent = mapping.displayName;
    row.insertCell().textContent = mapping.address;
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
  return el;
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && MAPPINGS_STORAGE_KEY in changes) void render();
});

void render();
