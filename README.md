# WA Passkey Connector

A Manifest V3 browser extension that imports an already-authenticated
**WhatsApp Web** session into your app, so you can pair a **passkey-locked**
WhatsApp account with a [whatsmeow](https://github.com/tulir/whatsmeow) client.

Passkey-locked accounts cannot be paired by driving QR from a headless client -
the server requires a WebAuthn assertion from the owner's own authenticator.
This extension lets the owner authenticate `web.whatsapp.com` natively (with
their passkey), then extracts that session and hands it to your backend for
conversion + import into whatsmeow. No re-pairing, no headless bypass.

> **Full end-to-end guide (whatsmeow + backend + converter + UI + this
> extension):** [`docs/WHATSMEOW-IMPLEMENTATION.md`](docs/WHATSMEOW-IMPLEMENTATION.md).

## What this extension does

Opens `web.whatsapp.com` in a background tab, forces passkey mode, lets the owner
complete the native passkey flow (and 2FA PIN if any), waits for a **complete and
stable** session, dumps it, `POST`s it to a signed one-time URL your app
provides, then wipes the WhatsApp Web session and closes the tab.

It integrates with **any** frontend through a small `window.postMessage`
protocol and with **any** backend through a single `POST` of the dump. See the
protocol in [the guide](docs/WHATSMEOW-IMPLEMENTATION.md#12-the-postmessage-protocol).

## Quick start

```bash
npm install
npm run build      # -> dist/  (unpacked extension)
```

1. Edit **`manifest.config.ts`** and set `APP_HOSTS` to the origin(s) where your
   web app runs (add `http://localhost/*` for local dev). Mirror the same list in
   `APP_HOST_PATTERNS` in `src/background/index.ts`.
2. `npm run build`.
3. Load it in Chrome: `chrome://extensions` -> enable Developer mode -> **Load
   unpacked** -> select the `dist/` folder.

Package a signed `.crx` with `npm run pack` (generate `key.pem` first, keep it
private, never commit it).

## Integration in one minute

Your app page, once a connection reports it needs a passkey:

```js
// 1. detect the extension
window.addEventListener('message', (e) => {
  if (e.data?.source === 'wa-passkey-connector' && e.data.type === 'CONNECTOR_READY') {
    /* installed */
  }
});
window.postMessage({ target: 'wa-passkey-connector', type: 'PING' }, '*');

// 2. start the flow with a signed one-time upload URL from your backend
const { url } = await fetch('/import-url', { method: 'POST' }).then((r) => r.json());
window.postMessage({ target: 'wa-passkey-connector', type: 'START_PASSKEY_IMPORT', url }, '*');
```

The extension replies with `EXISTING_SESSION` (needs consent), `IMPORT_SENT`, or
`IMPORT_ERROR`. Full message table in the guide.

## Permissions

`scripting`, `tabs`, `activeTab`, `storage`, `browsingData` (used only to log out
`web.whatsapp.com` on the user's browser, with consent / after import), plus
`host_permissions` for `web.whatsapp.com` and your app host(s).

## Tech

React 18 + Tailwind + Vite + `@crxjs/vite-plugin`. Neutral styling - restyle the
popup and replace the placeholder icons in `public/icons/` with your own.

## Caveats

This automates WhatsApp Web and relocates a session; it may violate WhatsApp's
Terms of Service and browser-extension store policies. Always obtain the account
owner's explicit consent, and prefer private/unlisted or enterprise distribution
over a public store listing. Session dumps are impersonation-grade - handle them
as secrets end to end.

## Acknowledgements

This project stands on the shoulders of two open-source tools:

- **[wa-web-dump](https://github.com/w3nder/wa-web-dump)** by
  [Wender Teixeira (w3nder)](https://github.com/w3nder) - the in-page WhatsApp
  Web session dumper this extension's `src/content/wa-web-dump.js` is based on.
- **[wa-store-migrate](https://www.npmjs.com/package/wa-store-migrate)** by
  [vini (vinikjkkj)](https://github.com/vinikjkkj) - the converter that turns a
  WhatsApp Web dump into a whatsmeow snapshot, used on the backend side of the
  end-to-end flow.

Thank you to both - their work is the foundation this connector is built on.

## License

Released into the **public domain** under [The Unlicense](LICENSE). Do anything
you want with it - use, modify, distribute, sell, commercialize - with no
attribution required.
