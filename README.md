# WA Passkey Connector

A Manifest V3 browser extension that runs the **WhatsApp passkey (WebAuthn)
assertion** in the account owner's own browser, so you can link a companion
device on a **passkey-locked** WhatsApp account with a
[whatsmeow](https://github.com/tulir/whatsmeow) client.

Passkey-locked accounts cannot be linked by driving QR from a headless client -
the server requires a WebAuthn assertion from the owner's own authenticator. Your
whatsmeow client drives the whole pairing handshake; this extension delegates the
**one** thing it cannot do headless - the passkey signature - to the owner's
browser, and hands the assertion back. The result is a **freshly linked device**,
not a copy of the owner's session. No session dump, no headless bypass.

> **Full end-to-end guide (whatsmeow + backend + UI + this extension):**
> [`docs/WHATSMEOW-IMPLEMENTATION.md`](docs/WHATSMEOW-IMPLEMENTATION.md).
>
> **Frontend integration (URL dinâmica da API):**
> [`docs/FRONTEND-INTEGRATION.md`](docs/FRONTEND-INTEGRATION.md).

## What this extension does

On `RUN_PASSKEY_ASSERTION { publicKey }` from your page, it opens
`web.whatsapp.com`, runs `navigator.credentials.get` with the server-issued
challenge in the page's MAIN world (the owner confirms with their passkey, plus
the 2FA PIN if any), and returns the assertion (`PASSKEY_ASSERTION_RESULT`). It
reads nothing else and stores nothing.

It integrates with **any** frontend through a small `window.postMessage` protocol
and with **any** backend/whatsmeow worker through the assertion round trip. See
the protocol in
[the guide](docs/WHATSMEOW-IMPLEMENTATION.md#10-the-postmessage-protocol).

Host permissions for your app are requested at runtime from the URL the frontend
sends (`apiOrigin` / `apiUrl` in `RUN_PASSKEY_ASSERTION`) — no rebuild per customer.

## Quick start

```bash
npm install
npm run build      # -> dist/  (unpacked extension)
```

1. `npm run build`.
2. Load it in Chrome: `chrome://extensions` -> enable Developer mode -> **Load
   unpacked** -> select the `dist/` folder.

For local dev, the content script auto-loads on `localhost`. In production the
extension injects the bridge after the user grants host permission.

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

// 2. get the challenge from your backend, run the assertion (send API URL), post it back
const requestId = crypto.randomUUID();
const apiOrigin = 'https://api.example.com';
const { publicKey } = await fetch(`${apiOrigin}/passkey-challenge/${connId}`).then((r) => r.json());
window.addEventListener('message', async (e) => {
  if (e.data?.source !== 'wa-passkey-connector') return;
  if (e.data.type === 'PASSKEY_ASSERTION_RESULT' && e.data.requestId === requestId) {
    if (e.data.assertion) {
      await fetch(`${apiOrigin}/passkey-response/${connId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(e.data.assertion),
      });
    }
  }
});
window.postMessage({
  target: 'wa-passkey-connector',
  type: 'RUN_PASSKEY_ASSERTION',
  requestId,
  publicKey,
  apiOrigin,
}, '*');
```

Full message table and the whatsmeow-side snippets (`GetPasskeyRequestOptions`,
`SendPasskeyResponse`, `SendPasskeyConfirmation`) are in the guide.

## Permissions

`scripting`, `tabs`, `activeTab`, `storage`, plus `host_permissions` for
`web.whatsapp.com` (where the assertion runs) and your app host(s). The extension
does **not** read the WhatsApp Web session and needs no `browsingData`.

## Tech

React 18 + Tailwind + Vite + `@crxjs/vite-plugin`. Neutral styling - restyle the
popup and replace the placeholder icons in `public/icons/` with your own.

## Caveats

This automates a `navigator.credentials.get` on `web.whatsapp.com` to link a
companion device; it may touch WhatsApp's Terms of Service and browser-extension
store policies. Always obtain the account owner's explicit consent, and prefer
private/unlisted or enterprise distribution over a public store listing. The
WebAuthn assertion is a one-shot secret - forward it verbatim and never store it.

## License

Released into the **public domain** under [The Unlicense](LICENSE). Do anything
you want with it - use, modify, distribute, sell, commercialize - with no
attribution required.
