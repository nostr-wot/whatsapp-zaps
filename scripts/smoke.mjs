// Real-browser smoke test of the built extension (dist/).
//
// A local HTTPS server plays both web.whatsapp.com (a saved composer fixture)
// and a public-looking Lightning Address host; --host-resolver-rules points
// both names at it, so the background's real fetch and URL-safety checks run
// unchanged. window.webln is a stub standing in for Nostr WoT.
//
// The dialog's shadow root is closed and its buttons ignore synthetic clicks,
// so the test reads it through CDP and drives it only with real key presses.
//
// Nostr relays are a WebSocket server on the same port, with every default
// relay hostname mapped to it, so the worker's real relay code runs too.
//
//   npm run build && npm run smoke -- [path/to/chrome]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bech32 } from '@scure/base';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import { PROFILE_RELAYS, SEARCH_RELAYS } from '../src/constants.ts';

const dist = resolve('dist');
const dir = mkdtempSync(join(tmpdir(), 'whatsapp-zaps-smoke-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=smoke',
  '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });

const METADATA = JSON.stringify([['text/plain', 'Sats for Ana']]);
const invoiceFor = sats => bech32.encode(`lnbc${sats * 10}n`,
  [...Array(7).fill(0), 23, 1, 20, ...bech32.toWords(createHash('sha256').update(METADATA).digest()), ...Array(104).fill(0)], 2000);

// Nostr: Ana's real profile, and an impostor using her name and her NIP-05.
const anaKey = generateSecretKey();
const anaPubkey = getPublicKey(anaKey);
const profile = (sk, content) => finalizeEvent({ kind: 0, created_at: 1_700_000_000, tags: [], content: JSON.stringify(content) }, sk);
const profiles = [
  profile(generateSecretKey(), { name: 'ana', display_name: 'Ana Paula', lud16: 'ana@evil.example', nip05: 'ana@nostr.example' }),
  profile(anaKey, { name: 'ana', display_name: 'Ana Paula', lud16: 'ana@wallet.example', nip05: 'ana@nostr.example' }),
];
const relayRequests = [];

const requests = [];
const fixture = readFileSync('tests/fixtures/whatsapp-chat.html', 'utf8');
const server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  requests.push(`${url.host}${url.pathname}${url.search}`);
  const json = body => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)); };
  if (url.host === 'web.whatsapp.com') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(fixture); }
  if (url.host === 'nostr.example' && url.pathname === '/.well-known/nostr.json') return json({ names: { ana: anaPubkey } });
  if (url.pathname === '/.well-known/lnurlp/ana') {
    return json({ tag: 'payRequest', callback: 'https://wallet.example/cb/ana', minSendable: 1000, maxSendable: 1e9, metadata: METADATA, commentAllowed: 50 });
  }
  if (url.pathname === '/cb/ana') return json({ pr: invoiceFor(Number(url.searchParams.get('amount')) / 1000), routes: [] });
  res.writeHead(404); res.end();
});
// Every relay hostname is mapped to this server; it answers REQs from `profiles`.
new WebSocketServer({ server }).on('connection', (socket, req) => {
  socket.on('message', raw => {
    const [type, id, filter] = JSON.parse(String(raw));
    if (type !== 'REQ') return;
    relayRequests.push({ host: req.headers.host, filter });
    for (const event of profiles) {
      const byAuthor = !filter.authors || filter.authors.includes(event.pubkey);
      const bySearch = !filter.search || event.content.toLowerCase().includes(filter.search.toLowerCase());
      if (byAuthor && bySearch) socket.send(JSON.stringify(['EVENT', id, event]));
    }
    socket.send(JSON.stringify(['EOSE', id]));
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const relayHosts = [...PROFILE_RELAYS, ...SEARCH_RELAYS].map(r => new URL(r).host);
const mapped = ['web.whatsapp.com', 'wallet.example', 'nostr.example', ...relayHosts].map(h => `MAP ${h} 127.0.0.1:${port}`).join(', ');

let context;
try {
  context = await chromium.launchPersistentContext(join(dir, 'profile'), {
    headless: true,
    executablePath: process.argv[2],
    ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--ignore-certificate-errors',
      `--host-resolver-rules=${mapped}`,
    ],
  });
  context.setDefaultTimeout(10_000);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');

  const page = await context.newPage();
  // Stand-in for Nostr WoT's window.webln.
  await page.addInitScript(() => {
    const calls = (window.__weblnCalls = []);
    window.webln = {
      enabled: false,
      async enable() { calls.push('enable'); this.enabled = true; },
      async sendPayment(pr) { calls.push(`pay:${pr}`); return { preimage: 'ab'.repeat(32) }; },
    };
  });
  page.on('pageerror', err => { throw err; });
  await page.goto('https://web.whatsapp.com/');

  const cdp = await context.newCDPSession(page);
  async function dialogText() {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const host = (function find(node) {
      if (node.attributes?.includes('data-whatsapp-zaps')) return node;
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const f = find(child); if (f) return f; }
      return null;
    })(root);
    if (!host) return null;
    const out = [];
    (function walk(node) {
      if (node.nodeType === 3 && node.parentId && !/^\s*$/.test(node.nodeValue)) out.push(node.nodeValue);
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) if (child.nodeName !== 'STYLE') walk(child);
    })(host);
    return out.join(' ');
  }
  /** Click a dialog button whose text matches, with a real (trusted) mouse click. */
  async function clickInDialog(pattern) {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const textOf = node => node.nodeType === 3 ? node.nodeValue : [...(node.children ?? [])].map(textOf).join('');
    const button = (function find(node) {
      if (node.nodeName === 'BUTTON' && pattern.test(textOf(node))) return node;
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const f = find(child); if (f) return f; }
      return null;
    })(root);
    if (!button) throw new Error(`No dialog button matches ${pattern}`);
    const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: button.backendNodeId });
    const [x1, y1, , , x2, y2] = model.content;
    await page.mouse.click((x1 + x2) / 2, (y1 + y2) / 2);
  }

  async function waitForDialog(pattern) {
    const deadline = Date.now() + 10_000;
    let last;
    while (Date.now() < deadline) {
      last = await dialogText();
      if (last !== null && pattern.test(last)) return last;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Dialog never matched ${pattern}; last: ${last}`);
  }

  // 1. Enter on a /zap command opens the dialog instead of sending.
  await page.focus('footer [contenteditable="true"]');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  console.log('ask:', await waitForDialog(/Lightning Address\?/));

  // 2. Unknown recipient: search Nostr by name; Enter on a non-address searches.
  await page.keyboard.type('Ana');
  await page.keyboard.press('Enter');
  const found = await waitForDialog(/ana@evil\.example/);
  console.log('search:', found);
  assert.match(found, /✓ ana@nostr\.example .*ana@wallet\.example .*ana@nostr\.example \(not verified\)/s, 'verified profile first, impostor marked');
  assert.ok(relayRequests.some(r => r.filter.search === 'Ana' && SEARCH_RELAYS.some(u => new URL(u).host === r.host)));
  await clickInDialog(/✓ ana@nostr\.example/);
  await waitForDialog(/Selected Ana Paula/);
  await page.keyboard.press('Enter');
  const confirm = await waitForDialog(/Confirm zap/);
  console.log('confirm:', confirm);
  assert.match(confirm, /Ana Paula/);
  assert.match(confirm, /1,000 sats/);
  assert.match(confirm, /gracias/);

  // 3. Pay (focused) with a real key press.
  await page.keyboard.press('Enter');
  const result = await waitForDialog(/Zap sent/);
  console.log('result:', result);
  const calls = await page.evaluate(() => window.__weblnCalls);
  assert.deepEqual(calls, ['enable', `pay:${invoiceFor(1000)}`]);
  assert.ok(requests.includes('wallet.example/cb/ana?amount=1000000&comment=gracias'), requests.join('\n'));

  // 4. Add the chat message to the composer (not sent).
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 300));
  assert.equal(await dialogText(), null, 'dialog should close');
  const composerText = await page.$eval('footer [contenteditable="true"]', el => el.textContent);
  assert.equal(composerText, '⚡ Zapped @Ana Paula 1,000 sats');

  // 5. The mapping was saved for this chat, keyed by the mention's contact id.
  const stored = await worker.evaluate(() => chrome.storage.local.get('zapMappings'));
  const saved = stored.zapMappings.groups['jid:120363000000000000@g.us']['id:5491100000000@c.us'];
  assert.equal(saved.address, 'ana@wallet.example');
  assert.equal(saved.pubkey, anaPubkey);

  // 6. A page script cannot use the background worker.
  const blocked = await page.evaluate(() => typeof chrome === 'undefined' || !chrome.runtime?.sendMessage);
  assert.equal(blocked, true);

  // 7. Options page: search by NIP-05 and save under a WhatsApp name.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
  await options.fill('#search input[name="query"]', 'ana@nostr.example');
  await options.click('#search button[type="submit"]');
  await options.waitForSelector('.profile');
  const rows = await options.$$eval('.profile', els => els.map(e => e.textContent));
  assert.equal(rows.length, 1, rows.join('\n'));
  assert.match(rows[0], /✓ ana@nostr\.example.*ana@wallet\.example/s);
  await options.fill('.profile .save input', 'Ana from work');
  await options.click('.profile .save button');
  await options.waitForFunction(() => document.getElementById('status').textContent.startsWith('Saved'));
  const after = await worker.evaluate(() => chrome.storage.local.get('zapMappings'));
  assert.deepEqual(
    { ...after.zapMappings.global['name:ana from work'], updatedAt: 0 },
    { address: 'ana@wallet.example', displayName: 'Ana from work', updatedAt: 0, pubkey: anaPubkey },
  );
  assert.match(await options.textContent('#global'), /Ana from work/);

  console.log('\nSmoke test passed.');
} finally {
  await context?.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
