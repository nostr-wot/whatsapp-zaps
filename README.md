# WhatsApp Web Zaps

Send Lightning payments from a WhatsApp Web chat:

```
/zap @Alice 1000
/zap @Ana Paula 21k gracias por el almuerzo
/zap 1,000 @Bob
```

Pressing Enter on a `/zap` command does not send it to the chat. Instead a
dialog opens, the recipient's Lightning Address is resolved, and you confirm
the amount. Then your [Nostr WoT](https://github.com/nostr-wot/nostr-wot-extension)
wallet pays. Afterwards you can add a `⚡ Zapped @Alice 1,000 sats` message to
the composer, which you send yourself.

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

The first time you zap someone, the dialog asks for their Lightning Address and
offers three choices:

- **Remember for this chat.** For a group where "Alice" means one particular
  person. These entries win over the global list.
- **Remember in every chat.**
- **Use once.**

When you pick someone from WhatsApp's mention list, the contact is stored by
WhatsApp contact id. Typed names are stored by display name. If two saved
contacts share a name, the dialog asks which one you meant.

The options page lists, deletes, imports and exports mappings. They are stored
only in `chrome.storage.local`.

## How it works

| Part | World | Job |
|------|-------|-----|
| `src/content/isolated.ts` | content script | Intercepts the send, shows the dialog, stores mappings |
| `src/content/main.ts` | page (MAIN) | Calls `window.webln.enable()` / `sendPayment()` |
| `src/background.ts` | service worker | LNURL-pay: pay params and the invoice |
| `src/whatsapp/dom.ts` | — | Every WhatsApp selector, in one table |

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
- the `data-id` message rows used for the chat id.

If they've drifted, replace the fixture with a real capture.

## Development

```bash
npm test             # unit + jsdom tests
npm run typecheck
npm run build
npm run smoke -- /path/to/chrome   # real-browser end-to-end run against dist/
```

The smoke test serves the fixture as `web.whatsapp.com` and a fake Lightning
Address host from a local HTTPS server, and stubs `window.webln`.

## License

GPL-3.0-only. See `LICENSE` and `NOTICE`.
