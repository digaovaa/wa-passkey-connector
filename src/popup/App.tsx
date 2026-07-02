import { ExternalLink, Fingerprint, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';

export default function App() {
  const { theme, toggle } = useTheme();

  return (
    <div className="flex flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Fingerprint className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold">WA Passkey Connector</span>
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

      <div className="flex flex-col items-center gap-2 bg-muted/40 px-4 py-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Fingerprint className="h-7 w-7" />
        </div>
        <p className="text-sm font-medium">Connector active</p>
        <p className="text-xs text-muted-foreground">
          Nothing to do here. This connector is driven automatically by your app
          during passkey authentication.
        </p>
      </div>

      <div className="space-y-3 px-4 py-4">
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          In your app, open the passkey-locked connection and start the passkey
          resolution flow.
        </p>
        <a
          href="https://web.whatsapp.com"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          Open WhatsApp Web
        </a>
      </div>
    </div>
  );
}
