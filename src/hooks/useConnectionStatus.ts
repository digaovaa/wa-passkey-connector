import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_STATUS,
  STATUS_CHANGED_MESSAGE,
  STATUS_STORAGE_KEY,
  type ConnectionStatus,
} from '@/lib/connection-status';

export function useConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus>(DEFAULT_STATUS);

  const refresh = useCallback(async () => {
    if (!chrome.storage?.local) return;
    const data = await chrome.storage.local.get(STATUS_STORAGE_KEY);
    const stored = data[STATUS_STORAGE_KEY] as ConnectionStatus | undefined;
    if (stored) setStatus(stored);
  }, []);

  useEffect(() => {
    void refresh();

    const onStorage = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (!changes[STATUS_STORAGE_KEY]) return;
      const next = changes[STATUS_STORAGE_KEY].newValue as ConnectionStatus;
      if (next) setStatus(next);
    };

    const onMessage = (msg: ConnectionStatus & { type?: string }) => {
      if (msg?.type === STATUS_CHANGED_MESSAGE) {
        setStatus({
          phase: msg.phase,
          message: msg.message,
          updatedAt: msg.updatedAt,
          requestId: msg.requestId,
          error: msg.error,
          failedAt: msg.failedAt,
        });
      }
    };

    chrome.storage?.local.onChanged.addListener(onStorage);
    chrome.runtime?.onMessage.addListener(onMessage);
    return () => {
      chrome.storage?.local.onChanged.removeListener(onStorage);
      chrome.runtime?.onMessage.removeListener(onMessage);
    };
  }, [refresh]);

  const isActive =
    status.phase !== 'idle' &&
    status.phase !== 'success' &&
    status.phase !== 'error';

  return { status, isActive, refresh };
}
