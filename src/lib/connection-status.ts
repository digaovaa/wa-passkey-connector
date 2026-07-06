export type ConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'opening'
  | 'loading'
  | 'authenticating'
  | 'finishing'
  | 'success'
  | 'error';

export interface ConnectionStatus {
  phase: ConnectionPhase;
  message: string;
  updatedAt: number;
  requestId?: string;
  error?: string;
  failedAt?: ConnectionPhase;
}

export const STATUS_STORAGE_KEY = 'connection_status';
export const STATUS_CHANGED_MESSAGE = 'CONNECTION_STATUS_CHANGED';

export const CONNECTION_STEPS = [
  { id: 'connecting', label: 'Iniciando conexão' },
  { id: 'opening', label: 'Abrindo WhatsApp Web' },
  { id: 'loading', label: 'Carregando página' },
  { id: 'authenticating', label: 'Aguardando autenticação' },
  { id: 'finishing', label: 'Finalizando' },
] as const;

const PHASE_ORDER: ConnectionPhase[] = [
  'idle',
  'connecting',
  'opening',
  'loading',
  'authenticating',
  'finishing',
  'success',
  'error',
];

export function phaseIndex(phase: ConnectionPhase): number {
  const idx = PHASE_ORDER.indexOf(phase);
  return idx < 0 ? 0 : idx;
}

export function stepState(
  stepId: (typeof CONNECTION_STEPS)[number]['id'],
  current: ConnectionPhase,
  failedAt?: ConnectionPhase,
): 'done' | 'active' | 'pending' | 'error' {
  if (current === 'error') {
    const failIdx = phaseIndex(failedAt ?? 'connecting');
    const stepIdx = PHASE_ORDER.indexOf(stepId as ConnectionPhase);
    if (stepIdx < failIdx) return 'done';
    if (stepIdx === failIdx) return 'error';
    return 'pending';
  }
  if (current === 'success') return 'done';
  const currentIdx = phaseIndex(current);
  const stepIdx = PHASE_ORDER.indexOf(stepId as ConnectionPhase);
  if (stepIdx < currentIdx) return 'done';
  if (stepIdx === currentIdx) return 'active';
  return 'pending';
}

export const DEFAULT_STATUS: ConnectionStatus = {
  phase: 'idle',
  message: 'Aguardando conexão',
  updatedAt: Date.now(),
};

export function statusMessage(phase: ConnectionPhase, error?: string): string {
  switch (phase) {
    case 'connecting':
      return 'Conectando...';
    case 'opening':
      return 'Abrindo WhatsApp Web...';
    case 'loading':
      return 'Carregando página...';
    case 'authenticating':
      return 'Confirme a autenticação na aba aberta';
    case 'finishing':
      return 'Finalizando conexão...';
    case 'success':
      return 'Conexão concluída com sucesso!';
    case 'error':
      return error || 'Falha na conexão';
    default:
      return 'Aguardando conexão';
  }
}
