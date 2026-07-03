/**
 * Hosts permitidos no build (content script + injeção do bridge).
 *
 * Opções para várias instâncias:
 * 1. Wildcard — se todas ficam no mesmo domínio:
 *    'https://*.togitalk.com.br/*'
 * 2. Lista fixa — uma entrada por instância (rebuild ao adicionar)
 * 3. Popup — autorize URLs em runtime (optional_host_permissions)
 *
 * A extensão só precisa da origem do frontend (bridge + postMessage).
 * O challenge e a assertion trafegam pelo seu backend; a origem do frontend
 * precisa estar autorizada aqui ou no popup.
 */
export const DEFAULT_APP_HOSTS = [
  'http://localhost/*',
  'http://127.0.0.1/*',
  // 'https://*.togitalk.com.br/*',
];

export const STORAGE_KEY_AUTHORIZED = 'togitalk_authorized_hosts';
