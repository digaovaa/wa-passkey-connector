import { useCallback, useEffect, useState } from 'react';

type InstancesState = {
  defaults: string[];
  authorized: string[];
};

export function useInstances() {
  const [instances, setInstances] = useState<InstancesState>({
    defaults: [],
    authorized: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!chrome.runtime?.sendMessage) return;
    try {
      const data = (await chrome.runtime.sendMessage({
        type: 'GET_INSTANCES',
      })) as InstancesState;
      if (data) setInstances(data);
    } catch {
      void 0;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const authorize = async (originInput: string) => {
    if (!chrome.runtime?.sendMessage) {
      setError('Disponível apenas na extensão instalada');
      return false;
    }
    setLoading(true);
    setError(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'AUTHORIZE_INSTANCE',
        origin: originInput,
      })) as { ok: boolean; error?: string; authorized?: string[] };
      if (!res?.ok) {
        setError(res?.error || 'Falha ao autorizar');
        return false;
      }
      if (res.authorized) {
        setInstances((prev) => ({ ...prev, authorized: res.authorized! }));
      } else {
        await refresh();
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setLoading(false);
    }
  };

  const remove = async (origin: string) => {
    if (!chrome.runtime?.sendMessage) return;
    setLoading(true);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'REMOVE_INSTANCE',
        origin,
      })) as { ok: boolean; authorized?: string[] };
      if (res?.authorized) {
        setInstances((prev) => ({ ...prev, authorized: res.authorized! }));
      }
    } finally {
      setLoading(false);
    }
  };

  return { instances, loading, error, authorize, remove, refresh, setError };
}
