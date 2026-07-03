import { defineManifest } from '@crxjs/vite-plugin';
import { DEFAULT_APP_HOSTS } from './src/config/app-hosts';

const icons = {
  '16': 'icons/icon16.png',
  '48': 'icons/icon48.png',
  '128': 'icons/icon128.png',
};

export default defineManifest({
  manifest_version: 3,
  name: 'TOGI Talk Connector',
  version: '0.1.0',
  description:
    'Conecta contas WhatsApp com passkey ao TOGI Talk via sessão autenticada do WhatsApp Web.',
  icons,
  action: { default_popup: 'index.html', default_icon: icons },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  permissions: ['scripting', 'tabs', 'activeTab', 'storage', 'browsingData'],
  host_permissions: ['https://web.whatsapp.com/*', ...DEFAULT_APP_HOSTS],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  externally_connectable: {
    matches: ['http://*/*', 'https://*/*'],
  },
  content_scripts: [
    {
      matches: ['https://web.whatsapp.com/*'],
      js: ['src/content/wa-web-dump.js'],
      world: 'MAIN',
      run_at: 'document_idle',
    },
    {
      matches: DEFAULT_APP_HOSTS,
      js: ['src/content/app-bridge.ts'],
      run_at: 'document_start',
    },
  ],
});
