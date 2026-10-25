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
import { build } from 'esbuild';
import { PROFILE_RELAYS, SEARCH_RELAYS } from '../src/constants.ts';

const dist = resolve('dist');

/** Read dialogs as a screen reader would: decorative (aria-hidden) parts are skipped. */
const ariaHidden = n => { const a = n.attributes ?? []; const i = a.indexOf('aria-hidden'); return i >= 0 && a[i + 1] === 'true'; };
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
  profile(anaKey, { name: 'ana', display_name: 'Ana Paula', lud16: 'ana@wallet.example', nip05: 'ana@nostr.example', picture: 'https://wallet.example/ana.png' }),
];
const relayRequests = [];

const requests = [];
const fixture = readFileSync('tests/fixtures/whatsapp-chat.html', 'utf8');
// `?lexical=1` serves the chat with a real Lexical editor as its message box.
const lexicalBundle = (await build({ entryPoints: ['tests/fixtures/lexical-composer.ts'], bundle: true, format: 'iife', write: false })).outputFiles[0].text;
const lexicalFixture = fixture
  .replace('<body>', '<body><div id="sent" aria-label="Sent messages"></div>')
  .replace('</body>', '<script src="/lexical-composer.js"></script></body>');
const server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  requests.push(`${url.host}${url.pathname}${url.search}`);
  const json = body => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)); };
  if (url.host === 'web.whatsapp.com' && url.pathname === '/lexical-composer.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(lexicalBundle); }
  if (url.host === 'web.whatsapp.com') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(url.searchParams.has('lexical') ? lexicalFixture : fixture); }
  if (url.host === 'nostr.example' && url.pathname === '/.well-known/nostr.json') return json({ names: { ana: anaPubkey } });
  if (url.pathname === '/ana.png') {
    // A 1×1 PNG.
    // Like Nostr media hosts (Blossom requires it): readable cross-origin.
    res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*' });
    return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  }
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
  // Imitate WhatsApp's ⋮ dropdown: rendered shortly after the click, closed by Escape.
  const menuHtml = readFileSync('tests/fixtures/whatsapp-menu.html', 'utf8');
  await page.addInitScript(html => {
    document.addEventListener('click', event => {
      if (!event.target.closest?.('#main header [aria-label="Menu"]')) return;
      setTimeout(() => {
        const host = document.createElement('div');
        host.id = 'fake-dropdown';
        host.innerHTML = html;
        document.getElementById('app').append(host);
      }, 50);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') document.getElementById('fake-dropdown')?.remove();
    });
  }, menuHtml);
  page.on('pageerror', err => { throw err; });
  await page.goto('https://web.whatsapp.com/');

  // SMOKE_SHOTS=<dir> saves a screenshot at each dialog step, for design review.
  const shotDir = process.env.SMOKE_SHOTS;
  const shot = async name => { if (shotDir) await page.screenshot({ path: join(shotDir, `${name}.png`) }); };
  await page.setViewportSize({ width: 1100, height: 760 });

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
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) if (child.nodeName !== 'STYLE' && !ariaHidden(child)) walk(child);
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
  await shot('1-ask');

  // 2. Unknown recipient: search Nostr by name; Enter on a non-address searches.
  await page.keyboard.type('Ana');
  await page.keyboard.press('Enter');
  const found = await waitForDialog(/ana@evil\.example/);
  console.log('search:', found);
  // The verified profile's picture is shown, fetched by the background as a data: URL.
  let pictureShown = false;
  for (let i = 0; i < 30 && !pictureShown; i++) {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    pictureShown = (function find(n) {
      if (n.nodeName === 'IMG' && /data:image\/png;base64,/.test((n.attributes ?? []).join(' '))) return true;
      return [...(n.children ?? []), ...(n.shadowRoots ?? [])].some(find);
    })(root);
    if (!pictureShown) await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(pictureShown, 'profile picture shown in the dialog');
  await shot('2-search');
  assert.match(found, /✓ ana@nostr\.example .*ana@wallet\.example .*ana@nostr\.example \(not verified\)/s, 'verified profile first, impostor marked');
  assert.ok(relayRequests.some(r => r.filter.search === 'Ana' && SEARCH_RELAYS.some(u => new URL(u).host === r.host)));
  await clickInDialog(/✓ ana@nostr\.example/);
  await waitForDialog(/Selected Ana Paula/);
  await page.keyboard.press('Enter');
  const confirm = await waitForDialog(/Confirm zap/);
  console.log('confirm:', confirm);
  await shot('3-confirm');
  assert.match(confirm, /Ana Paula/);
  assert.match(confirm, /1,000 sats/);
  assert.match(confirm, /gracias/);

  // 3. Pay (focused) with a real key press.
  await page.keyboard.press('Enter');
  const result = await waitForDialog(/Zap sent/);
  console.log('result:', result);
  await shot('4-result');
  const calls = await page.evaluate(() => window.__weblnCalls);
  assert.deepEqual(calls, ['enable', `pay:${invoiceFor(1000)}`]);
  assert.ok(requests.includes('wallet.example/cb/ana?amount=1000000&comment=gracias'), requests.join('\n'));

  // 4. This plain page has no working send, so the message is offered for copying,
  //    and the /zap command is still cleared from the box.
  assert.match(result, /Payment confirmed/);
  assert.match(result, /could not be posted/);
  assert.doesNotMatch(result, /still in the message box/);
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 300));
  assert.equal(await dialogText(), null, 'dialog should close');
  assert.equal(await page.$eval('footer [contenteditable="true"]', el => el.textContent.trim()), '');

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
  await options.fill('#search-query', 'ana@nostr.example');
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
    { address: 'ana@wallet.example', displayName: 'Ana from work', updatedAt: 0, pubkey: anaPubkey, nostr: { name: 'Ana Paula', nip05: 'ana@nostr.example', picture: 'https://wallet.example/ana.png' } },
  );
  assert.match(await options.textContent('#global'), /Ana from work/);

  // 8. ⋮ menu → "Nostr profile" popup in a one-to-one chat: search, link, unlink.
  await page.bringToFront();
  await page.evaluate(() => {
    for (const row of document.querySelectorAll('#main [data-id]')) row.setAttribute('data-id', 'false_5491100000000@c.us_3EB0AA');
  });
  await page.click('#main header [aria-label="Menu"]');
  await page.waitForSelector('[data-whatsapp-zaps-item]');
  assert.match(await page.textContent('#fake-dropdown'), /Contact info.*Close chat.*⚡ Nostr profile/s);
  await page.click('[data-whatsapp-zaps-item]');
  const popup = await waitForDialog(/Nostr profile/);
  console.log('popup:', popup);
  assert.match(popup, /Not linked/);
  assert.equal(await page.$('#fake-dropdown'), null, 'WhatsApp menu closed');
  assert.ok(!relayRequests.some(r => r.filter.search === 'Friends & Family'), 'no search before the person asks');
  // Replace the prefilled name and search.
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Ana');
  await clickInDialog(/^Search Nostr$/);
  await waitForDialog(/ana@evil\.example/);
  await clickInDialog(/✓ ana@nostr\.example/);
  await clickInDialog(/^Link$/);
  const linkedView = await waitForDialog(/Linked Friends & Family → ana@wallet\.example/);
  console.log('linked:', linkedView);
  assert.match(linkedView, /Ana Paula\s+✓ ana@nostr\.example/);
  const linkedStore = await worker.evaluate(() => chrome.storage.local.get('zapMappings'));
  assert.deepEqual(
    { ...linkedStore.zapMappings.global['id:5491100000000@c.us'], updatedAt: 0 },
    { address: 'ana@wallet.example', displayName: 'Friends & Family', updatedAt: 0, pubkey: anaPubkey, nostr: { name: 'Ana Paula', nip05: 'ana@nostr.example', picture: 'https://wallet.example/ana.png' } },
  );
  await shot('5-linked');
  // WhatsApp's own dark theme is a class on <body>; the dialogs follow it.
  await page.evaluate(() => document.body.classList.add('dark'));
  await shot('6-linked-dark');
  await page.evaluate(() => document.body.classList.remove('dark'));

  // 9. Private chat: `/zap 21` with no mention pays the linked contact; the command shows in green.
  await clickInDialog(/^Close$/);
  await page.waitForFunction(() => !document.querySelector('[data-whatsapp-zaps]'));
  await page.evaluate(() => {
    const box = document.querySelector('footer [contenteditable="true"]');
    box.innerHTML = '<p><span>/zap 21 thanks</span></p>';
    box.focus();
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForSelector('[data-whatsapp-zaps-command]');
  const color = await page.$eval('footer [contenteditable="true"] span', el => getComputedStyle(el).color);
  assert.equal(color, 'rgb(0, 128, 105)', 'command shows in WhatsApp green');
  await shot('7-green-command');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  const privateConfirm = await waitForDialog(/Confirm zap/);
  console.log('private:', privateConfirm);
  assert.match(privateConfirm, /21 sats .*to Friends & Family.*ana@wallet\.example.*thanks/s);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-whatsapp-zaps]'));

  // Back to the popup to unlink.
  await page.click('#main header [aria-label="Menu"]');
  await page.waitForSelector('[data-whatsapp-zaps-item]');
  await page.click('[data-whatsapp-zaps-item]');
  await waitForDialog(/Unlink/);
  await clickInDialog(/^Unlink$/);
  await waitForDialog(/Unlinked\./);
  const unlinked = await worker.evaluate(() => chrome.storage.local.get('zapMappings'));
  assert.equal(unlinked.zapMappings.global['id:5491100000000@c.us'], undefined);
  await clickInDialog(/^Close$/);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(await dialogText(), null);

  // 11. A real Lexical message box (as on WhatsApp): `/zap 21 thanks` in a private chat
  //     is paid, the ⚡ message is posted only then, and typing the command again warns.
  await worker.evaluate(async pubkey => {
    const { zapMappings } = await chrome.storage.local.get('zapMappings');
    zapMappings.global['id:5491100000000@c.us'] = { address: 'ana@wallet.example', displayName: 'Ana Paula', updatedAt: 1, pubkey };
    await chrome.storage.local.set({ zapMappings });
  }, anaPubkey);
  const lex = await context.newPage();
  await lex.addInitScript(() => {
    const calls = (window.__weblnCalls = []);
    window.webln = {
      enabled: false,
      async enable() { calls.push('enable'); this.enabled = true; },
      async sendPayment(pr) { calls.push(`pay:${pr}`); await new Promise(r => setTimeout(r, 200)); return { preimage: 'cd'.repeat(32) }; },
    };
  });
  await lex.goto('https://web.whatsapp.com/?lexical=1&text=' + encodeURIComponent('/zap 21 thanks'));
  await lex.waitForFunction(() => window.__lexicalReady);
  await lex.evaluate(() => {
    for (const row of document.querySelectorAll('#main [data-id]')) row.setAttribute('data-id', 'false_5491100000000@c.us_3EB0CC');
  });
  const lexCdp = await context.newCDPSession(lex);
  const lexDialog = async pattern => {
    const deadline = Date.now() + 10_000;
    let last = null;
    while (Date.now() < deadline) {
      const { root } = await lexCdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const host = (function find(n) { if (n.attributes?.includes('data-whatsapp-zaps')) return n; for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) { const f = find(c); if (f) return f; } return null; })(root);
      const out = [];
      if (host) (function walk(n) { if (n.nodeType === 3 && !/^\s*$/.test(n.nodeValue)) out.push(n.nodeValue); for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) if (c.nodeName !== 'STYLE' && !ariaHidden(c)) walk(c); })(host);
      last = host ? out.join(' ') : null;
      if (pattern === null ? last === null : last !== null && pattern.test(last)) return last;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Lexical page dialog never matched ${pattern}; last: ${last}`);
  };
  const lexBox = 'footer [contenteditable="true"]';
  const lexText = () => lex.$eval(lexBox, el => el.textContent);
  const sent = () => lex.$$eval('.sent-message', els => els.map(e => e.textContent));
  await lex.click(lexBox);
  await lex.keyboard.press('End');
  await lex.keyboard.press('Enter');
  const lexConfirm = await lexDialog(/Confirm zap/);
  assert.match(lexConfirm, /21 sats .*Post in the chat once the payment is confirmed.*⚡ Zapped you 21 sats — thanks/s);
  assert.deepEqual(await sent(), [], 'the command itself was not sent');
  await lex.keyboard.press('Enter'); // Pay
  // Nothing is posted while the wallet is still paying.
  await new Promise(r => setTimeout(r, 80));
  assert.deepEqual(await sent(), [], 'no message before the payment is confirmed');
  const lexResult = await lexDialog(/Zap sent/);
  console.log('lexical result:', lexResult);
  assert.match(lexResult, /Payment confirmed.*Posted in the chat/s);
  assert.deepEqual(await sent(), ['⚡ Zapped you 21 sats — thanks']);
  assert.equal((await lexText()).trim(), '', 'box empty after posting');
  assert.equal((await lex.evaluate(() => window.__weblnCalls)).length, 2);
  if (shotDir) await lex.screenshot({ path: join(shotDir, '9-lexical-posted.png') });
  await lex.keyboard.press('Enter'); // Close
  await lexDialog(null);
  // Typing the same command again: warned, not paid.
  await lex.click(lexBox);
  await lex.keyboard.type('/zap 21 thanks');
  await lex.keyboard.press('Enter');
  const repeat = await lexDialog(/Already paid/);
  console.log('repeat:', repeat);
  if (shotDir) await lex.screenshot({ path: join(shotDir, '10-repeat.png') });
  await lex.keyboard.press('Enter'); // "Don't pay again" is focused
  await lexDialog(null);
  assert.equal((await lexText()).trim(), '', 'leftover command removed');
  assert.equal((await lex.evaluate(() => window.__weblnCalls)).length, 2, 'no second payment');
  assert.deepEqual(await sent(), ['⚡ Zapped you 21 sats — thanks']);

  // 12. Groups: the posted message carries a real WhatsApp mention.
  await worker.evaluate(async () => {
    const { zapMappings } = await chrome.storage.local.get('zapMappings');
    zapMappings.global['id:5491177@c.us'] = { address: 'ana@wallet.example', displayName: 'Jaqui', updatedAt: 1 };
    zapMappings.global['name:bob'] = { address: 'ana@wallet.example', displayName: 'Bob', updatedAt: 1 };
    zapMappings.global['name:carl'] = { address: 'ana@wallet.example', displayName: 'Carl', updatedAt: 1 };
    zapMappings.global['name:be'] = { address: 'ana@wallet.example', displayName: 'Be', updatedAt: 1 };
    await chrome.storage.local.set({ zapMappings });
  });
  const members = 'Jaqui:5491177@c.us,Bob:5491188@c.us,Bea:5491199@c.us';
  // Opens a reply the way WhatsApp may: from a button outside the message, so the
  // message itself is never clicked. The reply box quotes the message's text.
  async function openReply(tab, index) {
    await tab.evaluate(i => {
      const r = document.querySelectorAll('#main [data-id]')[i];
      const name = /\]\s*(.+?):\s*$/.exec(r.querySelector('[data-pre-plain-text]').getAttribute('data-pre-plain-text'))[1];
      const preview = document.createElement('div');
      preview.innerHTML = `<div><span dir="auto">${r.getAttribute('data-id').startsWith('true_') ? 'You' : name}</span><span>${r.textContent}</span></div><div role="button"><span data-icon="x"></span></div>`;
      document.querySelector('footer').prepend(preview);
    }, index);
  }

  async function groupZap(query) {
    const tab = await context.newPage();
    await tab.addInitScript(() => {
      window.webln = { enabled: true, async enable() {}, async sendPayment() { return { preimage: 'ef'.repeat(32) }; } };
    });
    const memberList = query.includes('members=') ? '' : `members=${encodeURIComponent(members)}&`;
    await tab.goto(`https://web.whatsapp.com/?lexical=1&${memberList}${query}`);
    await tab.waitForFunction(() => window.__lexicalReady);
    // `norows`: no message ids on the page, so the chat cannot be identified (group or private).
    if (query.includes('norows')) await tab.evaluate(() => { for (const row of document.querySelectorAll('#main [data-id]')) row.remove(); });
    // `replyto=N`: click message N and open a reply to it, as WhatsApp shows one.
    const replyTo = /replyto=(\d)/.exec(query)?.[1];
    if (replyTo !== undefined) await openReply(tab, Number(replyTo));
    const tabCdp = await context.newCDPSession(tab);
    const until = async pattern => {
      const deadline = Date.now() + 10_000;
      let last = null;
      while (Date.now() < deadline) {
        const { root } = await tabCdp.send('DOM.getDocument', { depth: -1, pierce: true });
        const host = (function find(n) { if (n.attributes?.includes('data-whatsapp-zaps')) return n; for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) { const f = find(c); if (f) return f; } return null; })(root);
        const out = [];
        if (host) (function walk(n) { if (n.nodeType === 3 && !/^\s*$/.test(n.nodeValue)) out.push(n.nodeValue); for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) if (c.nodeName !== 'STYLE' && !ariaHidden(c)) walk(c); })(host);
        last = host ? out.join(' ') : null;
        if (last !== null && pattern.test(last)) return last;
        await new Promise(r => setTimeout(r, 100));
      }
      throw new Error(`group zap dialog never matched ${pattern}; last: ${last}`);
    };
    await tab.click(lexBox);
    await tab.keyboard.press('End');
    await tab.keyboard.press('Enter');
    const confirmText = await until(/Confirm zap/);
    await tab.keyboard.press('Enter');
    const resultText = await until(/Zap sent/);
    const messages = await tab.$$eval('.sent-message', els => els.map(e => e.textContent));
    const left = await tab.$eval(lexBox, el => el.textContent.trim());
    if (shotDir) await tab.screenshot({ path: join(shotDir, `11-group-${messages.length}-${Date.now() % 1000}.png`) });
    await tab.close();
    return { confirmText, resultText, messages, left };
  }

  // A. The person picked Jaqui from WhatsApp's list when typing the command: that mention is kept.
  const kept = await groupZap(`mention=${encodeURIComponent('Jaqui:5491177@c.us')}&text=${encodeURIComponent('/zap @Jaqui 21 thanks')}`);
  console.log('kept mention:', kept.messages);
  assert.match(kept.confirmText, /⚡ Zapped\s+@Jaqui\s+21 sats — thanks/);
  assert.deepEqual(kept.messages, ['⚡ Zapped @Jaqui{{5491177@c.us}} 21 sats — thanks'], 'real mention, with the contact id');
  assert.equal(kept.left, '');

  // B. Typed "@Bob" without picking: the extension opens WhatsApp's list and picks Bob.
  const picked = await groupZap(`text=${encodeURIComponent('/zap @Bob 5')}`);
  console.log('picked mention:', picked.messages);
  assert.deepEqual(picked.messages, ['⚡ Zapped @Bob{{5491188@c.us}} 5 sats']);
  assert.equal(picked.left, '');

  // C. No member matches: plain text, never a guessed mention.
  const plain = await groupZap(`text=${encodeURIComponent('/zap @Carl 5')}`);
  console.log('plain:', plain.messages);
  assert.deepEqual(plain.messages, ['⚡ Zapped Carl 5 sats']);
  assert.equal(plain.left, '');

  // 13. The same three cases with markup the extension has never seen.
  const opaqueKept = await groupZap(`markup=opaque&mention=${encodeURIComponent('Jaqui:5491177@c.us')}&text=${encodeURIComponent('/zap @Jaqui 22 thanks')}`);
  console.log('opaque kept:', opaqueKept.messages);
  assert.deepEqual(opaqueKept.messages, ['⚡ Zapped @Jaqui{{5491177@c.us}} 22 sats — thanks']);
  const opaquePicked = await groupZap(`markup=opaque&text=${encodeURIComponent('/zap @Bob 5 gracias')}`);
  console.log('opaque picked:', opaquePicked.messages);
  assert.deepEqual(opaquePicked.messages, ['⚡ Zapped @Bob{{5491188@c.us}} 5 sats — gracias']);
  const opaqueAmbiguous = await groupZap(`markup=opaque&members=${encodeURIComponent('Bea:1@c.us,Bea Smith:2@c.us')}&text=${encodeURIComponent('/zap @Be 5')}`);
  console.log('opaque ambiguous:', opaqueAmbiguous.messages);
  assert.equal(opaqueAmbiguous.messages.length, 1);
  assert.doesNotMatch(opaqueAmbiguous.messages[0], /\{\{/, 'two people fit: no guessed mention');
  const diagnostics = await worker.evaluate(() => chrome.storage.local.get('diagnostics'));
  assert.ok(diagnostics.diagnostics.some(d => /mention could not be made/.test(d.what) && /Bea Smith/.test(d.details['what appeared after typing @'])), 'the failed attempt left diagnostics');

  // 14. The reported bug: the page cannot tell it is a group, but the command holds a
  //     picked mention, so the mention is kept anyway.
  const unidentified = await groupZap(`norows=1&markup=opaque&mention=${encodeURIComponent('Jaqui:5491177@c.us')}&text=${encodeURIComponent('/zap @Jaqui 10')}`);
  console.log('unidentified chat:', unidentified.messages);
  assert.deepEqual(unidentified.messages, ['⚡ Zapped @Jaqui{{5491177@c.us}} 10 sats']);

  // 16. Replying in a group: `/zap 12 great point` pays the author of that message.
  const replied = await groupZap(`replyto=0&members=${encodeURIComponent('Ana Paula:5491100000000@c.us,Ana Lia:5491100000001@c.us,Bob:5491188@c.us')}&text=${encodeURIComponent('/zap 12 great point')}`);
  console.log('reply:', replied.messages);
  assert.match(replied.confirmText, /12 sats\s+to Ana Paula/);
  assert.deepEqual(replied.messages, ['⚡ Zapped @Ana Paula{{5491100000000@c.us}} 12 sats — great point']);
  //     ...and a reply to one's own message is refused.
  const own = await context.newPage();
  await own.addInitScript(() => { window.webln = { enabled: true, async enable() {}, async sendPayment() { throw new Error('must not pay'); } }; });
  await own.goto(`https://web.whatsapp.com/?lexical=1&text=${encodeURIComponent('/zap 13')}`);
  await own.waitForFunction(() => window.__lexicalReady);
  await openReply(own, 1);
  await own.click(lexBox);
  await own.keyboard.press('End');
  await own.keyboard.press('Enter');
  const ownCdp = await context.newCDPSession(own);
  let ownText = null;
  for (let i = 0; i < 50 && !ownText; i++) {
    const { root } = await ownCdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const host = (function find(n) { if (n.attributes?.includes('data-whatsapp-zaps')) return n; for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) { const f = find(c); if (f) return f; } return null; })(root);
    if (host) { const out = []; (function walk(n) { if (n.nodeType === 3 && !/^\s*$/.test(n.nodeValue)) out.push(n.nodeValue); for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) if (c.nodeName !== 'STYLE' && !ariaHidden(c)) walk(c); })(host); ownText = out.join(' '); }
    else await new Promise(r => setTimeout(r, 100));
  }
  console.log('own reply:', ownText);
  assert.match(ownText ?? '', /That is your own message/);
  await own.close();

  // 17. ⚡ reaction to a message: zap its author 21 sats, post nothing, keep the draft.
  const react = await context.newPage();
  await react.addInitScript(() => {
    const calls = (window.__weblnCalls = []);
    window.webln = { enabled: true, async enable() {}, async sendPayment(pr) { calls.push(pr); return { preimage: 'aa'.repeat(32) }; } };
  });
  await react.goto(`https://web.whatsapp.com/?lexical=1&text=${encodeURIComponent('draft stays')}`);
  await react.waitForFunction(() => window.__lexicalReady);
  // A private chat with Ana Paula, as in the report.
  await react.evaluate(() => {
    const rows = document.querySelectorAll('#main [data-id]');
    rows[0].setAttribute('data-id', 'false_5491100000000@c.us_3EB0AAAA');
    rows[1].setAttribute('data-id', 'true_5491100000000@c.us_3EB0BBBB');
  });
  const reactCdp = await context.newCDPSession(react);
  const reactDialog = async pattern => {
    for (let i = 0; i < 100; i++) {
      const { root } = await reactCdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const host = (function find(n) { if (n.attributes?.includes('data-whatsapp-zaps')) return n; for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) { const f = find(c); if (f) return f; } return null; })(root);
      const out = [];
      if (host) (function walk(n) { if (n.nodeType === 3 && !/^\s*$/.test(n.nodeValue)) out.push(n.nodeValue); for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) if (c.nodeName !== 'STYLE' && !ariaHidden(c)) walk(c); })(host);
      const text = host ? out.join(' ') : null;
      if (pattern === null ? text === null : text !== null && pattern.test(text)) return text;
      await new Promise(r => setTimeout(r, 100));
    }
    const { root } = await reactCdp.send('DOM.getDocument', { depth: -1, pierce: true });
    throw new Error(`reaction dialog never matched ${pattern}; badges: ${await react.$$eval('.reaction-badge', b => b.length)}; sent: ${JSON.stringify(await react.evaluate(() => window.__weblnCalls.length))}`);
  };
  // React the way WhatsApp may: the picker opens from a button outside the message
  // (no click on the message), applies the reaction on press and closes, and the
  // message gets a ⚡ badge.
  const reactWithLightning = async () => {
    await react.evaluate(() => {
      document.getElementById('picker')?.remove();
      const picker = document.createElement('div');
      picker.id = 'picker';
      picker.style.cssText = 'position:fixed;top:40px;left:300px;display:flex;gap:8px;font-size:24px';
      picker.innerHTML = '<span role="button">👍</span><span role="button" id="bolt"><img alt="⚡" width="24" height="24" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></span>';
      picker.querySelector('#bolt').addEventListener('mousedown', () => {
        picker.remove();
        const badge = document.createElement('span');
        badge.className = 'reaction-badge';
        badge.innerHTML = '<img alt="⚡" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';
        // Drawn next to the bubble, in the same chat row.
        document.querySelectorAll('#main [data-id]')[0].parentElement.append(badge);
      });
      document.body.append(picker);
    });
    await react.click('#bolt');
  };
  await reactWithLightning();
  const reactConfirm = await reactDialog(/Confirm zap/);
  console.log('reaction confirm:', reactConfirm);
  assert.match(reactConfirm, /21 sats\s+to (Ana Paula|Friends & Family).*ana@wallet\.example.*For your ⚡ reaction/s);
  assert.doesNotMatch(reactConfirm, /Post in the chat/);
  await react.keyboard.press('Enter');
  const reactResult = await reactDialog(/Zap sent/);
  assert.doesNotMatch(reactResult, /Posted in the chat/);
  assert.equal((await react.evaluate(() => window.__weblnCalls)).length, 1);
  assert.deepEqual(await react.$$eval('.sent-message', els => els.length), 0, 'nothing posted');
  assert.equal(await react.$eval(lexBox, el => el.textContent), 'draft stays', 'the draft is untouched');
  await react.keyboard.press('Enter');
  await reactDialog(null);
  await reactWithLightning();
  const again = await reactDialog(/Already paid.*⚡ reaction to this same message/s);
  console.log('reaction again:', again.slice(0, 80));
  await react.keyboard.press('Enter');
  await reactDialog(null);
  assert.equal((await react.evaluate(() => window.__weblnCalls)).length, 1, 'no second payment');
  await react.close();

  // 18. A picker whose emoji are unlabeled sprites: the ⚡ press is not recognisable,
  //     but the ⚡ badge WhatsApp then adds to the message still leads to the zap.
  const sprite = await context.newPage();
  await sprite.addInitScript(() => { window.webln = { enabled: true, async enable() {}, async sendPayment() { return { preimage: 'bb'.repeat(32) }; } }; });
  await sprite.goto(`https://web.whatsapp.com/?lexical=1`);
  await sprite.waitForFunction(() => window.__lexicalReady);
  await sprite.evaluate(() => {
    const rows = document.querySelectorAll('#main [data-id]');
    rows[0].setAttribute('data-id', 'false_5491100000000@c.us_3EB0SPRITE');
    const picker = document.createElement('div');
    picker.style.cssText = 'position:fixed;top:40px;left:300px;width:30px;height:30px';
    picker.innerHTML = '<div role="button" id="sprite" style="width:30px;height:30px;background:#fc0"></div>';
    picker.querySelector('#sprite').addEventListener('mousedown', () => {
      picker.remove();
      const badge = document.createElement('span');
      badge.innerHTML = '<img alt="⚡" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';
      rows[0].parentElement.append(badge);
    });
    document.body.append(picker);
  });
  await sprite.click('#sprite');
  const spriteCdp = await context.newCDPSession(sprite);
  let spriteText = null;
  for (let i = 0; i < 50 && !(spriteText && /Confirm zap/.test(spriteText)); i++) {
    const { root } = await spriteCdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const host = (function find(n) { if (n.attributes?.includes('data-whatsapp-zaps')) return n; for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) { const f = find(c); if (f) return f; } return null; })(root);
    if (host) { const out = []; (function walk(n) { if (n.nodeType === 3 && !/^\s*$/.test(n.nodeValue)) out.push(n.nodeValue); for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) if (c.nodeName !== 'STYLE' && !ariaHidden(c)) walk(c); })(host); spriteText = out.join(' '); }
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('sprite picker:', (spriteText ?? '').slice(0, 90));
  assert.match(spriteText ?? '', /Confirm zap.*21 sats.*For your ⚡ reaction/s);
  await sprite.close();

  // 19. The ⚡ button beside a message: hover, click, confirm, pay — nothing posted.
  const hover = await context.newPage();
  await hover.addInitScript(() => {
    const calls = (window.__weblnCalls = []);
    window.webln = { enabled: true, async enable() {}, async sendPayment(pr) { calls.push(pr); return { preimage: 'cc'.repeat(32) }; } };
  });
  await hover.goto(`https://web.whatsapp.com/?lexical=1&text=${encodeURIComponent('my draft')}`);
  await hover.waitForFunction(() => window.__lexicalReady);
  await hover.evaluate(() => {
    document.querySelectorAll('#main [data-id]')[0].setAttribute('data-id', 'false_120363000000000000@g.us_HOVER_5491100000000@c.us');
  });
  await hover.hover('#main [data-id] [data-pre-plain-text]');
  const hoverCdp = await context.newCDPSession(hover);
  // The button lives in a closed shadow root: find its box through CDP and click it for real.
  let box = null;
  for (let i = 0; i < 30 && !box; i++) {
    const { root } = await hoverCdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const btn = (function find(n) {
      if (n.nodeName === 'BUTTON' && (n.attributes ?? []).join(' ').includes('Zap 21 sats to Ana Paula')) return n;
      for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) { const f = find(c); if (f) return f; }
      return null;
    })(root);
    if (btn) { try { box = (await hoverCdp.send('DOM.getBoxModel', { backendNodeId: btn.backendNodeId })).model.content; } catch { box = null; } }
    if (!box) await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(box, 'the ⚡ button appeared');
  if (shotDir) await hover.screenshot({ path: join(shotDir, '12-zap-pill.png'), clip: { x: 0, y: 0, width: 420, height: 160 } });
  await hover.mouse.click((box[0] + box[4]) / 2, (box[1] + box[5]) / 2);
  let hoverText = null;
  for (let i = 0; i < 50 && !(hoverText && /Confirm zap/.test(hoverText)); i++) {
    const { root } = await hoverCdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const host = (function find(n) { if ((n.attributes ?? []).includes('data-whatsapp-zaps')) return n; for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) { const f = find(c); if (f) return f; } return null; })(root);
    if (host) { const out = []; (function walk(n) { if (n.nodeType === 3 && !/^\s*$/.test(n.nodeValue)) out.push(n.nodeValue); for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) if (c.nodeName !== 'STYLE' && !ariaHidden(c)) walk(c); })(host); hoverText = out.join(' '); }
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('zap button:', (hoverText ?? '').slice(0, 100));
  assert.match(hoverText ?? '', /Confirm zap.*21 sats.*For this message/s);
  await hover.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 600));
  assert.equal((await hover.evaluate(() => window.__weblnCalls)).length, 1);
  assert.equal(await hover.$eval(lexBox, el => el.textContent), 'my draft', 'the draft is untouched');
  await hover.close();

  // 20. ⚡ reaction read from WhatsApp's own data: a picker nothing can recognise and no
  //     badge on screen — only WhatsApp's reaction store (simulated here) knows.
  const internal = await context.newPage();
  await internal.addInitScript(() => {
    const calls = (window.__weblnCalls = []);
    window.webln = { enabled: true, async enable() {}, async sendPayment(pr) { calls.push(pr); return { preimage: 'dd'.repeat(32) }; } };
    // WhatsApp's module system, with the two modules the extension reads.
    const table = { stored: [], bulkUpsert(rows) { this.stored.push(...rows); return true; } };
    const contacts = { '5491100000000@c.us': { name: 'Ana Paula', pushname: 'Ana' } };
    const modules = {
      WAWebAddonReactionTableMode: { reactionTableMode: table },
      WAWebCollections: { Contact: { get: id => contacts[id] } },
    };
    window.require = name => { if (!(name in modules)) throw new Error(`Requiring unknown module "${name}"`); return modules[name]; };
  });
  await internal.goto(`https://web.whatsapp.com/?lexical=1&text=${encodeURIComponent('draft here')}`);
  await internal.waitForFunction(() => window.__lexicalReady);
  let hookStatus = null;
  for (let i = 0; i < 50 && !hookStatus?.ok; i++) {
    hookStatus = (await worker.evaluate(() => chrome.storage.local.get('reactionHookStatus'))).reactionHookStatus;
    if (!hookStatus?.ok) await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(hookStatus?.ok, true, 'hooked into WhatsApp’s reaction store');
  await internal.evaluate(() => {
    const picker = document.createElement('div');
    picker.style.cssText = 'position:fixed;top:40px;left:300px';
    picker.innerHTML = '<div role="button" id="opaque" style="width:30px;height:30px;background:#fc0"></div>';
    picker.querySelector('#opaque').addEventListener('mousedown', () => {
      picker.remove();
      // What WhatsApp does when the person reacts: store the reaction.
      window.require('WAWebAddonReactionTableMode').reactionTableMode.bulkUpsert([{
        id: { fromMe: true, _serialized: 'true_120363000000000000@g.us_R9' },
        reactionText: '⚡',
        reactionTimestamp: Date.now(),
        reactionParentKey: {
          fromMe: false,
          remote: { _serialized: '120363000000000000@g.us' },
          participant: { _serialized: '5491100000000@c.us' },
          _serialized: 'false_120363000000000000@g.us_INTERNAL_5491100000000@c.us',
        },
      }]);
    });
    document.body.append(picker);
  });
  await internal.click('#opaque');
  const internalCdp = await context.newCDPSession(internal);
  let internalText = null;
  for (let i = 0; i < 50 && !(internalText && /Confirm zap/.test(internalText)); i++) {
    const { root } = await internalCdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const host = (function find(n) { if ((n.attributes ?? []).includes('data-whatsapp-zaps')) return n; for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) { const f = find(c); if (f) return f; } return null; })(root);
    if (host) { const out = []; (function walk(n) { if (n.nodeType === 3 && !/^\s*$/.test(n.nodeValue)) out.push(n.nodeValue); for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) if (c.nodeName !== 'STYLE' && !ariaHidden(c)) walk(c); })(host); internalText = out.join(' '); }
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('internal reaction:', (internalText ?? '').slice(0, 110));
  assert.match(internalText ?? '', /Confirm zap.*21 sats\s+to Ana Paula.*For your ⚡ reaction/s);
  await internal.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 600));
  assert.equal((await internal.evaluate(() => window.__weblnCalls)).length, 1, 'paid once');
  assert.equal(await internal.$eval(lexBox, el => el.textContent), 'draft here', 'nothing posted, draft untouched');
  assert.equal(await internal.evaluate(() => window.require('WAWebAddonReactionTableMode').reactionTableMode.stored.length), 1, 'WhatsApp stored its reaction as usual');
  await internal.close();

  // 10. Toolbar popup: compact contacts page with search, no backup (file dialogs close popups).
  const toolbar = await context.newPage();
  await toolbar.setViewportSize({ width: 400, height: 600 });
  await toolbar.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await toolbar.waitForSelector('#global .contact');
  assert.equal(await toolbar.isVisible('#backup'), false, 'backup only on the full page');
  assert.equal(await toolbar.isVisible('#open-full'), true);
  assert.equal(await toolbar.isVisible('#search-query'), true);
  assert.match(await toolbar.textContent('#reaction-status'), /active — reading WhatsApp's own reaction data/);
  assert.equal(await toolbar.evaluate(() => document.documentElement.scrollWidth <= 400), true, 'no sideways scroll');
  if (shotDir) await toolbar.screenshot({ path: join(shotDir, '8-toolbar.png') });
  if (shotDir) {
    await toolbar.click('#tab-settings');
    await toolbar.screenshot({ path: join(shotDir, '8b-toolbar-settings.png') });
    await toolbar.click('#tab-people');
  }
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.icons['128'], 'icons/icon-128.png');

  // 15. The extension is turned off while WhatsApp stays open: the copy left in the
  //     tab is cut off from the extension. It must not crash ("reading 'local'") nor
  //     let /zap be sent as a message; it asks for a reload.
  const orphanTab = await context.newPage();
  await orphanTab.goto('https://web.whatsapp.com/');
  await orphanTab.waitForSelector('footer [contenteditable="true"]');
  await new Promise(r => setTimeout(r, 300));
  const extensionsPage = await context.newPage();
  await extensionsPage.goto('chrome://extensions');
  const extensionId = new URL(worker.url()).host;
  await extensionsPage.evaluate(id => new Promise(resolve => chrome.management.setEnabled(id, false, resolve)), extensionId);
  await extensionsPage.close();
  await orphanTab.bringToFront();
  const pageErrors = [];
  orphanTab.on('pageerror', e => pageErrors.push(e.message));
  await orphanTab.evaluate(() => {
    const box = document.querySelector('footer [contenteditable="true"]');
    box.innerHTML = '<p><span>/zap 21</span></p>';
  });
  await orphanTab.focus('footer [contenteditable="true"]');
  await orphanTab.keyboard.press('End');
  await orphanTab.keyboard.press('Enter');
  const orphanCdp = await context.newCDPSession(orphanTab);
  let orphanText = null;
  for (let i = 0; i < 50 && !orphanText; i++) {
    const { root } = await orphanCdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const host = (function find(n) { if (n.attributes?.includes('data-whatsapp-zaps')) return n; for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) { const f = find(c); if (f) return f; } return null; })(root);
    if (host) { const out = []; (function walk(n) { if (n.nodeType === 3 && !/^\s*$/.test(n.nodeValue)) out.push(n.nodeValue); for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) if (c.nodeName !== 'STYLE' && !ariaHidden(c)) walk(c); })(host); orphanText = out.join(' '); }
    else await new Promise(r => setTimeout(r, 100));
  }
  console.log('orphaned:', orphanText);
  assert.match(orphanText ?? '', /Reload this page \(F5\)/);
  assert.equal(await orphanTab.$eval('footer [contenteditable="true"]', el => el.textContent), '/zap 21', 'the command was not sent');
  assert.deepEqual(pageErrors, []);

  console.log('\nSmoke test passed.');
} finally {
  await context?.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
