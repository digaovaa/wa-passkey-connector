const WA_ORIGIN = 'https://web.whatsapp.com';

// ---------------------------------------------------------------------------
// Origins
// ---------------------------------------------------------------------------
// There is no hard-coded app host anymore. An app origin is "served" when the
// extension holds host permission for it. That permission comes from one of:
//   - static host_permissions (WhatsApp Web + any CONNECTOR_PARENT_HOSTS baked
//     in at build time), or
//   - a runtime grant the owner approved in the popup (arbitrary domains +
//     localhost, via optional_host_permissions).
// The chrome.permissions API is therefore the single source of truth for which
// origins we bridge — no separate storage registry to keep in sync.

/** Turn any page URL into a host match pattern, or null if not http(s). */
function toOriginPattern(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // Match patterns don't carry a port; they match any port on the host.
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

/** A tab URL is served when we hold host permission for it (and it is not WA). */
async function servedPattern(rawUrl: string | undefined): Promise<string | null> {
  const pattern = toOriginPattern(rawUrl);
  if (!pattern) return null;
  if (rawUrl?.startsWith(`${WA_ORIGIN}/`)) return null; // never bridge WhatsApp Web
  const has = await chrome.permissions.contains({ origins: [pattern] }).catch(
    () => false,
  );
  return has ? pattern : null;
}

// ---------------------------------------------------------------------------
// Messaging — content-script bridge path (any authorized origin)
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'RUN_PASSKEY_ASSERTION' && msg.publicKey) {
    void runAssertion(msg.publicKey).then((result) => {
      const originTabId = sender.tab?.id;
      if (originTabId != null) {
        void chrome.tabs
          .sendMessage(originTabId, {
            type: 'PASSKEY_ASSERTION_RESULT',
            requestId: msg.requestId,
            ...result,
          })
          .catch(() => {});
      }
      sendResponse({ ok: Boolean(result.assertion) });
    });
    return true;
  }
  if (msg?.type === 'IS_CONNECTOR_INSTALLED') {
    sendResponse({ installed: true });
    return false;
  }
  return false;
});

// ---------------------------------------------------------------------------
// Messaging — parent-domain path (externally_connectable, zero content script)
// ---------------------------------------------------------------------------
// Active only when CONNECTOR_PARENT_HOSTS was set at build time (otherwise no
// external page is allowed to reach us and these listeners never fire).
// Registro dinâmico de instância: a página passa a própria origem e a extensão
// pede host permission para ela. chrome.permissions.request exige o gesto do
// usuário, propagado pelo sendMessage da página — por isso o registro é só via
// onMessageExternal (sendMessage), não pela porta. Concedida a permissão, a
// origem aparece no popup ("Authorized instances") e o bridge é injetado nas
// abas dessa origem.
async function authorizeOrigin(rawUrl: string | undefined): Promise<{
  ok: boolean;
  needsPermission?: boolean;
  origin?: string;
  error?: string;
}> {
  const pattern = toOriginPattern(rawUrl);
  if (!pattern) return { ok: false, error: 'invalid_origin' };
  let granted = false;
  try {
    // request() é idempotente (sem prompt se já concedida) e deve ser a PRIMEIRA
    // chamada async, para preservar o gesto do usuário.
    granted = await chrome.permissions.request({ origins: [pattern] });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!granted) return { ok: false, needsPermission: true, origin: pattern };
  await sweepOpenTabs();
  return { ok: true, origin: pattern };
}

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'PING' || msg?.type === 'IS_CONNECTOR_INSTALLED') {
    sendResponse({ installed: true, type: 'CONNECTOR_READY' });
    return false;
  }
  if (msg?.type === 'REGISTER_INSTANCE') {
    void authorizeOrigin(msg.origin ?? sender.url).then(sendResponse);
    return true; // resposta assíncrona
  }
  return false;
});

chrome.runtime.onConnectExternal.addListener((port) => {
  port.onMessage.addListener((msg) => {
    if (msg?.type === 'PING') {
      try {
        port.postMessage({ type: 'CONNECTOR_READY' });
      } catch {}
      return;
    }
    if (msg?.type === 'RUN_PASSKEY_ASSERTION' && msg.publicKey) {
      void runAssertion(msg.publicKey).then((result) => {
        try {
          port.postMessage({
            type: 'PASSKEY_ASSERTION_RESULT',
            requestId: msg.requestId,
            ...result,
          });
        } catch {}
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Bridge injection into authorized tabs
// ---------------------------------------------------------------------------
async function injectBridge(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: bridgeInPage });
  } catch {}
}

async function injectIfServed(
  tabId: number,
  url: string | undefined,
): Promise<void> {
  if (await servedPattern(url)) await injectBridge(tabId);
}

/** Re-attach the bridge to every already-open authorized tab. */
async function sweepOpenTabs(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      if (tab.id != null) void injectIfServed(tab.id, tab.url);
    }
  } catch {}
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') void injectIfServed(tabId, tab.url);
});

chrome.runtime.onInstalled.addListener(() => void sweepOpenTabs());
chrome.runtime.onStartup.addListener(() => void sweepOpenTabs());

// The popup grants a new origin (permissions.request under the user's click);
// inject into its already-open tabs right away so no reload is needed.
chrome.permissions.onAdded.addListener((perms) => {
  if (perms.origins?.length) void sweepOpenTabs();
});

// ---------------------------------------------------------------------------
// Assertion core — open WhatsApp Web, run navigator.credentials.get in MAIN
// world, return the result. Delivery (tab message vs port) is the caller's job.
// ---------------------------------------------------------------------------
async function runAssertion(
  publicKey: unknown,
): Promise<{ assertion?: unknown; error?: string }> {
  let tabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url: `${WA_ORIGIN}/`, active: true });
    tabId = tab.id;
    if (tabId == null) return { error: 'tab_open_failed' };
    await waitForTabComplete(tabId);
    const [inj] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: runPasskeyAssertionInPage,
      args: [publicKey as Parameters<typeof runPasskeyAssertionInPage>[0]],
    });
    const result = inj?.result as
      | { assertion?: unknown; error?: string }
      | undefined;
    if (result?.assertion) return { assertion: result.assertion };
    return { error: result?.error || 'assertion_failed' };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'assertion_exception',
    };
  } finally {
    if (tabId != null) void chrome.tabs.remove(tabId).catch(() => {});
  }
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (
      id: number,
      info: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (
        id === tabId &&
        info.status === 'complete' &&
        tab.url?.startsWith(`${WA_ORIGIN}/`)
      ) {
        done();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    void chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete' && tab.url?.startsWith(`${WA_ORIGIN}/`)) {
          done();
        }
      })
      .catch(() => {});
  });
}

function runPasskeyAssertionInPage(
  inputPublicKey: {
    challenge: string;
    timeout?: number;
    rpId: string;
    allowCredentials?: Array<{
      id: string;
      type: string;
      transports?: string[];
    }>;
    userVerification?: string;
    extensions?: Record<string, unknown>;
  },
): Promise<{ assertion?: unknown; error?: string }> {
  function base64UrlToBuffer(value: string): ArrayBuffer {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      Math.ceil(normalized.length / 4) * 4,
      '=',
    );
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  function bufferToBase64Url(value: ArrayBuffer): string {
    const bytes = new Uint8Array(value);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }
  async function run(): Promise<unknown> {
    const publicKeyOptions: PublicKeyCredentialRequestOptions = {
      challenge: base64UrlToBuffer(inputPublicKey.challenge),
      timeout: inputPublicKey.timeout,
      rpId: inputPublicKey.rpId,
      allowCredentials: (inputPublicKey.allowCredentials || []).map(
        (credential) => ({
          id: base64UrlToBuffer(credential.id),
          type: 'public-key' as const,
          transports: credential.transports as AuthenticatorTransport[],
        }),
      ),
      userVerification:
        inputPublicKey.userVerification as UserVerificationRequirement,
      extensions: inputPublicKey.extensions as AuthenticationExtensionsClientInputs,
    };

    const credential = (await navigator.credentials.get({
      publicKey: publicKeyOptions,
    })) as (PublicKeyCredential & { toJSON?: () => unknown }) | null;
    if (!credential || credential.type !== 'public-key') {
      throw new Error('Passkey assertion was not completed');
    }
    if (typeof credential.toJSON === 'function') {
      return credential.toJSON();
    }
    const response = credential.response as AuthenticatorAssertionResponse;
    return {
      id: credential.id,
      rawId: bufferToBase64Url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: bufferToBase64Url(response.clientDataJSON),
        authenticatorData: bufferToBase64Url(response.authenticatorData),
        signature: bufferToBase64Url(response.signature),
        userHandle: response.userHandle
          ? bufferToBase64Url(response.userHandle)
          : null,
      },
    };
  }
  return run()
    .then((assertion) => ({ assertion }))
    .catch((error) => ({
      error: error && error.message ? error.message : String(error),
    }));
}

// Injected into authorized app pages. Bridges window.postMessage <-> worker.
// This is the single source of the bridge (there is no static content script).
function bridgeInPage() {
  const SOURCE = 'wa-passkey-connector';
  const w = window as unknown as { __waPasskeyConnectorBridge?: boolean };
  if (w.__waPasskeyConnectorBridge) return;
  w.__waPasskeyConnectorBridge = true;

  const announce = () =>
    window.postMessage({ source: SOURCE, type: 'CONNECTOR_READY' }, '*');

  const fromWorker = ['PASSKEY_ASSERTION_RESULT'];
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
          requestId?: string;
          publicKey?: unknown;
        }
      | undefined;
    if (!data || data.target !== SOURCE) return;
    if (data.type === 'PING') announce();
    if (data.type === 'RUN_PASSKEY_ASSERTION' && data.publicKey) {
      void chrome.runtime.sendMessage({
        type: 'RUN_PASSKEY_ASSERTION',
        requestId: data.requestId,
        publicKey: data.publicKey,
      });
    }
  });

  announce();
}
