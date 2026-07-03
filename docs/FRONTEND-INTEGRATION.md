# Integração frontend — TOGI Talk Connector

Documento para implementar no frontend do TOGI Talk a comunicação com a extensão **TOGI Talk Connector** (Chrome, Manifest V3).

A extensão importa a sessão autenticada do WhatsApp Web (incluindo contas **passkey**) e envia o dump para o backend via URL assinada de uso único.

---

## Pré-requisitos

- Usuário com **Google Chrome** (ou Chromium compatível com extensões MV3).
- Extensão **TOGI Talk Connector** instalada (unpacked ou `.crx`).
- Conta WhatsApp que exige **passkey** (não pareia via QR headless).
- Backend com endpoint que gera **URL assinada** para receber o dump (POST JSON).

---

## Variáveis de ambiente sugeridas

```env
# ID fixo da extensão (obtido em chrome://extensions — útil para fallback externo)
VITE_TOGI_CONNECTOR_EXTENSION_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Base da API desta instância (se diferente do origin do frontend)
VITE_API_BASE_URL=https://api.cliente.togitalk.com.br
```

O `EXTENSION_ID` só é necessário para o fallback via `chrome.runtime.sendMessage` (quando o bridge ainda não está injetado na página).

---

## Protocolo de comunicação

Toda mensagem usa `window.postMessage` com:

- **Enviar para extensão:** `{ target: 'wa-passkey-connector', type: '...', ... }`
- **Receber da extensão:** `{ source: 'wa-passkey-connector', type: '...', ... }`

Sempre filtrar `event.source === window` ao receber.

---

## Fluxo completo (happy path)

```
1. Página carrega → detectar extensão (PING / CONNECTOR_READY)
2. Usuário clica "Conectar passkey" (gesto do usuário — importante para permissão Chrome)
3. Backend gera URL assinada de upload (one-time)
4. Frontend envia REGISTER_INSTANCE (origens frontend + API)
5. Chrome pode pedir permissão de host → usuário aceita
6. Frontend envia START_PASSKEY_IMPORT { url }
7. Extensão abre WhatsApp Web, força passkey, extrai sessão, POST na url
8. Frontend recebe IMPORT_SENT → aguardar socket/API ficar online
```

---

## Mensagens: Frontend → Extensão

| type | Campos | Quando usar |
|------|--------|-------------|
| `PING` | — | Detectar se a extensão está instalada |
| `REGISTER_INSTANCE` | `frontendOrigin?`, `apiOrigin?`, `apiUrl?` | **No clique** do botão, antes do import. Registra origens e pede permissão ao Chrome |
| `START_PASSKEY_IMPORT` | `url` (obrig.), `frontendOrigin?`, `apiOrigin?` | Inicia o fluxo passkey. `url` = URL assinada do backend |
| `CLEAR_AND_CONTINUE` | — | Usuário confirmou limpar sessão WA Web existente |
| `CANCEL_IMPORT` | — | Usuário cancelou o fluxo |

### Detalhes dos campos

- **`url`** — URL completa do POST (ex.: `https://api.cliente.com/api/pair/TOKEN/capture?sig=...`). A extensão extrai a origem e autoriza automaticamente.
- **`frontendOrigin`** — Opcional; default `window.location.origin`.
- **`apiOrigin`** — Opcional; use quando a API está em domínio diferente do frontend (ex.: `https://api.cliente.com`).

---

## Mensagens: Extensão → Frontend

| type | Campos | Significado |
|------|--------|-------------|
| `CONNECTOR_READY` | — | Extensão instalada e bridge ativo na página |
| `REGISTER_INSTANCE_RESULT` | `ok`, `error?`, `authorized?`, `needsPermission?` | Resultado do registro de instância |
| `EXISTING_SESSION` | `number` | Já existe login no WhatsApp Web local; pedir consentimento ao usuário |
| `IMPORT_SENT` | — | Dump enviado com sucesso ao backend |
| `IMPORT_ERROR` | `reason`, `error?` | Falha no fluxo |

### Valores de `reason` em `IMPORT_ERROR`

| reason | Ação sugerida na UI |
|--------|---------------------|
| `timeout` | Sessão não completou a tempo; pedir para tentar de novo |
| `noise_key_unavailable` | Versão/build do WhatsApp Web incompatível; recarregar aba ou tentar depois |
| `permission_denied` | Usuário negou permissão de host; orientar a aceitar no Chrome |
| `HTTP <status>` | Backend rejeitou o dump; mostrar erro e logs |
| `network` | Falha de rede ao POST; verificar CORS/URL/conectividade |

---

## Backend: endpoint de upload

Antes de `START_PASSKEY_IMPORT`, o frontend deve obter do **seu backend** uma URL assinada de uso único:

```http
POST /api/pair/{token}/import-url
Authorization: Bearer ...
```

Resposta esperada:

```json
{
  "url": "https://api.cliente.com/api/pair/abc123/capture?expires=...&sig=..."
}
```

A extensão fará:

```http
POST {url}
Content-Type: application/json

{ ... dump da sessão WhatsApp Web ... }
```

O backend converte o dump (ex.: `wa-store-migrate`) e importa no whatsmeow/Baileys.

---

## Implementação de referência (TypeScript)

### Constantes e tipos

```typescript
const CONNECTOR_TARGET = 'wa-passkey-connector';
const CONNECTOR_SOURCE = 'wa-passkey-connector';

type ConnectorOutbound =
  | { target: typeof CONNECTOR_TARGET; type: 'PING' }
  | {
      target: typeof CONNECTOR_TARGET;
      type: 'REGISTER_INSTANCE';
      frontendOrigin?: string;
      apiOrigin?: string;
      apiUrl?: string;
    }
  | {
      target: typeof CONNECTOR_TARGET;
      type: 'START_PASSKEY_IMPORT';
      url: string;
      frontendOrigin?: string;
      apiOrigin?: string;
    }
  | { target: typeof CONNECTOR_TARGET; type: 'CLEAR_AND_CONTINUE' }
  | { target: typeof CONNECTOR_TARGET; type: 'CANCEL_IMPORT' };

type ConnectorInbound =
  | { source: typeof CONNECTOR_SOURCE; type: 'CONNECTOR_READY' }
  | {
      source: typeof CONNECTOR_SOURCE;
      type: 'REGISTER_INSTANCE_RESULT';
      ok: boolean;
      error?: string;
      authorized?: string[];
      needsPermission?: boolean;
    }
  | { source: typeof CONNECTOR_SOURCE; type: 'EXISTING_SESSION'; number: string }
  | { source: typeof CONNECTOR_SOURCE; type: 'IMPORT_SENT' }
  | {
      source: typeof CONNECTOR_SOURCE;
      type: 'IMPORT_ERROR';
      reason: string;
      error?: string;
    };

function postToConnector(msg: ConnectorOutbound) {
  window.postMessage(msg, '*');
}
```

### Detectar extensão

```typescript
export function waitForConnector(timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as ConnectorInbound;
      if (data?.source === CONNECTOR_SOURCE && data.type === 'CONNECTOR_READY') {
        finish(true);
      }
    };

    const finish = (installed: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(installed);
    };

    window.addEventListener('message', onMessage);
    postToConnector({ target: CONNECTOR_TARGET, type: 'PING' });

    const timer = setTimeout(() => finish(false), timeoutMs);
  });
}
```

### Registrar instância (multi-tenant)

Chamar **no handler de clique** do botão (gesto do usuário):

```typescript
export function registerInstance(opts: {
  apiOrigin?: string;
  apiUrl?: string;
}): Promise<{ ok: boolean; needsPermission?: boolean; error?: string }> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as ConnectorInbound;
      if (
        data?.source === CONNECTOR_SOURCE &&
        data.type === 'REGISTER_INSTANCE_RESULT'
      ) {
        window.removeEventListener('message', onMessage);
        resolve({
          ok: data.ok,
          needsPermission: data.needsPermission,
          error: data.error,
        });
      }
    };

    window.addEventListener('message', onMessage);

    postToConnector({
      target: CONNECTOR_TARGET,
      type: 'REGISTER_INSTANCE',
      frontendOrigin: window.location.origin,
      apiOrigin: opts.apiOrigin,
      apiUrl: opts.apiUrl,
    });

    setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ ok: false, error: 'Timeout ao registrar instância' });
    }, 15000);
  });
}
```

### Fallback: mensagem externa (bridge ainda não injetado)

Use quando `waitForConnector()` retorna `false` mas você sabe que a extensão está instalada:

```typescript
const EXT_ID = import.meta.env.VITE_TOGI_CONNECTOR_EXTENSION_ID;

export function registerInstanceExternal(opts: {
  apiOrigin?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (!EXT_ID || !chrome?.runtime?.sendMessage) {
      resolve({ ok: false, error: 'Extensão não detectada' });
      return;
    }

    chrome.runtime.sendMessage(
      EXT_ID,
      {
        type: 'REGISTER_INSTANCE',
        frontendOrigin: location.origin,
        apiOrigin: opts.apiOrigin,
      },
      (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(res ?? { ok: false });
      },
    );
  });
}
```

---

## Hook React sugerido

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';

type PasskeyFlowState =
  | 'idle'
  | 'checking_extension'
  | 'registering'
  | 'awaiting_passkey'
  | 'existing_session'
  | 'importing'
  | 'success'
  | 'error';

export function usePasskeyConnector(apiBaseUrl: string) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [state, setState] = useState<PasskeyFlowState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [existingNumber, setExistingNumber] = useState<string | null>(null);
  const apiOrigin = new URL(apiBaseUrl).origin;

  useEffect(() => {
    setState('checking_extension');
    waitForConnector().then(setInstalled);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (data?.source !== CONNECTOR_SOURCE) return;

      switch (data.type) {
        case 'EXISTING_SESSION':
          setExistingNumber(data.number);
          setState('existing_session');
          break;
        case 'IMPORT_SENT':
          setState('success');
          break;
        case 'IMPORT_ERROR':
          setError(data.error ?? data.reason);
          setState('error');
          break;
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const startPasskeyImport = useCallback(async () => {
    setError(null);
    setState('registering');

    const reg = await registerInstance({ apiOrigin });
    if (!reg.ok) {
      setError(reg.error ?? 'Falha ao autorizar instância');
      setState('error');
      return;
    }

    const { url } = await fetch(`${apiBaseUrl}/api/pair/import-url`, {
      method: 'POST',
      credentials: 'include',
    }).then((r) => r.json());

    setState('awaiting_passkey');

    postToConnector({
      target: CONNECTOR_TARGET,
      type: 'START_PASSKEY_IMPORT',
      url,
      frontendOrigin: window.location.origin,
      apiOrigin,
    });

    setState('importing');
  }, [apiBaseUrl, apiOrigin]);

  const confirmClearSession = useCallback(() => {
    postToConnector({ target: CONNECTOR_TARGET, type: 'CLEAR_AND_CONTINUE' });
    setExistingNumber(null);
    setState('importing');
  }, []);

  const cancelImport = useCallback(() => {
    postToConnector({ target: CONNECTOR_TARGET, type: 'CANCEL_IMPORT' });
    setState('idle');
  }, []);

  return {
    installed,
    state,
    error,
    existingNumber,
    startPasskeyImport,
    confirmClearSession,
    cancelImport,
  };
}
```

---

## UI mínima recomendada

### Estado: extensão não instalada

> Instale a extensão **TOGI Talk Connector** para conectar contas com passkey.
> [Link para download / instruções]

### Estado: pronto

> Botão **Conectar com passkey**

### Estado: `existing_session`

> Detectamos um WhatsApp Web logado neste navegador (`{number}`).
> Para continuar, a sessão local será limpa após a importação.
> [Continuar] [Cancelar]

### Estado: `importing`

> Autentique com sua passkey na aba do WhatsApp Web que abriu...

### Estado: `success`

> Sessão importada. Aguardando conexão online...

(Polling no seu backend até `status === 'open'`.)

### Estado: `error`

> Falha: `{reason}`. [Tentar novamente]

---

## Multi-instância (vários TOGI Talk)

Cada instância do TOGI Talk roda em URL diferente. **Não configure URLs na extensão manualmente.**

O frontend envia as origens em runtime:

```typescript
await registerInstance({
  frontendOrigin: window.location.origin,       // ex.: https://cliente1.togitalk.com.br
  apiOrigin: new URL(apiBaseUrl).origin,          // ex.: https://api-cliente1.togitalk.com.br
});
```

Na primeira vez por origem, o Chrome exibe diálogo de permissão — isso é obrigatório por segurança. Depois fica salvo no navegador.

---

## Checklist de implementação

- [ ] Detectar extensão na tela de conexão passkey (`waitForConnector`)
- [ ] Botão "Conectar passkey" chama `registerInstance` + `START_PASSKEY_IMPORT`
- [ ] Backend expõe endpoint que retorna `{ url }` assinada
- [ ] Listener de `IMPORT_SENT` / `IMPORT_ERROR` / `EXISTING_SESSION`
- [ ] Modal de consentimento para `EXISTING_SESSION` → `CLEAR_AND_CONTINUE` ou `CANCEL_IMPORT`
- [ ] Polling do status da instância após `IMPORT_SENT`
- [ ] Mensagem clara se `needsPermission` ou extensão ausente
- [ ] `VITE_TOGI_CONNECTOR_EXTENSION_ID` no `.env` (fallback externo)
- [ ] Testar com API em subdomínio diferente do frontend (`apiOrigin`)

---

## O que **não** fazer

- Não hardcodar URLs de instâncias no frontend — use `window.location.origin` e `apiBaseUrl` do env.
- Não chamar `REGISTER_INSTANCE` fora de um clique do usuário (Chrome pode bloquear `permissions.request`).
- Não esperar resposta síncrona de `START_PASSKEY_IMPORT` — o resultado vem via `IMPORT_SENT` / `IMPORT_ERROR`.
- Não armazenar ou logar a URL assinada de upload (contém credencial de one-time upload).

---

## Referência

Extensão: repositório `wa-passkey-connector` / **TOGI Talk Connector**  
Protocolo interno: `source` / `target` = `'wa-passkey-connector'`
