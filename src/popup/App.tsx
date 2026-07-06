import { ExternalLink, Link2, Moon, Sun } from 'lucide-react';
import { ConnectionStatusPanel } from '@/components/ConnectionStatusPanel';
import { ReceivedUrlsPanel } from '@/components/ReceivedUrlsPanel';
import { Button } from '@/components/ui/button';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useReceivedUrls } from '@/hooks/useReceivedUrls';
import { useTheme } from '@/hooks/useTheme';

export default function App() {
  const { theme, toggle } = useTheme();
  const { status, isActive } = useConnectionStatus();
  const { received } = useReceivedUrls();

  const showStatus =
    isActive || status.phase === 'success' || status.phase === 'error';

  return (
    <div className="flex min-h-0 flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Link2 className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Conector WA</p>
            <p className="text-[11px] text-muted-foreground">
              {isActive ? 'Conectando...' : 'Extensão ativa'}
            </p>
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

      <div className="flex flex-1 flex-col gap-3 px-4 py-4">
        {showStatus && <ConnectionStatusPanel status={status} />}

        <ReceivedUrlsPanel received={received} />

        {!showStatus && (
          <>
            <div className="flex items-center gap-2 rounded-lg bg-accent/60 px-3 py-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
              <span className="text-xs text-accent-foreground">
                Conector ativo — acionado pelo seu painel
              </span>
            </div>

            <section className="rounded-lg border border-border/70 bg-card p-3.5 shadow-sm shadow-black/[0.03]">
              <ol className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
                <li className="flex gap-2">
                  <span className="font-medium text-primary/70">1.</span>
                  <span>Inicie a conexão no seu painel</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-medium text-primary/70">2.</span>
                  <span>O popup da extensão abrirá com o progresso</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-medium text-primary/70">3.</span>
                  <span>Confirme a autenticação quando solicitado</span>
                </li>
              </ol>
            </section>
          </>
        )}

        {!isActive && status.phase === 'idle' && (
          <a
            href="https://web.whatsapp.com"
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border/70 bg-card py-2.5 text-xs font-medium text-foreground/80 shadow-sm shadow-black/[0.03] transition-colors hover:bg-muted/50"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
            Abrir WhatsApp Web
          </a>
        )}
      </div>
    </div>
  );
}
