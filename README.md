# Technical Challenge — Distributed Wagering Processor

## Jungle Gaming 🦧

Sistema financeiro distribuído para processamento de transações de apostas (wagering) com garantias de correção financeira, idempotência persistente, concorrência segura e consistência entre saldo materializado e ledger.

## Stack

| Item | Escolha |
|------|---------|
| Runtime / Package Manager / Test Runner | **Bun 1.x** |
| Linguagem | **TypeScript** (strict mode) |
| Framework | **NestJS** |
| Banco de Dados | **PostgreSQL 16** |
| Mensageria | **AWS SQS** via **LocalStack** |
| ORM | **MikroORM** (Unit of Work, Identity Map, LockMode) |
| Orquestração Local | **Docker Compose** |
| Money | **decimal.js** + Value Object imutável |

## Requisitos

- Node.js 18+ (ou Bun 1.x)
- Docker + Docker Compose
- Bun 1.x (para desenvolvimento local)

## Quick Start

```bash
# 1. Subir infraestrutura (PostgreSQL + LocalStack SQS)
docker-compose up -d

# 2. Instalar dependências
bun install

# 3. Rodar migrações (criar tabelas)
bun run migration:up

# 4. Iniciar aplicação (modo desenvolvimento)
bun run start:dev

# A aplicação estará em http://localhost:3000
```

## Scripts Disponíveis

```bash
# Desenvolvimento
bun run start:dev      # Watch mode com hot reload
bun run start:debug    # Debug mode

# Build & Produção
bun run build          # Compila para dist/
bun run start:prod     # Roda dist/main.js

# Banco de Dados
bun run migration:create --name=nome_migration
bun run migration:up
bun run migration:down
bun run migration:list

# Testes
bun run test           # Unit tests (vitest)
bun run test:watch     # Watch mode
bun run test:cov       # Coverage report
bun run test:e2e       # Integration tests (requer containers)

# Qualidade
bun run lint           # oxlint
bun run format         # prettier

# Docker
docker-compose up -d           # Sobe infra
docker-compose down            # Para infra
docker-compose logs -f app     # Logs da aplicação
```

## Endpoints da API

### Health Checks (sem autenticação)
```
GET /health/live      # Processo vivo
GET /health/ready     # PostgreSQL + SQS alcançáveis
```

### Wallets
```
POST /wallets
{
  "playerId": "uuid",
  "initialBalance": { "amount": "1000.00", "currency": "BRL" }
}

GET /wallets/:walletId
GET /wallets/:walletId/ledger?cursor=...&limit=50
POST /wallets/:walletId/reconciliation
```

### Wagering Transactions
```
POST /wagering/transactions
Idempotency-Key: provider-a:transaction-123

{
  "providerId": "provider-a",
  "externalTransactionId": "transaction-123",
  "playerId": "uuid",
  "walletId": "uuid",
  "roundId": "round-987",
  "gameId": "fortune-chimp",
  "kind": "BET",
  "money": { "amount": "25.00", "currency": "BRL" }
}

GET /wagering/transactions/:transactionId
GET /providers/:providerId/wagering/transactions/:externalTransactionId
```

### Tipos de Transação (kind)
| Tipo | Efeito no Saldo | Ledger | Regra |
|------|----------------|--------|-------|
| `BET` | débito | 1 `DEBIT` | rejeita se saldo insuficiente |
| `WIN` | crédito | 1 `CREDIT` | pode referenciar BET da mesma rodada |
| `LOSS` | nenhum | nenhum | registra resultado sem mover saldo |
| `REFUND` | crédito | 1 `CREDIT` | reverte BET `PROCESSED`, uma única vez |
| `ROLLBACK` | inverso da ref | 1 invertido | reverte transação `PROCESSED`, uma única vez |

## Idempotência

- **Header obrigatório:** `Idempotency-Key` (formato: `providerId:externalTransactionId`)
- **Payload hash:** SHA-256 de JSON canônico (chaves ordenadas, apenas campos de negócio)
- **Mesma key + mesmo payload** → replay (retorna resultado original, `idempotentReplay: true`)
- **Mesma key + payload diferente** → 409 Conflict

## SQS Processing

### Filas
```
wager-transactions.fifo           # Fila principal
wager-transactions-dlq.fifo       # Dead Letter Queue (maxReceiveCount=5)
```

### Consumer (`wager-transactions-processor`)
- Reutiliza o **mesmo use case** da entrada HTTP
- Deduplicação via **inbox persistente** por `(consumerName, messageId)`
- **Ack somente após commit** da transação financeira
- Classificação de erros:
  - **Negócio** (terminal, ack): `INSUFFICIENT_BALANCE`, `INVALID_REFERENCE`, etc.
  - **Transitórios** (retry com backoff): DB lock, network
  - **Permanentes** (DLQ): payload inválido

## Transactional Outbox

### Atomicidade
Wallet + Ledger + Inbox + Outbox = **mesma transação SQL**

### Worker Publisher
- Poll a cada 5s, lote de 10
- `SELECT FOR UPDATE SKIP LOCKED` para publishers concorrentes
- Backoff exponencial + jitter (1s, 2s, 4s... max 60s)
- Max 10 tentativas antes de desistir (marca como publicado)

### Eventos Mínimos
| Evento | Quando |
|--------|--------|
| `WagerTransactionProcessed` | Qualquer transação aplicada (incl. LOSS) |
| `WagerTransactionRejected` | Rejeição por regra de negócio |
| `WalletBalanceChanged` | **Somente** quando saldo muda |
| `WagerTransactionPendingReference` | Referência ausente |

## Concorrência

**Unidade:** `walletId`

**Estratégia:** Pessimistic Locking (`SELECT FOR UPDATE` via `LockMode.PESSIMISTIC_WRITE`)

```typescript
const wallet = await walletRepo.findOne(
  { id: walletId },
  { lockMode: LockMode.PESSIMISTIC_WRITE }
);
```

### Cenário Obrigatório
Saldo inicial `100.00 BRL`. Duas apostas de `80.00 BRL` simultâneas.

**Resultado esperado:**
- Exatamente uma `PROCESSED`
- Outra `REJECTED` (`INSUFFICIENT_BALANCE`)
- Saldo final `20.00 BRL`
- Exatamente **um** lançamento `DEBIT` no ledger
- Nenhum retry duplica o débito

## Referências Fora de Ordem

1. REFUND/ROLLBACK chega sem referência → `PENDING_REFERENCE`
2. Evento `WagerTransactionPendingReference` publicado
3. Worker agendado (`reprocessPendingReferences`) roda periodicamente
4. Tenta resolver referência por `(providerId, referenceExternalTransactionId)`
5. Valida: mesmo provider, player, wallet, moeda, rodada
6. TTL expirado (default 24h) → `REJECTED` com `REFERENCE_NOT_FOUND`

## Reconciliação

```
POST /wallets/:walletId/reconciliation
```

**Resposta:**
```json
{
  "walletId": "uuid",
  "storedBalance": { "amount": "975.00", "currency": "BRL" },
  "calculatedBalance": { "amount": "975.00", "currency": "BRL" },
  "difference": { "amount": "0.00", "currency": "BRL" },
  "consistent": true,
  "checkedEntries": 42
}
```

- Recalcula saldo somando ledger entries (ordem cronológica)
- Compara com `wallet.balance` materializado
- **Não corrige silenciosamente** — loga, métrica, sinaliza na resposta

## Testes

```bash
# Unitários (105 passando)
bun run test

# Integração (requer docker-compose up)
bun run test:e2e

# Cobertura
bun run test:cov
```

### Testes Obrigatórios Implementados

#### Unidade
- ✅ Money: operações, validações, escala, entradas inválidas
- ✅ Wallet: invariantes, debit/credit, concorrência
- ✅ WagerTransaction: state machine, transições, regras BET/WIN/LOSS/REFUND/ROLLBACK
- ✅ WalletLedgerEntry: imutabilidade, validação aritmética, reidratação

#### Integração (Pendentes - requer containers reais)
- Migrations e constraints
- Atomicidade wallet + ledger + inbox + outbox
- Inbox deduplication e redelivery
- Publishers concorrentes na outbox
- Retry, DLQ, crash recovery

#### Concorrência (Pendentes - requer containers reais)
- 50 apostas idênticas em paralelo → 1 débito
- Hot wallet: operações concorrentes no mesmo saldo
- Wallets distintas em paralelo
- ≥ 3 instâncias simultâneas
- Worker crash após commit, antes de ack
- 2 publishers na mesma outbox
- REFUND/ROLLBACK entregue antes da referência
- Reinício com consistência final

## Estrutura do Projeto

```
src/
├── app.module.ts              # Módulo raiz
├── main.ts                    # Bootstrap
├── app.controller.ts          # Health check root
├── domain/
│   ├── money.ts               # Value Object Money (imutável)
│   ├── money.spec.ts          # Testes Money
│   ├── enums.ts               # Enums de domínio
│   └── integration-event.ts   # Eventos de integração (outbox)
├── wallets/
│   ├── wallet.entity.ts       # Aggregate Root Wallet
│   ├── wallet.entity.spec.ts  # Testes Wallet
│   ├── wallets.service.ts
│   ├── wallets.controller.ts
│   ├── wallets.module.ts
│   └── dto/wallet.dto.ts
├── transactions/
│   ├── wager-transaction.entity.ts    # State Machine
│   └── wager-transaction.entity.spec.ts
├── ledger/
│   ├── wallet-ledger-entry.entity.ts  # Imutável
│   ├── wallet-ledger-entry.entity.spec.ts
│   └── dto/ledger-entry.dto.ts
├── wagering/
│   ├── wagering.service.ts      # Use case principal
│   ├── wagering.controller.ts   # Endpoints HTTP
│   ├── wagering.module.ts
│   └── dto/wagering.dto.ts
├── messaging/
│   ├── inbox-message.entity.ts      # Inbox pattern
│   ├── outbox-message.entity.ts     # Outbox pattern
│   ├── sqs-consumer.service.ts      # Consumer SQS
│   ├── outbox-publisher.service.ts  # Worker publisher
│   └── messaging.module.ts
└── health/
    └── health.controller.ts     # /health/live, /health/ready

migrations/
├── Migration20261008010212.ts   # Tabela wallets
└── Migration20261008020000.ts   # Tabelas wager_transactions, wallet_ledger_entries, inbox_messages, outbox_messages

test/
└── app.e2e-spec.ts              # E2E básico

explicacao.md                    # Decisões arquiteturais detalhadas
ARCHITECTURE.md                  # Architecture Decision Record
```

## Variáveis de Ambiente

```env
# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=wagering
DATABASE_USER=wagering
DATABASE_PASSWORD=wagering

# AWS / LocalStack
AWS_REGION=us-east-1
SQS_ENDPOINT=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
SQS_QUEUE_URL=http://localhost:4566/000000000000/wager-transactions.fifo
SQS_OUTBOX_QUEUE_URL=http://localhost:4566/000000000000/wagering-events.fifo

# App
PORT=3000
NODE_ENV=development
```

## Observabilidade

- **Logs:** JSON estruturado com `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId`
- **Métricas:** Prometheus (contadores, histogramas, gauges)
- **Health:** Liveness + Readiness separados
- **Sem dados sensíveis** em logs

## Autenticação

**Não implementada** (conforme seção 2 do desafio — não vale pontos).

Ponto de extensão explícito: `ProviderIdentityPort` interface para integrar IdP externo (Keycloak/Zitadel) futuramente. `AuthGuard` no-op incluído.

## Documentação

- `explicacao.md` — Decisões arquiteturais detalhadas (por que cada escolha)
- `ARCHITECTURE.md` — Architecture Decision Record formal

## Licença

UNLICENSED — Desafio técnico Jungle Gaming