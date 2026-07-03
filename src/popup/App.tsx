import { useState } from 'react';
import { ExternalLink, Globe, Moon, Plus, Sun, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useInstances } from '@/hooks/useInstances';
import { useTheme } from '@/hooks/useTheme';

const logoUrl = '/togipasskey.png';

export default function App() {
  const { theme, toggle } = useTheme();
  const { instances, loading, error, authorize, remove, setError } =
    useInstances();
  const [urlInput, setUrlInput] = useState('');

  const handleAuthorize = async () => {
    const ok = await authorize(urlInput);
    if (ok) setUrlInput('');
  };

  return (
    <div className="flex min-h-0 flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-3">
          <img
            src={logoUrl}
            alt="TOGI Talk"
            className="h-10 w-10 rounded-lg object-cover"
          />
          <div>
            <p className="text-sm font-medium text-foreground">
              TOGI Talk Connector
            </p>
            <p className="text-[11px] text-muted-foreground">Passkey</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label="Alternar tema"
          className="h-8 w-8 text-muted-foreground"
        >
          {theme === 'dark' ? (
            <Sun className="h-3.5 w-3.5" />
          ) : (
            <Moon className="h-3.5 w-3.5" />
          )}
        </Button>
      </header>

      <div className="px-4 py-3">
        <div className="flex items-center gap-2 rounded-lg bg-accent/60 px-3 py-2">
          <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
          <span className="text-xs text-accent-foreground">
            Conector ativo — acionado pelo TOGI Talk
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
        <section className="rounded-lg border border-border/70 bg-card p-3.5 shadow-sm shadow-black/[0.03]">
          <div className="mb-3 flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-primary/80" strokeWidth={1.75} />
            <h2 className="text-xs font-medium text-foreground">
              Instâncias
            </h2>
          </div>
          <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
            O TOGI Talk pode enviar a URL da API automaticamente. Use o campo
            abaixo só se precisar autorizar manualmente.
          </p>

          <div className="flex gap-2">
            <Input
              type="url"
              placeholder="https://cliente.togitalk.com.br"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && void handleAuthorize()}
              spellCheck={false}
              className="h-8 border-border/80 bg-background text-xs shadow-none"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleAuthorize()}
              disabled={loading || !urlInput.trim()}
              className="h-8 shrink-0 border-border/80 px-2.5 text-primary hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Button>
          </div>

          {error && (
            <p className="mt-2 text-[11px] text-destructive/90">{error}</p>
          )}

          {instances.authorized.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {instances.authorized.map((origin) => (
                <li
                  key={origin}
                  className="group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors hover:bg-muted/80"
                >
                  <span className="truncate text-foreground/85">{origin}</span>
                  <button
                    type="button"
                    onClick={() => void remove(origin)}
                    disabled={loading}
                    className="shrink-0 text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive/80 group-hover:opacity-100"
                    aria-label={`Remover ${origin}`}
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[11px] text-muted-foreground/70">
              Nenhuma instância autorizada ainda.
            </p>
          )}
        </section>

        <section className="rounded-lg border border-border/70 bg-card p-3.5 shadow-sm shadow-black/[0.03]">
          <ol className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
            <li className="flex gap-2">
              <span className="font-medium text-primary/70">1.</span>
              <span>Autorize a URL da instância</span>
            </li>
            <li className="flex gap-2">
              <span className="font-medium text-primary/70">2.</span>
              <span>Inicie o passkey no painel do TOGI Talk</span>
            </li>
            <li className="flex gap-2">
              <span className="font-medium text-primary/70">3.</span>
              <span>A sessão é enviada automaticamente ao servidor</span>
            </li>
          </ol>
        </section>

        <a
          href="https://web.whatsapp.com"
          target="_blank"
          rel="noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border/70 bg-card py-2.5 text-xs font-medium text-foreground/80 shadow-sm shadow-black/[0.03] transition-colors hover:bg-muted/50"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
          Abrir WhatsApp Web
        </a>
      </div>
    </div>
  );
}
