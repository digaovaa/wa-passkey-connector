import {
  authorizeOrigin,
  getInstances,
  injectBridgeIntoOpenTabs,
  injectBridgeIntoTab,
  maybeInjectBridge,
  registerInstanceOrigins,
  removeAuthorizedOrigin,
  type RegisterInstanceInput,
} from '@/lib/connector';
import { STORAGE_KEY_AUTHORIZED } from '@/config/app-hosts';
import { saveReceivedUrls } from '@/lib/received-urls';

function originFromSender(sender: chrome.runtime.MessageSender): string | undefined {
  if (!sender.url) return undefined;
  try {
    return new URL(sender.url).origin;
  } catch {
    return undefined;
  }
}

interface Pending {
  url: string;
  tabId?: number;
  originTabId?: number;
  attempts: number;
  awaitingConsent?: boolean;
  consented?: boolean;
  noiseFails?: number;
  /** Quando true, força SHORTCAKE_PASSKEY no WA Web. Default false = QR / telefone (fluxo Ticketz). */
  forcePasskey?: boolean;
}

const MAX_POLLS = 120;
const WA_ORIGIN = 'https://web.whatsapp.com';

let pending: Pending | null = null;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let pendingConfirmJid: string | undefined;

function handleMessage(
  msg: RegisterInstanceInput & {
    type?: string;
    url?: string;
    origin?: string;
    frontendOrigin?: string;
    apiOrigin?: string;
    forcePasskey?: boolean;
  },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): boolean {
  const tabId = sender.tab?.id;

  if (msg?.type === 'REGISTER_INSTANCE') {
    void handleRegisterInstance(
      {
        frontendOrigin: msg.frontendOrigin ?? originFromSender(sender) ?? undefined,
        apiOrigin: msg.apiOrigin,
        apiUrl: msg.apiUrl,
      },
      tabId,
      sender.url,
    ).then(sendResponse);
    return true;
  }

  if (msg?.type === 'START_PASSKEY_IMPORT' && typeof msg.url === 'string') {
    void startImport(msg.url, tabId, {
      frontendOrigin: msg.frontendOrigin ?? originFromSender(sender) ?? undefined,
      apiOrigin: msg.apiOrigin,
      forcePasskey: msg.forcePasskey === true,
    }, sender.url).then(sendResponse);
    return true;
  }

  if (msg?.type === 'CLEAR_AND_CONTINUE') {
    void clearAndContinue().then(sendResponse);
    return true;
  }

  if (msg?.type === 'CANCEL_IMPORT') {
    cancelImport();
    sendResponse({ ok: true });
    return false;
  }

  if (msg?.type === 'IS_CONNECTOR_INSTALLED' || msg?.type === 'PING') {
    sendResponse({ installed: true, ok: true });
    return false;
  }

  if (msg?.type === 'GET_INSTANCES') {
    void getInstances().then(sendResponse);
    return true;
  }

  if (msg?.type === 'AUTHORIZE_INSTANCE' && typeof msg.origin === 'string') {
    void authorizeOrigin(msg.origin).then((result) => {
      if (result.ok) void injectBridgeIntoOpenTabs();
      sendResponse(result);
    });
    return true;
  }

  if (msg?.type === 'REMOVE_INSTANCE' && typeof msg.origin === 'string') {
    void removeAuthorizedOrigin(msg.origin).then(sendResponse);
    return true;
  }

  return false;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) =>
  handleMessage(msg, sender, sendResponse),
);

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) =>
  handleMessage(msg, sender, sendResponse),
);

chrome.runtime.onInstalled.addListener(() => {
  void injectBridgeIntoOpenTabs();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY_AUTHORIZED]) {
    void injectBridgeIntoOpenTabs();
  }
});

async function handleRegisterInstance(
  input: RegisterInstanceInput,
  tabId?: number,
  senderUrl?: string,
) {
  const result = await registerInstanceOrigins(input);
  if (result.ok) {
    await saveReceivedUrls({
      frontendOrigin: input.frontendOrigin,
      apiOrigin: input.apiOrigin,
      apiUrl: input.apiUrl,
      senderUrl,
    });
    if (tabId != null) {
      await injectBridgeIntoTab(tabId);
    } else {
      await injectBridgeIntoOpenTabs();
    }
  }
  if (tabId != null && result.ok) {
    notifyTab(tabId, 'REGISTER_INSTANCE_RESULT', result);
  }
  return result;
}

async function startImport(
  url: string,
  originTabId?: number,
  origins?: { frontendOrigin?: string; apiOrigin?: string; forcePasskey?: boolean },
  senderUrl?: string,
): Promise<{ ok: boolean; error?: string; needsPermission?: boolean }> {
  const reg = await registerInstanceOrigins({
    apiUrl: url,
    frontendOrigin: origins?.frontendOrigin,
    apiOrigin: origins?.apiOrigin,
  });
  if (!reg.ok) return reg;

  await saveReceivedUrls({
    frontendOrigin: origins?.frontendOrigin,
    apiOrigin: origins?.apiOrigin,
    apiUrl: url,
    senderUrl,
  });

  if (originTabId != null) {
    await injectBridgeIntoTab(originTabId);
  }

  stopPoll();
  pendingConfirmJid = undefined;

  await closeExistingWaTabs();
  await wipeWhatsAppData();

  const tab = await chrome.tabs.create({ url: `${WA_ORIGIN}/`, active: true });
  pending = {
    url,
    tabId: tab.id,
    originTabId,
    attempts: 0,
    forcePasskey: origins?.forcePasskey === true,
  };
  return { ok: true };
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url) {
    void maybeInjectBridge(tabId, tab.url);
  }
  if (!pending || pending.tabId !== tabId) return;
  if (info.status === 'complete' && tab.url?.startsWith(`${WA_ORIGIN}/`)) {
    void onReady(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (pending?.tabId === tabId) {
    pending = null;
    stopPoll();
  }
});

async function onReady(tabId: number) {
  if (!pending) return;
  if (!pending.consented) {
    const existingNumber = await readExistingWid(tabId);
    if (existingNumber) {
      pending.awaitingConsent = true;
      notifyOrigin('EXISTING_SESSION', { number: existingNumber });
      return;
    }
  }
  await activateTab(tabId);
}

async function readExistingWid(tabId: number): Promise<string> {
  try {
    const [inj] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          const raw = JSON.parse(localStorage.getItem('last-wid-md') || '""');
          if (!raw || typeof raw !== 'string') return '';
          return raw.split(/[.:@]/)[0] || '';
        } catch {
          return '';
        }
      },
    });
    return (inj?.result as string) || '';
  } catch {
    return '';
  }
}

async function activateTab(tabId: number) {
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    void 0;
  }
  if (pending?.forcePasskey) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: forcePasskeyModeInPage,
      });
    } catch {
      void 0;
    }
  }
  startPoll(tabId);
}

async function closeExistingWaTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: `${WA_ORIGIN}/*` });
    await Promise.all(
      tabs.map((tab) => (tab.id != null ? chrome.tabs.remove(tab.id).catch(() => {}) : undefined)),
    );
  } catch {
    void 0;
  }
}

async function wipeWhatsAppData() {
  try {
    await chrome.browsingData.remove(
      { origins: [WA_ORIGIN] },
      {
        cacheStorage: true,
        cookies: true,
        fileSystems: true,
        indexedDB: true,
        localStorage: true,
        serviceWorkers: true,
        webSQL: true,
      },
    );
  } catch {
    void 0;
  }
}

async function clearAndContinue(): Promise<{ ok: boolean }> {
  if (!pending || pending.tabId == null) return { ok: false };
  pending.consented = true;
  pending.awaitingConsent = false;
  await wipeWhatsAppData();
  try {
    await chrome.tabs.reload(pending.tabId);
  } catch {
    void 0;
  }
  return { ok: true };
}

function cancelImport() {
  const tabId = pending?.tabId;
  pending = null;
  stopPoll();
  if (tabId != null) {
    void chrome.tabs.remove(tabId).catch(() => {});
  }
}

function notifyTab(tabId: number, type: string, extra: Record<string, unknown> = {}) {
  void chrome.tabs.sendMessage(tabId, { type, ...extra }).catch(() => {});
}

function notifyOrigin(type: string, extra: Record<string, unknown> = {}) {
  const originTabId = pending?.originTabId;
  if (originTabId == null) return;
  notifyTab(originTabId, type, extra);
}

function startPoll(tabId: number) {
  stopPoll();
  pollTimer = setInterval(() => void tick(tabId), 2500);
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

async function tick(tabId: number) {
  if (!pending) {
    stopPoll();
    return;
  }
  pending.attempts += 1;
  if (pending.attempts > MAX_POLLS) {
    console.warn('[connector] pairing not completed in time; giving up');
    notifyOrigin('IMPORT_ERROR', { reason: 'timeout' });
    stopPoll();
    pending = null;
    return;
  }

  let wid = '';
  try {
    const [inj] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          return JSON.parse(localStorage.getItem('last-wid-md') || '""');
        } catch {
          return '';
        }
      },
    });
    wid = (inj?.result as string) || '';
  } catch {
    return;
  }
  if (!wid) return;

  let dump: WebSessionDump | null | undefined;
  try {
    const [inj] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () =>
        (
          window as unknown as {
            __waWebSessionDump?: () => Promise<unknown>;
          }
        ).__waWebSessionDump?.(),
    });
    dump = inj?.result as WebSessionDump | null | undefined;
  } catch {
    return;
  }

  const dev = dump?.device;
  if (dev?.meJid && !dev.noiseKey) {
    pending.noiseFails = (pending.noiseFails ?? 0) + 1;
    if (pending.noiseFails >= 4) {
      console.warn('[connector] noise key unobtainable on this wa-web build');
      notifyOrigin('IMPORT_ERROR', { reason: 'noise_key_unavailable' });
      stopPoll();
      pending = null;
      return;
    }
  }

  if (!isCompleteDump(dump)) return;

  const jid = dump.device.meJid as string;
  if (pendingConfirmJid !== jid) {
    pendingConfirmJid = jid;
    return;
  }

  stopPoll();
  await postDump(tabId, dump);
}

interface WebSessionDump {
  device: {
    noiseKey?: unknown;
    identityKey?: unknown;
    account?: unknown;
    meJid?: unknown;
  };
}

function isCompleteDump(
  dump: WebSessionDump | null | undefined,
): dump is WebSessionDump {
  const d = dump?.device;
  return !!(d && d.noiseKey && d.identityKey && d.account && d.meJid);
}

async function postDump(tabId: number, dump: WebSessionDump) {
  const url = pending?.url;
  if (!url) return;

  const perm = await registerInstanceOrigins({ apiUrl: url });
  if (!perm.ok) {
    notifyOrigin('IMPORT_ERROR', {
      reason: perm.needsPermission ? 'permission_denied' : 'network',
      error: perm.error,
    });
    pending = null;
    pendingConfirmJid = undefined;
    return;
  }

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dump),
    });
    if (resp.ok) {
      console.log('[connector] paired session dumped and sent');
      notifyOrigin('IMPORT_SENT');
      await wipeWhatsAppData();
      pending = null;
      pendingConfirmJid = undefined;
      await chrome.tabs.remove(tabId);
    } else {
      console.warn('[connector] dump POST failed', resp.status);
      notifyOrigin('IMPORT_ERROR', { reason: `HTTP ${resp.status}` });
      pending = null;
      pendingConfirmJid = undefined;
    }
  } catch (e) {
    console.warn('[connector] dump POST error', e);
    notifyOrigin('IMPORT_ERROR', { reason: 'network' });
    pending = null;
    pendingConfirmJid = undefined;
  }
}

function forcePasskeyModeInPage() {
  type W = {
    requireLazy?: (deps: string[], cb: (...m: unknown[]) => void) => void;
    __waPasskeyForced?: boolean;
  };
  const w = window as unknown as W;

  const attempt = (tries: number) => {
    try {
      if (typeof w.requireLazy === 'function') {
        w.requireLazy(
          [
            'WAWebLinkDeviceEvents',
            'WAWebAltDeviceLinkingApi',
            'WAWebPairingType',
          ],
          (Events: unknown, AltApi: unknown, PairingType: unknown) => {
            try {
              const alt = AltApi as { setPairingType: (t: unknown) => void };
              const pt = PairingType as {
                PairingType: { SHORTCAKE_PASSKEY: unknown };
              };
              const ev = Events as {
                WAWebLinkDeviceEvents: {
                  triggerPasskeyPrologueRequest: () => void;
                };
              };
              alt.setPairingType(pt.PairingType.SHORTCAKE_PASSKEY);
              ev.WAWebLinkDeviceEvents.triggerPasskeyPrologueRequest();
              w.__waPasskeyForced = true;
            } catch {
              void 0;
            }
          },
        );
      }
    } catch {
      void 0;
    }
    if (!w.__waPasskeyForced && tries < 40) {
      setTimeout(() => attempt(tries + 1), 500);
    }
  };

  attempt(0);
}
