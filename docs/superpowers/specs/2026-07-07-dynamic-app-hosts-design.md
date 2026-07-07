# Dynamic app hosts (multi-instance) — design

**Date:** 2026-07-07
**Status:** approved (design), pending implementation
**Topic:** make `APP_HOSTS` dynamic so one build of the extension serves many
different app instances (owner-controlled parent domains, arbitrary per-client
domains, and localhost).

## Problem

Today the app origin is hard-coded in two places:

- `manifest.config.ts` → `APP_HOSTS` (used in `host_permissions` and the static
  `content_scripts.matches`).
- `src/background/index.ts` → `APP_HOST_PATTERNS` (used to inject the bridge into
  already-open tabs on install).

The extension will be used by **many different instances**. Editing the manifest
and rebuilding per instance does not scale. The systems that embed the connector
should be able to tell the extension which origin to serve.

## Hard constraint (MV3)

The manifest is **static** — baked in at build time. `host_permissions` and
`content_scripts.matches` cannot be rewritten at runtime by a URL sent over the
wire, and **granting host permission for a new origin requires a user gesture**.
So "fully automatic, zero-click, any domain" is impossible in MV3. The design
gets as close as MV3 allows via two complementary paths.

## Decision

**One published/installed extension for all instances. The app origin is
resolved at runtime.** Two integration paths, both landing on the same assertion
core:

1. **Universal path (any domain + localhost)** — a per-origin **content-script
   bridge**, injected only into origins the owner has authorized. New origins are
   authorized with **one click in the popup** (the popup pre-fills the current
   tab's URL, so it is effectively "open popup → Authorize"). Authorization
   persists in `chrome.storage` and survives restarts.
2. **Parent-domain path (owner-controlled `*.yourproduct.com`)** — declared at
   build time via an env var. Those origins get:
   - `externally_connectable` → the page talks to the extension directly with
     `chrome.runtime.connect(EXTENSION_ID)` (no content script, no per-origin
     click), **and**
   - inclusion in static `host_permissions` → zero-click content-script bridge
     too (so the same `window.postMessage` API works with no `EXTENSION_ID`).

## Architecture

### Source of truth: the permissions API (no separate storage registry)

**Refinement over the original plan:** rather than maintaining a
`chrome.storage` list of origins (which would have to be kept in sync with the
actual grants), the `chrome.permissions` API *is* the registry. An origin is
"served" exactly when `chrome.permissions.contains({origins:[<pattern>]})` is
true — this single check unifies install-granted parent domains and
runtime-granted arbitrary domains, and there is no sync/race problem.

- The popup lists **removable** origins as
  `permissions.getAll().origins` minus `manifest.host_permissions` (which
  strips WhatsApp Web and the build-time parent domains).
- Injection is driven by `permissions.contains` + the `permissions.onAdded`
  event, so the worker never reads a storage registry.
- `chrome.storage` stays only for the popup theme (`useTheme`).

### `manifest.config.ts`

- Read parent hosts from env at build:
  `CONNECTOR_PARENT_HOSTS="https://*.yourproduct.com/*,https://*.outro.com/*"`
  (comma-separated; empty by default).
- `host_permissions`: `['https://web.whatsapp.com/*', ...parentHosts]`.
- `optional_host_permissions`: `['http://*/*', 'https://*/*']` — broad, but only
  prompts when a specific origin is requested at runtime; **no install-time
  warning**.
- Remove the static `content_scripts` block (bridge is injected dynamically).
- `externally_connectable: { matches: parentHosts }` only when `parentHosts` is
  non-empty (Chrome rejects wildcard-only patterns, so this is opt-in per your
  known domains).
- `permissions` unchanged: `scripting, tabs, activeTab, storage`.

### `src/background/index.ts`

Refactor the assertion core out of the delivery mechanism, then wire both paths
and the registry:

- **`runAssertion(publicKey) → { assertion } | { error }`** — the existing
  "open `web.whatsapp.com`, executeScript MAIN world, return result" logic, with
  no knowledge of how the result is delivered. (Extracted from
  `handlePasskeyAssertion`.)
- **Content-script path (internal messages):** `RUN_PASSKEY_ASSERTION` from the
  bridge → `runAssertion` → reply via `chrome.tabs.sendMessage(originTabId, …)`
  (as today). `IS_CONNECTOR_INSTALLED` unchanged.
- **Parent-domain path (external):** `chrome.runtime.onConnectExternal` → on a
  port message `RUN_PASSKEY_ASSERTION` → `runAssertion` → `port.postMessage`
  `PASSKEY_ASSERTION_RESULT`; `PING` → `CONNECTOR_READY`.
- **Origin management (from popup):** `LIST_ORIGINS`, `ADD_ORIGIN {origin}`
  (`permissions.request` under the popup click → add to storage → inject into
  open tabs), `REMOVE_ORIGIN {origin}` (`permissions.remove` → drop from
  storage). Return status so the popup can render errors (e.g. permission
  denied).
- **Bridge injection:** a top-level `chrome.tabs.onUpdated` listener injects
  `bridgeInPage` (via `chrome.scripting.executeScript({ func })`) when a tab
  reaches `complete` and `permissions.contains` for its origin is true. On
  `onInstalled`/`onStartup`, sweep open tabs the same way (replaces the
  registry-driven `injectBridgeIntoOpenTabs`). This avoids the crxjs
  dynamic-file-bundling problem — the bridge source stays inline in the worker as
  `bridgeInPage`, the single source of truth.
- Drop the hard-coded `APP_HOST_PATTERNS`.

### `src/content/app-bridge.ts`

Removed. Its logic already exists as `bridgeInPage` in the worker, which is now
the only bridge and is injected via `executeScript`. Removing it deletes the
duplication and the last hard-coded reference.

### `src/popup/App.tsx`

Becomes a small management panel (keeps the theme toggle and styling):

- Reads the active tab URL (`chrome.tabs.query({active,currentWindow})`), derives
  its origin pattern, and shows **"Authorize this instance: <origin>"** when it
  is not yet authorized (button → `ADD_ORIGIN`, runs under the click gesture).
- Lists authorized origins with a remove button (`REMOVE_ORIGIN`).
- Shows a hint when the active tab is a parent domain ("already enabled").

### Origin normalization

One helper: URL → match pattern. `https://cliente-a.com/app/x` →
`https://cliente-a.com/*`; `http://localhost:3000` → `http://localhost:3000/*`.
Reject `chrome://`, extension, and other non-http(s) URLs in the popup.

## Integration contract for your systems (docs deliverable)

The `window.postMessage` protocol in
`docs/WHATSMEOW-IMPLEMENTATION.md` §10 stays the primary API and is unchanged on
the wire. Documentation updates:

- **New state:** "installed but this origin is not authorized yet." `detect`
  returns not-ready → your app shows "click the extension icon and Authorize
  this instance." (For parent domains this never happens.)
- **Drop-in JS helper** (auto-detect) your systems paste: if `chrome?.runtime`
  is exposed to the page (parent domain via `externally_connectable`) and
  `EXTENSION_ID` is configured, use `chrome.runtime.connect`; otherwise fall back
  to the `window.postMessage` bridge. Same `runAssertion(publicKey)` signature
  either way.
- **Build config:** how to set `CONNECTOR_PARENT_HOSTS` and where to read the
  published `EXTENSION_ID`.
- Update `README.md` Quick start (§ "Edit APP_HOSTS" → "build once; authorize per
  instance; optional parent-domain env") and §5.3 of the whatsmeow guide.

## Out of scope / YAGNI

- No account/tenant identity in the extension — it only knows origins.
- No server push of the URL into the extension without a user gesture (MV3 does
  not allow it; the popup click is the gesture).
- No `<all_urls>` static content script (privacy/store-review cost, rejected as
  approach C).

## Verification

No test harness exists in this repo (no test deps). Verification is manual:

1. `npm run build`, load `dist/` unpacked.
2. Arbitrary domain: open an app instance on a random domain / `localhost`,
   confirm `detect` is not-ready, click Authorize in popup, confirm
   `CONNECTOR_READY`, run a full assertion round trip.
3. Parent domain: set `CONNECTOR_PARENT_HOSTS`, rebuild, confirm zero-click
   `CONNECTOR_READY` via both `postMessage` and `chrome.runtime.connect`.
4. Restart the browser; confirm authorized origins persist and re-inject.
5. Remove an origin in the popup; confirm the bridge stops and permission is
   revoked.

## Files touched

- `manifest.config.ts` — env-driven parent hosts, optional host perms, drop
  static content_scripts, conditional externally_connectable.
- `src/background/index.ts` — registry, dual paths, dynamic injection, refactor.
- `src/popup/App.tsx` — authorization panel.
- `src/content/app-bridge.ts` — removed.
- `README.md`, `docs/WHATSMEOW-IMPLEMENTATION.md` — integration docs.
