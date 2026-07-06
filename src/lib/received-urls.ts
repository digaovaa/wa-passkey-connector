export const RECEIVED_URLS_STORAGE_KEY = 'connector_received_urls';

export interface ReceivedUrlsPayload {
  frontendOrigin?: string;
  apiOrigin?: string;
  apiUrl?: string;
  senderUrl?: string;
  receivedAt: number;
}

export async function saveReceivedUrls(
  input: Omit<ReceivedUrlsPayload, 'receivedAt'>,
): Promise<ReceivedUrlsPayload> {
  const payload: ReceivedUrlsPayload = {
    ...input,
    receivedAt: Date.now(),
  };
  if (!chrome.storage?.local) return payload;
  await chrome.storage.local.set({ [RECEIVED_URLS_STORAGE_KEY]: payload });
  return payload;
}

export async function readReceivedUrls(): Promise<ReceivedUrlsPayload | null> {
  if (!chrome.storage?.local) return null;
  const data = await chrome.storage.local.get(RECEIVED_URLS_STORAGE_KEY);
  const stored = data[RECEIVED_URLS_STORAGE_KEY] as ReceivedUrlsPayload | undefined;
  return stored ?? null;
}
