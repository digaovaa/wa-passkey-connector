import {
  DEFAULT_STATUS,
  STATUS_CHANGED_MESSAGE,
  STATUS_STORAGE_KEY,
  type ConnectionPhase,
  type ConnectionStatus,
  statusMessage,
} from '@/lib/connection-status';

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const data = await chrome.storage.local.get(STATUS_STORAGE_KEY);
  const stored = data[STATUS_STORAGE_KEY] as ConnectionStatus | undefined;
  return stored ?? DEFAULT_STATUS;
}

async function openExtensionPopup(): Promise<void> {
  if (!chrome.action?.openPopup) return;
  try {
    await chrome.action.openPopup();
  } catch {
    // Pode falhar se não houver gesto recente do usuário (limitação do Chrome).
  }
}

export async function setConnectionStatus(
  phase: ConnectionPhase,
  extra: Partial<ConnectionStatus> = {},
): Promise<ConnectionStatus> {
  const status: ConnectionStatus = {
    ...DEFAULT_STATUS,
    phase,
    message: extra.message ?? statusMessage(phase, extra.error),
    updatedAt: Date.now(),
    ...extra,
  };

  await chrome.storage.local.set({ [STATUS_STORAGE_KEY]: status });
  broadcastStatus(status);
  updateBadge(status);

  if (phase === 'connecting') {
    await openExtensionPopup();
  }

  if (phase === 'success') {
    setTimeout(() => void resetConnectionStatus(), 4000);
  } else if (phase === 'error') {
    setTimeout(() => void resetConnectionStatus(), 8000);
  }

  return status;
}

function broadcastStatus(status: ConnectionStatus) {
  void chrome.runtime.sendMessage({ type: STATUS_CHANGED_MESSAGE, ...status }).catch(
    () => {},
  );
}

function updateBadge(status: ConnectionStatus) {
  if (status.phase === 'idle') {
    void chrome.action.setBadgeText({ text: '' });
    return;
  }
  if (status.phase === 'success') {
    void chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    void chrome.action.setBadgeText({ text: 'OK' });
    return;
  }
  if (status.phase === 'error') {
    void chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    void chrome.action.setBadgeText({ text: '!' });
    return;
  }
  void chrome.action.setBadgeBackgroundColor({ color: '#5B8DEF' });
  void chrome.action.setBadgeText({ text: '…' });
}

export async function resetConnectionStatus(): Promise<void> {
  await chrome.storage.local.set({ [STATUS_STORAGE_KEY]: DEFAULT_STATUS });
  broadcastStatus(DEFAULT_STATUS);
  void chrome.action.setBadgeText({ text: '' });
}
