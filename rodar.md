# Como Rodar o Projeto

## Pré-requisitos

| Ferramenta | Versão |
|---|---|
| Docker + Docker Compose | 2.0+ |
| Bun | 1.x (https://bun.sh) |

> Node.js 18+ é alternativa, mas Bun é a runtime preferida pelo desafio.

---

## 1. Subir tudo com Docker (recomendado)

```bash
docker compose up -d
```

- **PostgreSQL** na porta `5432`
- **LocalStack** (SQS) na porta `4566`
- **App** na porta `3000`
- Migrations e filas SQS são inicializadas **automaticamente** pelo entrypoint do container.

**Verificar:**
```bash
docker compose ps
# Todos os containers devem estar "healthy"
```

**Parar:**
```bash
docker compose down -v    # inclui limpeza de volumes
# ou apenas:
docker compose down
```

---

## 2. Desenvolvimento local

### 2.1 Subir apenas a infraestrutura

```bash
docker compose up -d postgres localstack

bun install                     # instalar dependências

bun run migration:up           # criar tabelas no banco
bun run start:dev               # iniciar API em modo watch (http://localhost:3000)
```

### 2.2 Comandos úteis

| Comando | Ação |
|---|---|
| `bun run start:dev` | Iniciar API em watch mode |
| `bun run start:debug` | Iniciar com debugger |
| `bun run start:prod` | Iniciar em modo produção (arquivo compilado) |
| `bun test` | Rodar testes unitários (105 testes) |
| `bun run lint` | Verificar código com oxlint |
| `bun run build` | Compilar TypeScript para `dist/` |
| `bunx mikro-orm migration:up` | Aplicar migrations |
| `bunx mikro-orm migration:down` | Reverter última migration |
| `bunx mikro-orm migration:list` | Listar migrations aplicadas |
| `bunx mikro-orm migration:create` | Criar nova migration |

---

## 3. Testes

### Testes unitários
```bash
bun test
# ou: bunx vitest run
```

### Testes e2e (integração + concorrência)
```bash
bun run test:e2e
```
> Requer PostgreSQL + LocalStack em containers.

### Teste de carga
```bash
bun run test:load
# Configurações via env:
# LOAD_TEST_DURATION=60  LOAD_TEST_CONCURRENCY=10  bun run test:load
```

---

## 4. Variáveis de ambiente

```env
# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=wagering
DATABASE_USER=wagering
DATABASE_PASSWORD=wagering

# AWS / LocalStack
AWS_REGION=us-east-1
AWS_ENDPOINT_URL=http://localhost:4566
SQS_ENDPOINT=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
SQS_QUEUE_URL=http://localhost:4566/000000000000/wager-transactions.fifo
SQS_OUTBOX_QUEUE_URL=http://localhost:4566/000000000000/wagering-events.fifo

# Application
PORT=3000
NODE_ENV=development
```

> No container, `AWS_ENDPOINT_URL` é usado pelo LocalStack; fora do container, use `SQS_ENDPOINT`.

---

## 5. Endpoints da API

### Health
```bash
curl http://localhost:3000/health/live     # processo vivo
curl http://localhost:3000/health/ready     # DB + SQS prontos
```

### Wallet
```bash
# Criar wallet
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -d '{"playerId":"player-1","initialBalance":{"amount":"1000.00","currency":"BRL"}}'

# Buscar wallet
curl http://localhost:3000/wallets/{walletId}

# Listar wallets
curl http://localhost:3000/wallets

# Reconciliar
curl -X POST http://localhost:3000/wallets/{walletId}/reconciliation

# Ver ledger
curl http://localhost:3000/wallets/{walletId}/ledger?cursor=&limit=50
```

### Transações
```bash
# Submeter transação (BET)
curl -X POST http://localhost:3000/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: provider-a:tx-123" \
  -d '{"providerId":"provider-a","externalTransactionId":"tx-123","playerId":"player-1","walletId":"{WALLET_ID}","roundId":"round-1","gameId":"game-1","kind":"BET","money":{"amount":"50.00","currency":"BRL"}}'

# Buscar transação por ID
curl http://localhost:3000/wagering/transactions/{transactionId}

# Buscar transação por provider + externalId
curl http://localhost:3000/providers/provider-a/wagering/transactions/tx-123
```

### Métricas (Prometheus)
```bash
curl http://localhost:3000/metrics
```

---

## 6. Filas SQS

| Fila | Uso | DLQ |
|---|---|---|
| `wager-transactions.fifo` | Entrada de transações de apostas | `wager-transactions-dlq.fifo` |
| `wagering-events.fifo` | Eventos de integração (outbox) | `wagering-events-dlq.fifo` |

Todas as filas são criadas automaticamente pelo `scripts/init-queues.ts` no startup do container.

---

## 7. Logs

```bash
# Seguir logs da aplicação
docker compose logs -f app

# Seguir logs do banco
docker compose logs -f postgres

# Ver logs de migração
docker compose logs migrations
```

**Formato:** JSON estruturado (pino) com campos `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId`.
