# Explicação das Decisões Arquiteturais

## 1. Escolha do ORM: MikroORM

**Justificativa:** O desafio exige Unit of Work e Identity Map explícitos, `EntityManager.transactional()`, e `LockMode` para controle de concorrência. O MikroORM oferece:
- Unit of Work nativo com rastreamento de mudanças
- Identity Map para evitar duplicatas na mesma transação
- `em.transactional()` para transações automáticas com retry
- `LockMode.PESSIMISTIC_WRITE` para lock de linha no PostgreSQL (SELECT FOR UPDATE)
- Migrações versionadas e reversíveis

## 2. Modelo de Dinheiro (Money)

**Implementação:** Value Object imutável usando `decimal.js` para precisão arbitrária.

**Decisões:**
- `amount` armazenado como string decimal com escala fixa de 2 casas
- Validação rigorosa: rejeita NaN, Infinity, notação científica, mais de 2 casas decimais
- Operações retornam novas instâncias (imutabilidade)
- Comparação por valor (currency + amount)
- Persistido como `numeric(18,2)` no banco + coluna `currency` (char(3))

**Por que não `number`/`float`:** Ponto flutuante binário não representa exatamente valores decimais monetários (ex: 0.1 + 0.2 !== 0.3). Isso causaria erros de centavos em produção.

## 3. Wallet (Aggregate Root)

**Design:**
- Construtor privado + factories estáticas (`open`, `rehydrate`)
- `version` para optimistic locking (incrementa apenas quando saldo muda)
- Métodos `debit`/`credit` validam moeda e saldo negativo
- `rehydrate` não revalida regras de transição (apenas reconstrói estado)

**Concorrência:** Usamos **pessimistic locking** (`LockMode.PESSIMISTIC_WRITE`) no PostgreSQL via `SELECT FOR UPDATE` na wallet. Isso garante que apenas uma transação por vez modifica a wallet, evitando lost updates. O lock é liberado no commit/rollback da transação.

**Por que não optimistic locking apenas:** Em alta contenção (hot wallet), optimistic locking causaria muitos retries. Pessimistic locking serializa o acesso à wallet, que é a unidade de concorrência requerida.

## 4. WagerTransaction (State Machine)

**Estados:** PENDING → PROCESSED | REJECTED | FAILED | PENDING_REFERENCE
**Transições válidas:**
- PENDING → PROCESSED (sucesso)
- PENDING → REJECTED (regra de negócio)
- PENDING → FAILED (erro infraestrutura)
- PENDING → PENDING_REFERENCE (referência ausente)
- PENDING_REFERENCE → PROCESSED | REJECTED | FAILED

**Idempotência:** Chave única em `idempotency_key` + validação de `payload_hash` (SHA-256 de JSON canônico com chaves ordenadas). Mesma key + payload diferente = conflito (não replay).

## 5. WalletLedgerEntry (Imutável)

**Design:** Entidade sem campos mutáveis, sem métodos de transição. Factory `create` valida:
- `balanceBefore ± money === balanceAfter`
- Moedas consistentes
- Valor positivo

**Constraint única** em `transaction_id` garante no máximo 1 lançamento por transação por wallet.

## 6. Inbox Pattern (SQS Consumer)

**Implementação:** Tabela `inbox_messages` com unique constraint em `(consumer_name, message_id)`.
- Deduplicação persistente (sobrevive a restart)
- `ack` apenas após commit da transação financeira
- Processamento na mesma transação: inbox + wallet + ledger + outbox

**Classificação de erros:**
- Negócio (INSUFFICIENT_BALANCE, INVALID_REFERENCE) → terminal, ack
- Transitórios (DB lock, network) → retry com backoff
- Permanentes (payload inválido) → DLQ após max tentativas

## 7. Transactional Outbox

**Implementação:** Tabela `outbox_messages` com:
- `published_at` null = pendente
- `next_attempt_at` para agendamento com backoff exponencial + jitter
- Worker publica em lote com `SELECT FOR UPDATE SKIP LOCKED` (via `LockMode.PESSIMISTIC_WRITE`)
- Evento serializado no payload (JSON estável, versionado)

**Eventos mínimos:**
- `WagerTransactionProcessed` (toda transação aplicada)
- `WagerTransactionRejected` (rejeição por negócio)
- `WalletBalanceChanged` (apenas quando saldo muda)
- `WagerTransactionPendingReference` (referência ausente)

## 8. Processamento de Referências Fora de Ordem

**Fluxo:**
1. Transação chega sem referência → status `PENDING_REFERENCE`
2. Evento `WagerTransactionPendingReference` publicado
3. Worker agendado (`reprocessPendingReferences`) roda periodicamente
4. Tenta resolver referência; se encontrar, processa normalmente
5. Se TTL esgotado → `REJECTED` com `REFERENCE_NOT_FOUND`

## 9. Reconciliação

**Endpoint:** `POST /wallets/:walletId/reconciliation`
- Recalcula saldo somando ledger entries (ordem cronológica)
- Compara com `wallet.balance` materializado
- Retorna diferença, consistência, entries verificados
- Não corrige silenciosamente — loga, métrica, sinaliza na resposta

## 10. Health Checks

- `GET /health/live` — processo vivo (sempre ok)
- `GET /health/ready` — PostgreSQL e SQS alcançáveis

## 11. Observabilidade (IMPLEMENTADA)

### 11.1 Logs Estruturados JSON
**Implementação:** `src/observability/logger.service.ts` - `StructuredLoggerService` usando `pino`
- Campos obrigatórios: `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId`
- Níveis: info, warn, error, debug, trace
- Contexto automático via `CorrelationIdInterceptor` (header `x-correlation-id` ou gerado)
- **Sem dados sensíveis** nos logs (payloads financeiros completos, PII)

**Por que pino:** Performance superior a winston/bunyan, suporte nativo a JSON, child loggers para contexto hierárquico.

### 11.2 Métricas Prometheus
**Implementação:** `src/observability/metrics.service.ts` - `MetricsService` usando `prom-client`
- **Contadores:** `wagering_transactions_total{status,kind}`, `wagering_idempotent_replays_total`, `wagering_retries_total{type}`, `wagering_dlq_messages_total`, `wagering_lock_conflicts_total`
- **Gauges:** `wagering_outbox_lag_seconds`, `wagering_wallet_balance{wallet_id,currency}`, `wagering_pending_references`
- **Histogram:** `wagering_processing_duration_seconds{kind}` (buckets: 10ms-5s)
- **Endpoint:** `GET /metrics` expõe formato Prometheus

**Por que prom-client:** Biblioteca padrão Prometheus para Node.js, suporte nativo a labels, histograms com buckets configuráveis.

### 11.3 Health Checks
- `GET /health/live` — processo vivo (sempre 200)
- `GET /health/ready` — verifica PostgreSQL (SELECT 1) + SQS (ReceiveMessage dry-run)

## 12. Testes (IMPLEMENTADOS)

### 12.1 Testes Unitários (105 passando)
- **Money:** construção, validação, aritmética, comparação, serialização (32 testes)
- **Wallet:** open, rehydrate, credit, debit, invariantes, encapsulamento (27 testes)
- **WagerTransaction:** state machine, transições, regras BET/WIN/LOSS/REFUND/ROLLBACK (31 testes)
- **WalletLedgerEntry:** criação, validação, imutabilidade, reidratação (12 testes)
- **AppController:** health check básico

### 12.2 Testes de Integração (e2e)
**Arquivo:** `test/integration.e2e-spec.ts` - PostgreSQL + LocalStack reais em containers
- Criação de wallet com saldo inicial
- Processamento de todos os tipos: BET, WIN, LOSS, REFUND, ROLLBACK
- Idempotência: replay idempotente, conflito de payload
- REFUND/ROLLBACK com validação de referência
- Reconciliação consistente
- Paginação de ledger com cursor
- Lookup por provider + externalTransactionId
- Health checks (live/ready)
- Endpoint `/metrics` expõe contadores

### 12.3 Testes de Concorrência
**Arquivo:** `test/concurrency.e2e-spec.ts` - paralelismo real (não mocks sequenciais)
1. **50 apostas idênticas em paralelo** → exatamente 1 débito, 49 rejeitadas, saldo final correto
2. **Hot wallet:** BETs e WINs concorrentes na mesma wallet → consistência mantida
3. **Wallets paralelas:** 10 wallets processadas independentemente
4. **≥3 instâncias simuladas:** múltiplos EntityManagers com pessimistic locking → 1 sucesso
5. **Crash recovery:** worker morre após commit, antes de ack → dados persistem após restart
6. **Dual publishers:** publishers concorrentes na outbox → sem duplicação de eventos
7. **Out-of-order REFUND/ROLLBACK:** REFUND chega antes do BET → PENDING_REFERENCE → reprocessado
8. **Restart consistency:** `wallet.balance == saldo reconstruído pelo ledger` após restart

## 13. Autenticação (Extension Point Implementado)

**Decisão:** No-op `AuthGuard` com ponto de extensão explícito (conforme seção 2 do desafio — autenticação não vale pontos).

**Implementação:**
- `src/auth/noop-auth.guard.ts` - `NoOpAuthGuard` implementa `CanActivate`, retorna `true` sempre, anexa `providerIdentity: { providerId: 'anonymous', claims: {} }` no request
- `src/auth/provider-identity.port.ts` - `ProviderIdentityPort` interface para futuro IdP externo (Keycloak/Zitadel):
  ```typescript
  interface ProviderIdentityPort {
    validateToken(token: string): Promise<ProviderIdentity | null>;
    extractTokenFromRequest(request: any): string | null;
  }
  ```
- `PROVIDER_IDENTITY_PORT` token para injeção de dependência
- `AuthModule` global exporta guard e token

**Por que não implementar auth completo:** Seção 2 do desafio diz "autenticação não vale pontos... não deve competir com correção financeira, concorrência e idempotência". Ponto de extensão documentado para integração futura.

## 14. Docker Compose

- PostgreSQL 16 + healthcheck
- LocalStack (SQS) + healthcheck
- `sqs-init` cria filas FIFO com DLQ:
  - `wager-transactions.fifo` + `wager-transactions-dlq.fifo` (maxReceiveCount=5)
  - `wagering-events.fifo` + `wagering-events-dlq.fifo` (maxReceiveCount=5)
  - Content-based deduplication habilitado
- App roda migrações na inicialização

## 15. Graceful Shutdown (IMPLEMENTADO)

### 15.1 SQS Consumer (`src/messaging/sqs-consumer.service.ts`)
- `inFlightMessages` Set rastreia receiptHandles em processamento
- `SIGTERM`/`SIGINT` handlers iniciam shutdown
- Para de fazer poll, aguarda até 30s por mensagens em voo
- Timeout: retorna visibilidade (ChangeMessageVisibility=0) para redelivery
- `onModuleDestroy` aguarda conclusão

### 15.2 Outbox Publisher (`src/messaging/outbox-publisher.service.ts`)
- `inFlightPublishing` contador de publicações simultâneas
- Mesmo padrão de signal handlers
- Timeout 15s (publicação é mais rápida)

**Por que não apenas `onModuleDestroy`:** NestJS não garante ordem de destruição; signal handlers explícitos garantem shutdown coordenado antes do processo morrer.

## 16. Scheduler de Reprocessamento (IMPLEMENTADO)

**Implementação:** `src/scheduler/reference-reprocessor.scheduler.ts`
- `@Cron(CronExpression.EVERY_30_SECONDS)` chama `WageringService.reprocessPendingReferences()`
- Log estruturado de início/fim/contagem
- Métrica `wagering_pending_references` gauge atualizado

**Por que cron e não worker dedicado:** Simplicidade operacional; o reprocessamento é leve (query + transações curtas). Se volume crescer, pode migrar para worker separado.

## 17. Endpoints HTTP Faltantes (IMPLEMENTADOS)

| Endpoint | Implementação |
|----------|---------------|
| `GET /wagering/transactions/:transactionId` | `WageringController.getTransaction` - busca por ID interno |
| `GET /providers/:providerId/wagering/transactions/:externalTransactionId` | `ProviderTransactionController.getByProviderAndExternalId` - lookup composto |
| `GET /wallets/:walletId/ledger?cursor&limit` | `WalletReconciliationController.getLedger` - cursor-based pagination (opaco, estável) |

**Cursor pagination:** usa `createdAt` como cursor (ISO-8601), retorna `nextCursor` para próxima página. Limite máximo 100.

## 18. Failure Code Taxonomy (DOCUMENTADA)

**Seção 8 do ARCHITECTURE.md:** 13 códigos com cenário, HTTP status, retryable

| Código | Cenário | HTTP | Retryable |
|--------|---------|------|-----------|
| `INSUFFICIENT_BALANCE` | BET excede saldo | 400 | Não |
| `REFERENCE_NOT_FOUND` | TTL referência expirado | 400 | Não |
| `REFERENCE_ALREADY_REVERSED` | Duplo refund/rollback | 400 | Não |
| `REFERENCE_INCORRECT_AMOUNT` | Valor divergente | 400 | Não |
| `REFERENCE_INCORRECT_PLAYER` | Player divergente | 400 | Não |
| `REFERENCE_INCORRECT_CURRENCY` | Moeda divergente | 400 | Não |
| `REFERENCE_INCORRECT_ROUND` | Round divergente | 400 | Não |
| `REFERENCE_INCORRECT_PROVIDER` | Provider divergente | 400 | Não |
| `REFERENCE_NOT_TERMINAL` | Referência não PROCESSED | 400 | Não |
| `INVALID_PAYLOAD` | Falha validação | 400 | Não |
| `CURRENCY_MISMATCH` | Wallet vs transação moeda | 400 | Não |
| `NEGATIVE_AMOUNT` | Valor negativo | 400 | Não |
| `INTERNAL_ERROR` | Falha infraestrutura | 500 | Sim |

## 19. Decisões de Trade-off (ATUALIZADA)

| Decisão | Trade-off | Justificativa |
|---------|-----------|---------------|
| Pessimistic locking | Menor throughput em hot wallet | Correção garantida, sem retries infinitos |
| Inbox table | +1 write por mensagem | Garantia de idempotência persistente |
| Outbox table | +1 write + worker separado | Atomicidade financeira + evento (não pode publicar antes do commit) |
| decimal.js | Dependência extra | Precisão monetária correta |
| SHA-256 payload hash | CPU para hash | Detecção de conflito de idempotência key |
| Logs estruturados (pino) | Curva de aprendizado | Performance + JSON nativo + child loggers |
| Métricas (prom-client) | Dependência | Padrão Prometheus, labels, histograms |
| Graceful shutdown | Complexidade | Requisito seção 10: worker morre após commit |
| Scheduler cron | Precisão de 30s | Simplicidade; suficiente para TTL 24h |
| No-op Auth | Gap segurança prod | Seção 2: auth não vale pontos; extension point documentado |

## 20. Próximos Passos (Opcionais)

1. **Load Testing:** `bun run test:load` com k6/artillery (p50/p95/p99, throughput, conflitos, outbox lag)
2. **Tracing:** OpenTelemetry distributed tracing
3. **Dashboard:** Grafana dashboards para métricas
4. **Partitioning:** Wallet sharding para escala horizontal
5. **Audit Log:** Tabela imutável separada para compliance
6. **Admin API:** Correção manual de reconciliação com audit trail
7. **Auth Real:** Integração Keycloak/Zitadel via `ProviderIdentityPort`

## 21. Melhorias Implementadas (Pós-Análise)

### 21.1 Transação OPENING na Criação de Wallet (Seção 9)
**Implementado:** `WalletsService.create()` agora aceita `initialBalance` opcional e cria transação `OPENING` + lançamento no ledger na mesma transação SQL.

**Por que:** Requisito da seção 9: "O saldo inicial, quando maior que zero, gera uma transação interna OPENING na mesma transação SQL, com lançamento CREDIT correspondente no ledger."

### 21.2 HTTP 202 para PENDING_REFERENCE (Seção 9)
**Implementado:** Controller retorna HTTP 202 Accepted quando transação fica em `PENDING_REFERENCE`.

**Por que:** Requisito da seção 9: "aceite com processamento pendente" deve ser distinguido de sucesso imediato. 202 é o código semântico correto para "aceito mas processamento assíncrono".

### 21.3 Cursor Opaque em Base64 (Seção 9)
**Implementado:** `getWalletLedger` codifica/decodifica cursor como base64 (ISO-8601 → base64).

**Por que:** Requisito da seção 9: "cursor estável e opaco". Base64 oculta a estrutura interna (timestamp) e garante estabilidade mesmo se formato interno mudar.

### 21.4 Validação Estrita de Idempotency-Key (Seção 9)
**Implementado:** Validação de formato `providerId:externalTransactionId` com regex `^[a-zA-Z0-9_-]+$` para cada parte.

**Por que:** Requisito da seção 9: "default recomendado: `'{providerId}:{externalTransactionId}'`" e "o algoritmo deve estar documentado". Validação estrita previne chaves malformadas e garante consistência.