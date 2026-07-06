import { DEV_APP_HOSTS } from '@/config/app-hosts';
import {
  getAllHostPatterns,
  normalizeOriginInput,
  originToPattern,
  readStoredOrigins,
  saveStoredOrigins,
  urlIsAuthorizedAppUrl,
} from '@/lib/hosts';

export const CONNECTOR_SOURCE = 'wa-passkey-connector';

export type RegisterInstanceInput = {
  frontendOrigin?: string;
  apiOrigin?: string;
  apiUrl?: string;
};

export type RegisterInstanceResult = {
  ok: boolean;
  error?: string;
  authorized?: string[];
  needsPermission?: boolean;
};

function collectOrigins(input: RegisterInstanceInput): string[] {
  const origins = new Set<string>();
  if (input.frontendOrigin) {
    origins.add(normalizeOriginInput(input.frontendOrigin));
  }
  if (input.apiOrigin) {
    origins.add(normalizeOriginInput(input.apiOrigin));
  }
  if (input.apiUrl) {
    try {
      origins.add(new URL(input.apiUrl).origin);
    } catch {
      void 0;
    }
  }
  return [...origins];
}

export async function authorizeOrigin(
  originInput: string,
): Promise<RegisterInstanceResult> {
  try {
    const origin = normalizeOriginInput(originInput);
    const pattern = originToPattern(origin);
    const has = await chrome.permissions.contains({ origins: [pattern] });
    if (!has) {
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) {
        return {
          ok: false,
          error: 'Permissão negada pelo navegador',
          needsPermission: true,
        };
      }
    }
    const stored = await readStoredOrigins();
    if (!stored.includes(origin)) {
      stored.push(origin);
      await saveStoredOrigins(stored);
    }
    return { ok: true, authorized: stored };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function registerInstanceOrigins(
  input: RegisterInstanceInput,
): Promise<RegisterInstanceResult> {
  const origins = collectOrigins(input);
  if (origins.length === 0) {
    return { ok: false, error: 'Informe frontendOrigin, apiOrigin ou apiUrl' };
  }

  let lastAuthorized: string[] = [];
  for (const origin of origins) {
    const result = await authorizeOrigin(origin);
    if (!result.ok) return result;
    if (result.authorized) lastAuthorized = result.authorized;
  }

  return { ok: true, authorized: lastAuthorized };
}

export async function getInstances(): Promise<{
  defaults: string[];
  authorized: string[];
}> {
  return {
    defaults: DEV_APP_HOSTS,
    authorized: await readStoredOrigins(),
  };
}

export async function removeAuthorizedOrigin(
  origin: string,
): Promise<{ ok: boolean; authorized?: string[] }> {
  const stored = (await readStoredOrigins()).filter((o) => o !== origin);
  await saveStoredOrigins(stored);
  try {
    await chrome.permissions.remove({ origins: [originToPattern(origin)] });
  } catch {
    void 0;
  }
  return { ok: true, authorized: stored };
}

export async function injectBridgeIntoTab(tabId: number) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: bridgeInPage,
    });
  } catch {
    void 0;
  }
}

export async function injectBridgeIntoOpenTabs() {
  try {
    const patterns = await getAllHostPatterns();
    const tabs = await chrome.tabs.query({ url: patterns });
    for (const tab of tabs) {
      if (tab.id == null) continue;
      await injectBridgeIntoTab(tab.id);
    }
  } catch {
    void 0;
  }
}

export async function maybeInjectBridge(tabId: number, url: string) {
  if (!(await urlIsAuthorizedAppUrl(url))) return;
  await injectBridgeIntoTab(tabId);
}

export function bridgeInPage() {
  const SOURCE = 'wa-passkey-connector';
  const w = window as unknown as { __waPasskeyConnectorBridge?: boolean };
  if (w.__waPasskeyConnectorBridge) return;
  w.__waPasskeyConnectorBridge = true;

  const announce = () =>
    window.postMessage({ source: SOURCE, type: 'CONNECTOR_READY' }, '*');

  const fromWorker = [
    'EXISTING_SESSION',
    'IMPORT_SENT',
    'IMPORT_ERROR',
    'REGISTER_INSTANCE_RESULT',
  ];

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && typeof msg.type === 'string' && fromWorker.includes(msg.type)) {
      window.postMessage({ source: SOURCE, ...msg }, '*');
    }
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as
      | {
          target?: string;
          type?: string;
          url?: string;
          frontendOrigin?: string;
          apiOrigin?: string;
          apiUrl?: string;
          forcePasskey?: boolean;
        }
      | undefined;
    if (!data || data.target !== SOURCE) return;

    if (data.type === 'PING') announce();

    if (data.type === 'REGISTER_INSTANCE') {
      void chrome.runtime
        .sendMessage({
          type: 'REGISTER_INSTANCE',
          frontendOrigin: data.frontendOrigin ?? window.location.origin,
          apiOrigin: data.apiOrigin,
          apiUrl: data.apiUrl,
        })
        .then((res) => {
          window.postMessage(
            {
              source: SOURCE,
              type: 'REGISTER_INSTANCE_RESULT',
              ...(typeof res === 'object' && res ? res : { ok: false }),
            },
            '*',
          );
        });
    }

    if (data.type === 'START_PASSKEY_IMPORT' && typeof data.url === 'string') {
      void chrome.runtime.sendMessage({
        type: 'START_PASSKEY_IMPORT',
        url: data.url,
        frontendOrigin: data.frontendOrigin ?? window.location.origin,
        apiOrigin: data.apiOrigin,
        forcePasskey: data.forcePasskey === true,
      });
    }

    if (data.type === 'CLEAR_AND_CONTINUE' || data.type === 'CANCEL_IMPORT') {
      void chrome.runtime.sendMessage({ type: data.type });
    }
  });

  announce();
}
