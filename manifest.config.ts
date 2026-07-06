import { defineManifest } from '@crxjs/vite-plugin';
import { DEV_APP_HOSTS } from './src/config/app-hosts';
import pkg from './package.json';

const icons = {
  '16': 'icons/icon16.png',
  '48': 'icons/icon48.png',
  '128': 'icons/icon128.png',
};

export default defineManifest({
  manifest_version: 3,
  name: 'Conector WA',
  version: pkg.version,
  description:
    'Extensão que ajuda a conectar de forma segura sua instância ao seu painel.',
  icons,
  action: { default_popup: 'index.html', default_icon: icons },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  permissions: ['scripting', 'tabs', 'activeTab', 'storage', 'browsingData'],
  host_permissions: ['https://web.whatsapp.com/*', ...DEV_APP_HOSTS],
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
      matches: DEV_APP_HOSTS,
      js: ['src/content/app-bridge.ts'],
      run_at: 'document_start',
    },
  ],
});
