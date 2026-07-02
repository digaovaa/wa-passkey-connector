const SOURCE = 'wa-passkey-connector';
const FROM_WORKER = ['EXISTING_SESSION', 'IMPORT_SENT', 'IMPORT_ERROR'];

const guard = window as unknown as { __waPasskeyConnectorBridge?: boolean };
if (!guard.__waPasskeyConnectorBridge) {
  guard.__waPasskeyConnectorBridge = true;

  const announce = () => {
    window.postMessage({ source: SOURCE, type: 'CONNECTOR_READY' }, '*');
  };

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && typeof msg.type === 'string' && FROM_WORKER.includes(msg.type)) {
      window.postMessage({ source: SOURCE, ...msg }, '*');
    }
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as
      | { target?: string; type?: string; url?: string }
      | undefined;
    if (!data || data.target !== SOURCE) return;

    if (data.type === 'PING') {
      announce();
    }
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
