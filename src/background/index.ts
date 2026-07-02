interface Pending {
  url: string;
  tabId?: number;
  originTabId?: number;
  attempts: number;
  awaitingConsent?: boolean;
  consented?: boolean;
  noiseFails?: number;
}

const MAX_POLLS = 120;
const WA_ORIGIN = 'https://web.whatsapp.com';
const APP_HOST_PATTERNS = ['https://your-app.example.com/*'];

let pending: Pending | null = null;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let pendingConfirmJid: string | undefined;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'START_PASSKEY_IMPORT' && typeof msg.url === 'string') {
    void startImport(msg.url, sender.tab?.id).then(sendResponse);
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
  if (msg?.type === 'IS_CONNECTOR_INSTALLED') {
    sendResponse({ installed: true });
    return false;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  void injectBridgeIntoOpenTabs();
});

async function injectBridgeIntoOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: APP_HOST_PATTERNS });
    for (const tab of tabs) {
      if (tab.id == null) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: bridgeInPage,
        });
      } catch {
        void 0;
      }
    }
  } catch {
    void 0;
  }
}

async function startImport(
  url: string,
  originTabId?: number,
): Promise<{ ok: boolean }> {
  stopPoll();
  const tab = await chrome.tabs.create({ url: `${WA_ORIGIN}/`, active: false });
  pending = { url, tabId: tab.id, originTabId, attempts: 0 };
  return { ok: true };
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
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
  await activateAndForce(tabId);
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

async function activateAndForce(tabId: number) {
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    void 0;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: forcePasskeyModeInPage,
    });
  } catch {
    void 0;
  }
  startPoll(tabId);
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

function notifyOrigin(type: string, extra: Record<string, unknown> = {}) {
  const originTabId = pending?.originTabId;
  if (originTabId == null) return;
  void chrome.tabs.sendMessage(originTabId, { type, ...extra }).catch(() => {});
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

function bridgeInPage() {
  const SOURCE = 'wa-passkey-connector';
  const w = window as unknown as { __waPasskeyConnectorBridge?: boolean };
  if (w.__waPasskeyConnectorBridge) return;
  w.__waPasskeyConnectorBridge = true;

  const announce = () =>
    window.postMessage({ source: SOURCE, type: 'CONNECTOR_READY' }, '*');

  const fromWorker = ['EXISTING_SESSION', 'IMPORT_SENT', 'IMPORT_ERROR'];
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && typeof msg.type === 'string' && fromWorker.includes(msg.type)) {
      window.postMessage({ source: SOURCE, ...msg }, '*');
    }
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as
      | { target?: string; type?: string; url?: string }
      | undefined;
    if (!data || data.target !== SOURCE) return;
    if (data.type === 'PING') announce();
    if (data.type === 'START_PASSKEY_IMPORT' && typeof data.url === 'string') {
      void chrome.runtime.sendMessage({
        type: 'START_PASSKEY_IMPORT',
        url: data.url,
      });
    }
    if (data.type === 'CLEAR_AND_CONTINUE' || data.type === 'CANCEL_IMPORT') {
      void chrome.runtime.sendMessage({ type: data.type });
    }
  });

  announce();
}
