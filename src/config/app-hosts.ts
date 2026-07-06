/**
 * Hosts fixos no manifest — apenas desenvolvimento local.
 *
 * Em produção o frontend envia `frontendOrigin`, `apiOrigin` ou `apiUrl` no
 * fluxo de conexão; a extensão pede permissão via `optional_host_permissions`
 * e injeta o bridge com `scripting.executeScript` (sem rebuild por cliente).
 */
export const DEV_APP_HOSTS = [
  'http://localhost/*',
  'http://127.0.0.1/*',
];

export const STORAGE_KEY_AUTHORIZED = 'togitalk_authorized_hosts';
