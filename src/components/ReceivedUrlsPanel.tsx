import { Globe } from 'lucide-react';
import type { ReceivedUrlsPayload } from '@/lib/received-urls';

type Props = {
  received: ReceivedUrlsPayload | null;
};

function UrlRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="break-all text-[11px] text-foreground/90">{value}</p>
    </div>
  );
}

export function ReceivedUrlsPanel({ received }: Props) {
  const hasReceived =
    received &&
    (received.frontendOrigin || received.apiOrigin || received.apiUrl);

  return (
    <section className="rounded-lg border border-border/70 bg-card p-3.5 shadow-sm shadow-black/[0.03]">
      <div className="mb-3 flex items-center gap-2">
        <Globe className="h-3.5 w-3.5 text-primary/80" strokeWidth={1.75} />
        <h2 className="text-xs font-medium text-foreground">URLs recebidas</h2>
      </div>

      {hasReceived ? (
        <div className="space-y-2.5">
          <UrlRow label="Painel" value={received?.frontendOrigin} />
          <UrlRow label="API" value={received?.apiOrigin} />
          <UrlRow label="Endpoint" value={received?.apiUrl} />
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground/70">
          Nenhuma URL recebida ainda. Inicie a conexão pelo seu painel.
        </p>
      )}
    </section>
  );
}
