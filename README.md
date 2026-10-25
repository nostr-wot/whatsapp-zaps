# WhatsApp Web Zaps

Send Lightning payments from a WhatsApp Web chat:

In a private chat no name is needed, and the help text never asks for one. Only
a chat the extension knows is a group needs `@name`; if it cannot tell, it
treats the chat as private and pays whoever the chat header names.

```
/zap 1000                      ← in a private chat: pays the person you are chatting with
/zap @Alice 1000               ← in a group: name who to pay
/zap @Ana Paula 21k gracias por el almuerzo
/zap 1,000 @Bob
```

While the message box holds a `/zap` command, its text turns WhatsApp green and
bold, so it is clearly a payment and not a message. The command itself is never
sent.

### After paying

The confirm screen has **Post in the chat once the payment is confirmed**,
ticked by default (your last choice is remembered). The message, `⚡ Sent you 1,000 sats` in a private chat or `⚡ Sent 1,000 sats to Ana` in a group
(plus your comment, if you gave one), is posted only after the wallet has confirmed the payment with
its proof. If the payment fails, is declined or its outcome is unknown, nothing
is posted.

The message replaces your `/zap` command in the box and is sent. If that fails,
the dialog shows the message for you to copy, and the command is still removed
from the box. If it cannot be removed, the dialog says so in red, because
pressing Enter would start another zap.

Typing the same `/zap` command again in the same chat within 30 minutes shows
**Already paid**. Its default button, "Don't pay again", removes the command
without paying.

Pressing Enter on a `/zap` command does not send it to the chat. Instead a
dialog opens, the recipient's Lightning Address is resolved, and you confirm
the amount. Then your [Nostr WoT](https://github.com/nostr-wot/nostr-wot-extension)
wallet pays. Once the payment is confirmed, a short message saying so is
posted in the chat (see **After paying**).

## Requirements

- Nostr WoT, with a wallet connected. It supplies `window.webln`, which this
  extension uses to pay.
- Chrome or another Chromium browser.
- Firefox 128+ should also work, because it supports `world: "MAIN"` content
  scripts, but it is not tested yet.

## Install (development)

```bash
npm install
npm run build        # → dist/
```

Load `dist/` as an unpacked extension (chrome://extensions → Developer mode →
Load unpacked) next to Nostr WoT, then open https://web.whatsapp.com.

## Contacts and Lightning Addresses

The first time you zap someone, the dialog asks for their Lightning Address.
You can type it, or **find the person on Nostr**. Type a name, an `npub` or
`nprofile`, or a NIP-05 address such as `ana@nostr.example`, then press Enter
or *Search Nostr*. Pick a result and the Lightning Address (`lud16`) from their
profile is filled in. Then choose how to remember it:

- **Remember for this chat.** For a group where "Alice" means one particular
  person. These entries win over the global list.
- **Remember in every chat.**
- **Use once.**

When you pick someone from WhatsApp's mention list, the contact is stored by
WhatsApp contact id. Typed names are stored by display name. If two saved
contacts share a name, the dialog asks which one you meant.

### From a chat's ⋮ menu

Open a chat, click the **⋮** menu in its header, and choose **⚡ Nostr profile**.

- **One-to-one chat:** the popup shows which Nostr profile or Lightning
  Address this contact is linked to, with the profile's name, verified NIP-05
  and npub. You can search Nostr to link a profile, type a Lightning Address
  instead, replace the link, or unlink.
- **Group:** it lists the members linked in that group. To link another, type
  their name as it appears in the group and search for them.

The search box starts with the contact's name, but nothing is searched until
you press Search. A WhatsApp name only reaches a relay if you choose to send it.

### Toolbar popup and contacts page

Click the extension's toolbar icon for a small **popup** with your saved
contacts and Nostr search. **Full page** opens the same list in a tab, which
also has backup (JSON import and export); file dialogs close popups, so backup
lives there. Both have:

- the same Nostr search, where each result can be saved under a WhatsApp name,
- the saved mappings, which you can delete.

Everything about your contacts stays in this browser, in
`chrome.storage.local`: which WhatsApp contact is which Nostr profile, and
which Lightning Address. When an address came from a Nostr profile, the link
also stores that profile's pubkey, its name and its NIP-05 (only if verified),
so the popup can show them without fetching anything.

### Telling people apart on Nostr

Anyone can call themselves "Ana", so each search result shows:

- **A ✓ next to the NIP-05 address** when the address was checked and really
  points to that key. An unchecked one says "not verified".
- **The npub**, shortened; hover for the full key.
- **Whether the profile has a Lightning Address.** Profiles without one are
  shown but can't be picked.

Profiles are only accepted with a valid signature, so a relay can't change
someone's Lightning Address. Verified profiles are listed first.

### Typing a Nostr address

A NIP-05 Nostr address (`ana@some-nostr-site.com`) looks exactly like a
Lightning Address, but it usually is not one: its server answers "not found"
(404). So a `name@domain` you type is first checked on Nostr. If it is the
verified NIP-05 of a profile, that profile's Lightning Address is used, and the
popup or confirm screen shows it. Otherwise it is used as you typed it.

### Where searches go

- **Names** go to the public NIP-50 search relays (`relay.nostr.band`,
  `search.nos.today`), which see what you search for.
- **npub and NIP-05 lookups** ask a few general relays for that one profile.
  A NIP-05 lookup also fetches `https://<domain>/.well-known/nostr.json`.

The relay lists are in `src/constants.ts`. These lookups use the same
safeguards as LNURL: no redirects, a timeout and a size cap.

## How it works

| Part | World | Job |
|------|-------|-----|
| `src/content/isolated.ts` | content script | Intercepts the send, shows the dialog, stores mappings |
| `src/content/main.ts` | page (MAIN) | Calls `window.webln.enable()` / `sendPayment()` |
| `src/background.ts` | service worker | LNURL-pay (pay params, invoice) and Nostr profile search |
| `src/whatsapp/dom.ts` | — | Every WhatsApp selector, in one table |
| `src/whatsapp/menu.ts` | — | Adds "⚡ Nostr profile" to the chat header's ⋮ menu |
| `src/whatsapp/highlight.ts` | — | Shows a `/zap` command in green in the message box |
| `src/options/` | extension page | Contacts page; also built as the toolbar popup (`popup.html`) |

### Who authorizes the payment

Nostr WoT does, through its normal WebLN path for the origin
`https://web.whatsapp.com`:

- connect and WebLN consent the first time,
- then either its approval prompt, or silent payment within the spending
  allowance you configured there.

This extension's dialog only confirms *who* and *how much*.

### Safeguards

- **No retries.** Each LNURL request creates a new invoice, so a retry could
  pay twice. A timeout or unclear wallet error is reported as "status unknown —
  check your wallet", never retried.
- **Exact amount.** The returned invoice must be for the confirmed amount, to
  the millisatoshi.
- **Ported LNURL hardening.** The LNURL client is ported from Nostr WoT (see
  `NOTICE`): HTTPS only, no private or IP hosts, no redirects, a timeout and a
  response size cap.
- **Callback stays in the background.** The callback URL never passes through
  the page or the content script.
- **The page can't press Pay.** The dialog is in a closed shadow root and
  ignores synthetic clicks, so WhatsApp's own scripts cannot read it or press
  Pay.
- **The page bridge adds no power.** It runs over `postMessage`, which the page
  can see, but it grants nothing the page lacks: any script on WhatsApp Web can
  already call `window.webln` itself. See `src/domain/bridge.ts`.

## WhatsApp markup

WhatsApp changes its DOM without notice. The selectors in `src/whatsapp/dom.ts`
are matched against `tests/fixtures/whatsapp-chat.html`, which is a
**reconstruction, not a capture**. Check them against the live site before
relying on this:

- the composer,
- the send button,
- mention chips (`data-app-text-template`),
- the header ⋮ button and its dropdown items (`data-animate-dropdown-item`),
- `body.dark`, which is how WhatsApp marks its dark theme (the dialogs follow it).

WhatsApp's message box is a Lexical editor. The smoke test runs one with real
Lexical (`tests/fixtures/lexical-composer.ts`), because edits that work on a
plain editable box can silently do nothing in Lexical.
- the `data-id` message rows used for the chat id.

If they've drifted, replace the fixture with a real capture.

## Development

```bash
npm test             # unit + jsdom tests
npm run typecheck
npm run build
npm run smoke -- /path/to/chrome   # real-browser end-to-end run against dist/
node scripts/icons.mjs /path/to/chrome   # re-render icons/*.svg to PNGs
```

The smoke test runs one local HTTPS/WebSocket server that serves:

- the fixture, as `web.whatsapp.com`,
- a fake Lightning Address host,
- a NIP-05 host,
- the Nostr relays, with every default relay hostname mapped to it.

It also stubs `window.webln`.

## License

GPL-3.0-only. See `LICENSE` and `NOTICE`.
