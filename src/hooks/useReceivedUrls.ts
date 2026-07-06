import { useCallback, useEffect, useState } from 'react';
import {
  RECEIVED_URLS_STORAGE_KEY,
  readReceivedUrls,
  type ReceivedUrlsPayload,
} from '@/lib/received-urls';

export function useReceivedUrls() {
  const [received, setReceived] = useState<ReceivedUrlsPayload | null>(null);

  const refresh = useCallback(async () => {
    setReceived(await readReceivedUrls());
  }, []);

  useEffect(() => {
    void refresh();

    const onStorage = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes[RECEIVED_URLS_STORAGE_KEY]) void refresh();
    };

    chrome.storage?.local.onChanged.addListener(onStorage);
    return () => chrome.storage?.local.onChanged.removeListener(onStorage);
  }, [refresh]);

  return { received, refresh };
}
