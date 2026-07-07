import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  ExternalLink,
  Globe,
  Moon,
  ShieldCheck,
  Sun,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';

/** Page URL -> host match pattern (any port), or null if not http(s). */
function toPattern(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

const prettyHost = (pattern: string) =>
  pattern.replace(/^https?:\/\//, '').replace(/\/\*$/, '');

const VERSION = chrome.runtime.getManifest().version;

interface State {
  current: { url: string; pattern: string } | null;
  currentAuthorized: boolean;
  currentIsStatic: boolean;
  userOrigins: string[];
}

const EMPTY: State = {
  current: null,
  currentAuthorized: false,
  currentIsStatic: false,
  userOrigins: [],
};

export default function App() {
  const { theme, toggle } = useTheme();
  const [state, setState] = useState<State>(EMPTY);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const pattern = toPattern(tab?.url);

    const manifest = chrome.runtime.getManifest() as chrome.runtime.ManifestV3;
    const staticOrigins = new Set(manifest.host_permissions ?? []);
    const granted = await chrome.permissions.getAll();
    const userOrigins = (granted.origins ?? [])
      .filter((origin) => !staticOrigins.has(origin))
      .sort();

    const currentAuthorized = pattern
      ? await chrome.permissions.contains({ origins: [pattern] })
      : false;

    setState({
      current: pattern && tab?.url ? { url: tab.url, pattern } : null,
      currentAuthorized,
      currentIsStatic:
        currentAuthorized && pattern != null && !userOrigins.includes(pattern),
      userOrigins,
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const authorize = async () => {
    if (!state.current) return;
    setBusy(true);
    try {
      // Must run under this click (Chrome requires a user gesture).
      const ok = await chrome.permissions.request({
        origins: [state.current.pattern],
      });
      if (ok) await refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (pattern: string) => {
    setBusy(true);
    try {
      await chrome.permissions.remove({ origins: [pattern] });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const { current, currentAuthorized, currentIsStatic, userOrigins } = state;

  return (
    <div className="flex w-80 flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <img
            src="/logo.jpg"
            alt="Central Connect"
            className="h-7 w-7 rounded-md object-cover"
          />
          <span className="text-sm font-semibold">Central Connect</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            v{VERSION}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label="Toggle theme"
          className="h-8 w-8"
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>
      </header>

      {/* Current instance */}
      <div className="flex flex-col gap-2 border-b px-4 py-4">
        <p className="text-xs font-medium text-muted-foreground">This instance</p>

        {!current && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Open your app instance in a tab, then reopen this popup to authorize
            it.
          </p>
        )}

        {current && currentIsStatic && (
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs">
            <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
            <span>
              <span className="font-medium">{prettyHost(current.pattern)}</span>{' '}
              is enabled for every instance of this domain (configured at build
              time).
            </span>
          </div>
        )}

        {current && !currentIsStatic && currentAuthorized && (
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs">
            <Check className="h-4 w-4 shrink-0 text-primary" />
            <span>
              <span className="font-medium">{prettyHost(current.pattern)}</span>{' '}
              is authorized. Your app can drive the passkey flow here.
            </span>
          </div>
        )}

        {current && !currentAuthorized && (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Globe className="h-4 w-4 shrink-0" />
              <span className="truncate font-medium text-foreground">
                {prettyHost(current.pattern)}
              </span>
            </div>
            <Button size="sm" onClick={authorize} disabled={busy}>
              Authorize this instance
            </Button>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Chrome will ask permission to run on this site. Only then can your
              app talk to the connector.
            </p>
          </>
        )}
      </div>

      {/* Authorized list */}
      <div className="flex flex-col gap-2 px-4 py-4">
        <p className="text-xs font-medium text-muted-foreground">
          Authorized instances
        </p>
        {userOrigins.length === 0 ? (
          <p className="text-xs text-muted-foreground">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {userOrigins.map((origin) => (
              <li
                key={origin}
                className="flex items-center justify-between gap-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs"
              >
                <span className="truncate" title={origin}>
                  {prettyHost(origin)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(origin)}
                  disabled={busy}
                  aria-label={`Remove ${prettyHost(origin)}`}
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <a
          href="https://web.whatsapp.com"
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          Open WhatsApp Web
        </a>
      </div>
    </div>
  );
}
