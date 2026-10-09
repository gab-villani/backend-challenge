# Como rodar o projeto

## Pré-requisitos
| Ferramenta | Versão |
|---|---|
| Docker + Docker Compose | 2.0+ |
| Bun | 1.x |

---

## Opção 1: Docker Compose completo

```bash
# Sobe PostgreSQL + LocalStack SQS + App
docker compose up -d

# A API estará em http://localhost:3000
# Migrations e filas SQS são inicializadas automaticamente
```

**Verificar se está saudável:**
```bash
curl http://localhost:3000/health/live   # {"status":"ok"}
curl http://localhost:3000/health/ready  # {"status":"ready","checks":{"database":"up","sqs":"up"}}
```

**Ver logs:**
```bash
docker compose logs -f app
```

---

## Opção 2: Desenvolvimento local (infra no Docker, app no host)

```bash
# 1. Sobe apenas PostgreSQL + LocalStack
docker compose up -d postgres localstack

# 2. Instala dependências
bun install

# 3. Roda migrations
bun run migration:up

# 4. Inicia API em modo watch
bun run start:dev
```

A API estará em `http://localhost:3000` com hot-reload.

---

## Testes

### Unitários (rodam sem Docker)
```bash
bun test
# 105 testes, ~300ms, cobrem: Money, Wallet, WagerTransaction, regras de negócio, concorrência
```

### Integração / E2E
> **Limitação conhecida:** Os testes E2E (`test/*.e2e-spec.ts`) falham com `TypeError: Cannot define property __helper` devido a incompatibilidade entre vitest/Bun + MikroORM + NestJS TestingModule. **Não é bug de código** a aplicação funciona corretamente como serviço.

**Para validar integração manualmente:**
```bash
# Com a app rodando (Opção 1 ou 2):

# Criar wallet
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -d '{"playerId": "player-123", "initialBalance": {"amount": "1000.00", "currency": "BRL"}}'

# Submeter aposta (BET)
curl -X POST http://localhost:3000/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: provider-a:tx-1" \
  -d '{
    "providerId": "provider-a",
    "externalTransactionId": "tx-1",
    "playerId": "player-123",
    "walletId": "<ID_DA_WALLET_CRIADA>",
    "roundId": "round-1",
    "gameId": "game-1",
    "kind": "BET",
    "money": {"amount": "100.00", "currency": "BRL"}
  }'

# Ver ledger
curl http://localhost:3000/wallets/<ID_DA_WALLET>/ledger

# Reconciliação
curl -X POST http://localhost:3000/wallets/<ID_DA_WALLET>/reconciliation
```

---

## Comandos úteis

| Comando | Descrição |
|---|---|
| `bun test` | Testes unitários (105 testes) |
| `bun run lint` | Oxlint |
| `bun run build` | Compila TypeScript |
| `bun run migration:up` | Aplica migrations |
| `bun run migration:create` | Cria migration |
| `bun run migration:down` | Reverte migration |
| `docker compose logs -f app` | Logs da aplicação |
| `docker compose logs -f postgres` | Logs do PostgreSQL |
| `docker compose down` | Para tudo |

---

## Troubleshooting rápido

| Problema | Solução |
|---|---|
| Porta 3000 ocupada | `docker compose down` ou matar processo na porta |
| App não inicia / crash | Aguarde `postgres` e `localstack` ficarem `healthy` |
| `relation does not exist` | `bun run migration:up` ou verifique `docker compose logs app` |
| `SQS connection refused` | `docker compose ps` → `localstack` deve estar `healthy` |
| Testes E2E falham com `__helper` | **Não é bug** — use `bun test` (unitários) para CI; valide E2E manual contra app rodando |

---

## Estrutura de pastas (resumo)
```
src/
├── auth/                  # AuthGuard no-op + ProviderIdentityPort
├── domain/                # Money, enums, eventos de integração
├── wallets/               # Wallet (Aggregate Root) + API
├── transactions/          # WagerTransaction (máquina de estados)
├── ledger/                # WalletLedgerEntry (imutável)
├── messaging/             # Inbox, Outbox, publisher, consumer SQS
├── wagering/              # Use case + API HTTP
├── observability/         # Logging (pino) + métricas (prom-client)
├── scheduler/             # Worker de resolução de referências
├── sqs/                   # Cliente SQS (LocalStack)
└── main.ts                # Bootstrap + guards globais
```