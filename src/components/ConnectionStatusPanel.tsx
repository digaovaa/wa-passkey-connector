import { Check, Link2, Loader2, X } from 'lucide-react';
import {
  CONNECTION_STEPS,
  stepState,
  type ConnectionStatus,
} from '@/lib/connection-status';
import { cn } from '@/lib/utils';

type Props = {
  status: ConnectionStatus;
  compact?: boolean;
};

export function ConnectionStatusPanel({ status, compact }: Props) {
  const { phase, message } = status;
  const inProgress =
    phase !== 'idle' && phase !== 'success' && phase !== 'error';

  return (
    <div className={cn('flex flex-col', compact ? 'gap-3' : 'gap-4')}>
      <div className="flex flex-col items-center text-center">
        <div
          className={cn(
            'mb-3 flex items-center justify-center rounded-full',
            compact ? 'h-12 w-12' : 'h-14 w-14',
            phase === 'success' && 'bg-emerald-500/10 text-emerald-600',
            phase === 'error' && 'bg-destructive/10 text-destructive',
            inProgress && 'bg-primary/10 text-primary',
            phase === 'idle' && 'bg-muted text-muted-foreground',
          )}
        >
          {phase === 'success' ? (
            <Check className="h-6 w-6" strokeWidth={2} />
          ) : phase === 'error' ? (
            <X className="h-6 w-6" strokeWidth={2} />
          ) : inProgress ? (
            <Loader2 className="h-6 w-6 animate-spin" strokeWidth={2} />
          ) : (
            <Link2 className="h-6 w-6" strokeWidth={1.75} />
          )}
        </div>

        <p className="text-sm font-medium text-foreground">
          {phase === 'idle' ? 'Pronto para conectar' : message}
        </p>
        {inProgress && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Não feche esta janela durante a conexão
          </p>
        )}
      </div>

      {phase !== 'idle' && (
        <ol className="space-y-2 rounded-lg border border-border/70 bg-card p-3 shadow-sm shadow-black/[0.03]">
          {CONNECTION_STEPS.map((step) => {
            const state = stepState(step.id, phase, status.failedAt);
            return (
              <li
                key={step.id}
                className="flex items-center gap-2.5 text-[11px]"
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                    state === 'done' &&
                      'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
                    state === 'active' &&
                      'border-primary/30 bg-primary/10 text-primary',
                    state === 'pending' &&
                      'border-border bg-muted/50 text-muted-foreground/50',
                    state === 'error' &&
                      'border-destructive/30 bg-destructive/10 text-destructive',
                  )}
                >
                  {state === 'done' ? (
                    <Check className="h-3 w-3" />
                  ) : state === 'active' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : state === 'error' ? (
                    <X className="h-3 w-3" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  )}
                </span>
                <span
                  className={cn(
                    state === 'active' && 'font-medium text-foreground',
                    state === 'done' && 'text-muted-foreground',
                    state === 'pending' && 'text-muted-foreground/60',
                    state === 'error' && 'font-medium text-destructive',
                  )}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
