import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineManifest } from '@crxjs/vite-plugin';

// Single source of truth for the version: package.json. `npm run build` bumps its
// patch (see the "prebuild" script) and this reads the fresh value each build.
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

const icons = {
  '16': 'icons/icon16.png',
  '48': 'icons/icon48.png',
  '128': 'icons/icon128.png',
};

// --- Multi-instance configuration -------------------------------------------
// This build serves MANY app instances from a SINGLE extension. There is no
// hard-coded APP_HOSTS anymore.
//
// Two ways an app origin gets served (see docs/WHATSMEOW-IMPLEMENTATION.md §5.3):
//
//  1. Any domain + localhost (runtime): the owner authorizes the instance with
//     one click in the popup. Nothing to configure at build time — it works out
//     of the box via `optional_host_permissions` requested per origin.
//
//  2. Parent domains you control (build-time, optional, zero-click): list them
//     in the CONNECTOR_PARENT_HOSTS env var as a comma-separated list of match
//     patterns, e.g.
//         CONNECTOR_PARENT_HOSTS="https://*.yourproduct.com/*,https://*.other.com/*"
//     Those origins are baked into `host_permissions` (zero-click content-script
//     bridge) AND `externally_connectable` (direct chrome.runtime.connect).
//     Chrome rejects wildcard-only patterns here, so this is opt-in per your
//     known domains.
const PARENT_HOSTS = (process.env.CONNECTOR_PARENT_HOSTS ?? '')
  .split(',')
  .map((pattern) => pattern.trim())
  .filter(Boolean);

export default defineManifest({
  manifest_version: 3,
  name: 'Central Connect',
  version,
  description:
    'Runs the WhatsApp passkey (WebAuthn) assertion in the owner browser to pair a passkey-locked account with your app.',
  icons,
  action: { default_popup: 'index.html', default_icon: icons },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  permissions: ['scripting', 'tabs', 'activeTab', 'storage'],
  // Static: only WhatsApp Web (where the assertion runs) plus any parent domains
  // you opted into at build time. App instances on arbitrary domains are granted
  // at runtime via optional_host_permissions.
  host_permissions: ['https://web.whatsapp.com/*', ...PARENT_HOSTS],
  // Broad, but only ever prompts when a SPECIFIC origin is requested at runtime
  // (from the popup, under a user click). No install-time "all sites" warning.
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  // The app-page bridge is injected dynamically (background worker) into
  // authorized origins only — there is no static content_scripts block.
  // externally_connectable amplo e ESTÁTICO: qualquer origem de app fala com a
  // extensão via chrome.runtime.connect(EXTENSION_ID) sem bakar domínio nem
  // exigir o popup de autorização. A extensão só expõe PING e
  // RUN_PASSKEY_ASSERTION e não lê nada da origem chamadora.
  externally_connectable: { matches: ['https://*/*', 'http://*/*'] },
});
