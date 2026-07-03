# Integração frontend — TOGI Talk Connector

Documento para implementar no frontend do TOGI Talk a comunicação com a extensão
**TOGI Talk Connector** (Chrome, Manifest V3).

A extensão **delega a assertion WebAuthn (passkey)** no navegador do dono da
conta: abre `web.whatsapp.com`, roda `navigator.credentials.get` com o challenge
do servidor e devolve a assertion. O whatsmeow do backend completa o pareamento
(`SendPasskeyResponse` / `SendPasskeyConfirmation`). Não há dump de sessão.

Guia genérico (whatsmeow + backend):
[`WHATSMEOW-IMPLEMENTATION.md`](./WHATSMEOW-IMPLEMENTATION.md).

---

## Pré-requisitos

- Usuário com **Google Chrome** (ou Chromium compatível com extensões MV3).
- Extensão **TOGI Talk Connector** instalada (unpacked ou `.crx`).
- Conta WhatsApp que exige **passkey** (não pareia via QR headless).
- Backend/whatsmeow que:
  - entrega o challenge (`GetPasskeyRequestOptions` / evento passkey);
  - recebe a assertion e chama `SendPasskeyResponse` (+ confirmação).

---

## Variáveis de ambiente sugeridas

```env
# ID fixo da extensão (obtido em chrome://extensions — útil para fallback externo)
VITE_TOGI_CONNECTOR_EXTENSION_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Base da API desta instância (se diferente do origin do frontend)
VITE_API_BASE_URL=https://api.cliente.togitalk.com.br
```

O `EXTENSION_ID` só é necessário para o fallback via `chrome.runtime.sendMessage`
(quando o bridge ainda não está injetado na página).

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
3. Frontend envia REGISTER_INSTANCE (origens frontend + API)
4. Chrome pode pedir permissão de host → usuário aceita
5. Frontend busca o challenge no backend ({ publicKey })
6. Frontend envia RUN_PASSKEY_ASSERTION { requestId, publicKey }
7. Extensão abre WhatsApp Web, roda navigator.credentials.get, devolve assertion
8. Frontend recebe PASSKEY_ASSERTION_RESULT → POST assertion no backend
9. Backend/whatsmeow completa o pareamento → status CONNECTED
```

---

## Mensagens: Frontend → Extensão

| type | Campos | Quando usar |
|------|--------|-------------|
| `PING` | — | Detectar se a extensão está instalada |
| `REGISTER_INSTANCE` | `frontendOrigin?`, `apiOrigin?`, `apiUrl?` | **No clique** do botão, antes da assertion. Registra origens e pede permissão ao Chrome |
| `RUN_PASSKEY_ASSERTION` | `requestId`, `publicKey` (obrig.) | Roda `navigator.credentials.get` com o challenge do servidor |

### Detalhes dos campos

- **`publicKey`** — objeto WebAuthn no formato do browser (espelho de
  `types.WebAuthnPublicKey` do whatsmeow): `challenge`, `rpId`,
  `allowCredentials[]`, `userVerification`, `timeout`, `extensions`. Campos
  binários em **base64url sem padding**.
- **`requestId`** — correlaciona o resultado (`PASSKEY_ASSERTION_RESULT`). Use
  `crypto.randomUUID()`.
- **`frontendOrigin`** — Opcional; default `window.location.origin`.
- **`apiOrigin`** — Opcional; use quando a API está em domínio diferente do
  frontend (ex.: `https://api.cliente.com`). Útil se o bridge/fallback externo
  precisar da origem da API autorizada.

---

## Mensagens: Extensão → Frontend

| type | Campos | Significado |
|------|--------|-------------|
| `CONNECTOR_READY` | — | Extensão instalada e bridge ativo na página |
| `REGISTER_INSTANCE_RESULT` | `ok`, `error?`, `authorized?`, `needsPermission?` | Resultado do registro de instância |
| `PASSKEY_ASSERTION_RESULT` | `requestId`, `assertion?`, `error?` | Assertion WebAuthn ou motivo de erro |

### Valores de `error` em `PASSKEY_ASSERTION_RESULT`

| error | Ação sugerida na UI |
|-------|---------------------|
| `tab_open_failed` | Não abriu a aba do WhatsApp Web; tentar de novo |
| `assertion_failed` | Usuário cancelou ou a assertion não completou |
| `assertion_exception` / mensagem do browser | Falha no WebAuthn; mostrar e permitir retry |
| mensagem do `DOMException` | Ex.: `NotAllowedError` (usuário cancelou o prompt) |

---

## Backend: challenge e assertion

O frontend **não** manda a assertion pela extensão — ele recebe e faz o POST.

### Challenge

```http
GET /api/pair/{token}/passkey-challenge
Authorization: Bearer ...
```

Resposta esperada:

```json
{
  "publicKey": {
    "challenge": "...",
    "rpId": "whatsapp.com",
    "timeout": 600000,
    "allowCredentials": [],
    "userVerification": "preferred"
  }
}
```

Mint on demand (no clique do usuário). Challenge é **single-use** com TTL curto.

### Assertion

```http
POST /api/pair/{token}/passkey-response
Authorization: Bearer ...
Content-Type: application/json

{ "id": "...", "rawId": "...", "type": "public-key", "response": { ... } }
```

Encaminhe **verbatim** (strings base64url sem padding) ao worker whatsmeow
(`SendPasskeyResponse`). Não re-encode em Buffer/base64 padrão.

Os paths acima são exemplos — use as rotas que o seu backend já expõe, desde que
entreguem `{ publicKey }` e aceitem o corpo da assertion.

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
      type: 'RUN_PASSKEY_ASSERTION';
      requestId: string;
      publicKey: unknown;
    };

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
  | {
      source: typeof CONNECTOR_SOURCE;
      type: 'PASSKEY_ASSERTION_RESULT';
      requestId?: string;
      assertion?: unknown;
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

### Rodar a assertion

```typescript
export function runPasskeyAssertion(
  publicKey: unknown,
  timeoutMs = 120_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as ConnectorInbound;
      if (data?.source !== CONNECTOR_SOURCE) return;
      if (data.type !== 'PASSKEY_ASSERTION_RESULT') return;
      if (data.requestId !== requestId) return;
      cleanup();
      if (data.assertion) resolve(data.assertion);
      else reject(new Error(data.error || 'assertion_failed'));
    };

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, timeoutMs);

    window.addEventListener('message', onMessage);
    postToConnector({
      target: CONNECTOR_TARGET,
      type: 'RUN_PASSKEY_ASSERTION',
      requestId,
      publicKey,
    });
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
import { useCallback, useEffect, useState } from 'react';

type PasskeyFlowState =
  | 'idle'
  | 'checking_extension'
  | 'registering'
  | 'awaiting_passkey'
  | 'submitting'
  | 'success'
  | 'error';

export function usePasskeyConnector(apiBaseUrl: string, connectionId: string) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [state, setState] = useState<PasskeyFlowState>('idle');
  const [error, setError] = useState<string | null>(null);
  const apiOrigin = new URL(apiBaseUrl).origin;

  useEffect(() => {
    setState('checking_extension');
    waitForConnector().then(setInstalled);
  }, []);

  const startPasskeyPairing = useCallback(async () => {
    setError(null);
    setState('registering');

    const reg = await registerInstance({ apiOrigin });
    if (!reg.ok) {
      setError(reg.error ?? 'Falha ao autorizar instância');
      setState('error');
      return;
    }

    setState('awaiting_passkey');

    try {
      const { publicKey } = await fetch(
        `${apiBaseUrl}/api/pair/${connectionId}/passkey-challenge`,
        { credentials: 'include' },
      ).then((r) => r.json());

      const assertion = await runPasskeyAssertion(publicKey);

      setState('submitting');
      await fetch(`${apiBaseUrl}/api/pair/${connectionId}/passkey-response`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assertion),
      });

      setState('success');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }, [apiBaseUrl, apiOrigin, connectionId]);

  return {
    installed,
    state,
    error,
    startPasskeyPairing,
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

### Estado: `awaiting_passkey`

> Confirme a passkey na aba do WhatsApp Web que abriu (e o PIN de 2FA, se houver)...

### Estado: `submitting` / `success`

> Assertion enviada. Aguardando conexão online...

(Polling no seu backend até `status === 'open'` / `CONNECTED`.)

### Estado: `error`

> Falha: `{error}`. [Tentar novamente] (um retry precisa de **novo** challenge)

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
- [ ] Botão "Conectar passkey" chama `registerInstance` + challenge + `RUN_PASSKEY_ASSERTION`
- [ ] Backend expõe challenge (`{ publicKey }`) e recebe assertion
- [ ] Listener / promise de `PASSKEY_ASSERTION_RESULT` correlacionado por `requestId`
- [ ] POST da assertion **verbatim** (base64url sem padding) ao backend
- [ ] Polling do status da instância após o POST
- [ ] Mensagem clara se `needsPermission` ou extensão ausente
- [ ] `VITE_TOGI_CONNECTOR_EXTENSION_ID` no `.env` (fallback externo)
- [ ] Testar com API em subdomínio diferente do frontend (`apiOrigin`)
- [ ] Retry sempre pede **novo** challenge (single-use)

---

## O que **não** fazer

- Não hardcodar URLs de instâncias no frontend — use `window.location.origin` e `apiBaseUrl` do env.
- Não chamar `REGISTER_INSTANCE` fora de um clique do usuário (Chrome pode bloquear `permissions.request`).
- Não re-encodear campos base64url da assertion (quebra a verificação no servidor).
- Não armazenar challenge nem assertion — são one-shot.
- Não usar o fluxo antigo (`START_PASSKEY_IMPORT` / dump de sessão) — removido.

---

## Referência

Extensão: repositório `wa-passkey-connector` / **TOGI Talk Connector**  
Protocolo interno: `source` / `target` = `'wa-passkey-connector'`  
whatsmeow: [`docs/WHATSMEOW-IMPLEMENTATION.md`](./WHATSMEOW-IMPLEMENTATION.md)
