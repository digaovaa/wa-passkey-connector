import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'wa-passkey-connector-theme';

const systemTheme = (): Theme =>
  window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(systemTheme);

  useEffect(() => {
    void chrome.storage?.local.get(STORAGE_KEY).then((res) => {
      const saved = res?.[STORAGE_KEY] as Theme | undefined;
      if (saved) setThemeState(saved);
    });
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setThemeState(next);
    void chrome.storage?.local.set({ [STORAGE_KEY]: next });
  };

  return { theme, toggle };
}
