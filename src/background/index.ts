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

const WA_ORIGIN = 'https://web.whatsapp.com';

function handleMessage(
  msg: RegisterInstanceInput & {
    type?: string;
    origin?: string;
    frontendOrigin?: string;
    apiOrigin?: string;
    requestId?: string;
    publicKey?: unknown;
  },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): boolean {
  const tabId = sender.tab?.id;

  if (msg?.type === 'REGISTER_INSTANCE') {
    void handleRegisterInstance(
      {
        frontendOrigin: msg.frontendOrigin ?? sender.url ?? undefined,
        apiOrigin: msg.apiOrigin,
        apiUrl: msg.apiUrl,
      },
      tabId,
    ).then(sendResponse);
    return true;
  }

  if (msg?.type === 'RUN_PASSKEY_ASSERTION' && msg.publicKey) {
    void handlePasskeyAssertion(msg.publicKey, tabId, msg.requestId).then(
      sendResponse,
    );
    return true;
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
  if (area === 'local' && changes.togitalk_authorized_hosts) {
    void injectBridgeIntoOpenTabs();
  }
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url) {
    void maybeInjectBridge(tabId, tab.url);
  }
});

async function handleRegisterInstance(
  input: RegisterInstanceInput,
  tabId?: number,
) {
  const result = await registerInstanceOrigins(input);
  if (result.ok) {
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

function notifyTab(tabId: number, type: string, extra: Record<string, unknown> = {}) {
  void chrome.tabs.sendMessage(tabId, { type, ...extra }).catch(() => {});
}

async function handlePasskeyAssertion(
  publicKey: unknown,
  originTabId: number | undefined,
  requestId: string | undefined,
): Promise<{ ok: boolean }> {
  const reply = (payload: Record<string, unknown>) => {
    if (originTabId == null) return;
    notifyTab(originTabId, 'PASSKEY_ASSERTION_RESULT', {
      requestId,
      ...payload,
    });
  };

  let tabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url: `${WA_ORIGIN}/`, active: true });
    tabId = tab.id;
    if (tabId == null) {
      reply({ error: 'tab_open_failed' });
      return { ok: false };
    }
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
    if (result?.assertion) {
      reply({ assertion: result.assertion });
    } else {
      reply({ error: result?.error || 'assertion_failed' });
    }
    return { ok: true };
  } catch (error) {
    reply({
      error: error instanceof Error ? error.message : 'assertion_exception',
    });
    return { ok: false };
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
      extensions:
        inputPublicKey.extensions as AuthenticationExtensionsClientInputs,
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
