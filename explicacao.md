# Explicação das Implementações

**Data de início:** 2026-10-08  
**Última atualização:** 2026-10-08 22:02 UTC  
**Contexto:** Backend Challenge - Processador de Transações Financeiras  
**Status:** ~20% implementado - Base de domínio e API inicial prontos

---

## 📋 Resumo Executivo

### O que está funcionando agora

**Domínio Financeiro (núcleo):**
- ✅ `Money` - Value Object imutável com `decimal.js` (precisão arbitrária)
- ✅ `Wallet` - Entidade encapsulada com factories e operações protegidas
- ✅ `WagerTransaction` - Entidade com status, transições e validações
- ✅ Enums completos: `WagerTransactionKind`, `WagerTransactionStatus`, `FailureCode`, `LedgerDirection`

**Infraestrutura:**
- ✅ MikroORM configurado com PostgreSQL
- ✅ Migrations versionadas e reversíveis (1 migration aplicada: wallets)
- ✅ Docker Compose completo: PostgreSQL + LocalStack + SQS + Aplicação
- ✅ Dockerfile multi-stage otimizado

**API REST:**
- ✅ `POST /wallets` - Criar wallet
- ✅ `GET /wallets/:id` - Buscar por ID  
- ✅ `GET /wallets` - Listar todas
- ✅ Validação global com `class-validator`
- ✅ Tratamento de erros (409, 404, 400)

**Testes:**
- ✅ 93 testes unitários passando (Money: 37, Wallet: 25, WagerTransaction: 31)
- ✅ Build, lint, typecheck validados

### Como executar agora

**Opção 1: Docker Compose (recomendado para testes completos)**
```bash
docker compose up --build
# Aguardar ~2-3min no primeiro build
# API disponível em http://localhost:3000
```

**Opção 2: Local (desenvolvimento)**
```bash
# Terminal 1
docker compose up -d postgres localstack

# Terminal 2
npm run migration:up
npm run start:dev
```

**Testar com curl:**
```bash
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -d '{"playerId":"player-001","currency":"USD"}'
```

### O que ainda falta (~80%)

**CRÍTICO (eliminatórios):**
1. `WalletLedgerEntry` - Auditoria imutável
2. `InboxMessage` + `OutboxMessage` - Atomicidade transacional
3. Migrations: transactions, ledger, inbox, outbox
4. Use cases com locks e idempotência
5. Endpoints: transações, ledger, reconciliação, health
6. SQS Consumer + Outbox Publisher workers
7. Testes de integração/concorrência

**Decisões técnicas principais:**
- **Decimal.js**: Elimina erros de float (0.1 + 0.2 = 0.3 exato)
- **Encapsulamento**: Propriedades protegidas, operações via métodos
- **Factories**: Construtores privados garantem estado válido
- **Migrations explícitas**: Constraint `CHECK (balance >= 0)` no banco
- **Multi-stage Docker**: Builder + runner = imagem otimizada

---

## 1. Configuração do MikroORM com PostgreSQL

### O que foi feito

- Instalação e configuração do MikroORM 7.2.4 com driver PostgreSQL
- Criação de `mikro-orm.config.ts` centralizado para CLI e aplicação
- Integração com NestJS via `MikroOrmModule.forRootAsync()`
- Configuração do Migrator com suporte a TypeScript/JavaScript
- Scripts npm para `migration:create`, `migration:up`, `migration:down` e `migration:list`
- Migration inicial reversível da tabela `wallets` com constraints

### Por que essas escolhas ajudam

**Separação de configuração:** O arquivo `mikro-orm.config.ts` é usado tanto pelo CLI quanto pela aplicação, evitando duplicação e inconsistências. Isso garante que migrations e runtime usem exatamente as mesmas configurações de conexão e entidades.

**Migrations versionadas e reversíveis:** Cada migration possui `up()` e `down()`, permitindo aplicar e reverter mudanças de schema de forma controlada. Isso é essencial para:
- Deploys seguros com rollback
- Desenvolvimento em equipe sem conflitos de schema
- Auditoria de mudanças estruturais no banco

**Constraints no banco:** A migration inclui `CHECK (balance >= 0)` diretamente no PostgreSQL, criando uma barreira adicional contra saldo negativo mesmo se houver falha na camada de aplicação. Isso implementa defesa em profundidade.

**Conversão segura de porta:** O código converte `DATABASE_PORT` de string para número com `Number.parseInt()` e validação `Number.isNaN()`, evitando falhas silenciosas quando variáveis de ambiente chegam como string.

---

## 2. Value Object `Money`

### O que foi feito

Implementação de `Money` como Value Object imutável (`src/domain/money.ts`) com:

- Construtor privado e factories `fromString()`, `fromNumber()` e `zero()`
- Armazenamento interno como **string decimal** com escala fixa de 2 casas
- **Operações aritméticas via `decimal.js`** (biblioteca de precisão arbitrária)
- Validação estrita de moeda (ISO 4217: 3 letras maiúsculas)
- Operações aritméticas seguras: `add()`, `subtract()`
- Comparações: `isPositive()`, `isZero()`, `isNegative()`, `isGreaterThan()`, etc.
- Proteção contra mistura de moedas
- Imutabilidade garantida via `Object.freeze()`
- Serialização para JSON como `{ amount: string, currency: string }`
- 37 testes unitários cobrindo todos os cenários

### Por que essas escolhas ajudam

**⚠️ CORREÇÃO CRÍTICA (2026-10-08):** A implementação inicial usava `parseFloat()` para operações aritméticas, o que era uma **violação eliminatória** do README copy.md (seção 5.1 e 6.1). Foi substituído por `decimal.js`, uma biblioteca de precisão arbitrária que elimina completamente erros de arredondamento de ponto flutuante.

**Decimal.js em vez de parseFloat:** A biblioteca `decimal.js` implementa aritmética decimal de precisão arbitrária:

```typescript
// ANTES (ELIMINATÓRIO):
const result = (parseFloat(this.amount) + parseFloat(other.amount)).toFixed(2);

// DEPOIS (CORRETO):
const result = new Decimal(this.amount)
  .add(new Decimal(other.amount))
  .toFixed(2);
```

**Benefícios da biblioteca Decimal:**
- **Precisão perfeita:** Não sofre dos erros de IEEE 754 float (0.1 + 0.2 ≠ 0.3)
- **Operações seguras:** `add()`, `sub()`, `greaterThan()`, `lessThan()`, etc.
- **Validação interna:** A biblioteca detecta valores inválidos e NaN
- **Performance adequada:** Otimizada para casos financeiros comuns
- **Conformidade:** Atende explicitamente o requisito do README de não usar float/double

**Imutabilidade elimina bugs:** Uma vez criado, um objeto `Money` nunca muda. Isso previne:
- Modificação acidental de valores durante processamento
- Race conditions em contextos concorrentes
- Surpresas ao passar valores entre funções

**String decimal como representação:** O valor é armazenado como `string` (ex: `"10.50"`) e convertido para `Decimal` apenas durante operações. Isso garante:
- Serialização/deserialização sem perda de precisão
- Compatibilidade com PostgreSQL `numeric(18,2)`
- Representação legível e auditável

**Validação centralizada:** Toda criação de `Money` passa por validação. Não é possível criar dinheiro inválido:
- Moeda deve ser 3 letras maiúsculas (USD, EUR, BRL)
- Amount deve ter no máximo 2 casas decimais
- Normalização automática: `"10.5"` vira `"10.50"`

**Proteção de domínio:** Não é possível somar USD com EUR. O sistema falha explicitamente:
```typescript
usd.add(eur) // throw Error('Currency mismatch: USD vs EUR')
```

Isso previne erros financeiros catastróficos.

**Type safety:** TypeScript força você a usar `Money` em vez de `number` nas assinaturas. Não é possível passar `10.50` onde se espera `Money`:
```typescript
wallet.credit(10.50)           // ❌ erro de compilação
wallet.credit(Money.fromString('10.50', 'USD')) // ✅ correto
```

---

## 3. Refatoração de `Wallet` para Domínio Rico

### O que foi feito

Transformação da entidade `Wallet` (`src/wallets/wallet.entity.ts`) de anêmica para rica:

**Antes (anêmica):**
```typescript
class Wallet {
  id = randomUUID();
  playerId!: string;
  currency!: string;
  balance = '0.00';  // público, mutável, sem validação
}
```

**Depois (rica):**
```typescript
class Wallet {
  protected readonly _id: string;
  protected readonly _playerId: string;
  protected readonly _currency: string;
  protected _balance: string;

  private constructor(...) { }
  
  static open(playerId: string, currency: string): Wallet
  static rehydrate(...): Wallet
  
  credit(amount: Money): Money
  debit(amount: Money): Money
  getBalance(): Money
}
```

### Por que essas escolhas ajudam

**Construtor privado + factories:** Não é possível criar `Wallet` com `new Wallet()`. Você deve usar:
- `Wallet.open()` para nova wallet (sempre com saldo zero)
- `Wallet.rehydrate()` para reconstruir do banco

Isso garante que toda wallet passa por validação e tem estado inicial consistente.

**Encapsulamento total:** Todas as propriedades são `protected` com underscore. O acesso externo é apenas via getters readonly:
```typescript
wallet.playerId          // ✅ leitura permitida
wallet._playerId = 'x'   // ❌ TypeScript bloqueia
```

**Operações explícitas:** Para mudar o saldo, você **deve** usar `credit()` ou `debit()`:
```typescript
wallet._balance = '999.99'  // ❌ TypeScript bloqueia
wallet.credit(Money.fromString('100.00', 'USD'))  // ✅ único caminho
```

**Validações de negócio na entidade:**

- `credit()` rejeita valores negativos ou zero
- `debit()` rejeita valores negativos, zero ou que causem saldo negativo
- Ambos rejeitam moeda diferente da wallet
- Operações retornam o novo saldo como `Money`

**Proteção contra saldo negativo:**
```typescript
wallet.debit(Money.fromString('100.00', 'USD'))
// Se saldo < 100, lança: Error('Insufficient balance')
```

Isso implementa a invariante mais crítica do sistema.

**Imutabilidade de identificadores:** `playerId`, `currency` e `id` são `readonly`. Uma vez criada, a wallet não pode mudar de jogador ou moeda. Isso previne bugs de identidade.

**Integração com `Money`:** `getBalance()` retorna `Money`, não string. Isso força o resto do sistema a usar operações seguras:
```typescript
const balance = wallet.getBalance()
const newBalance = balance.add(Money.fromString('50.00', 'USD'))
```

**62 testes unitários** validam todas as regras, incluindo:
- Criação válida e inválida
- Crédito/débito com validações
- Proteção contra moeda errada
- Precisão decimal
- Imutabilidade

---

## 4. Estratégia de Testes

### O que foi feito

- Vitest como test runner (compatível com stack moderna)
- Testes unitários puros (sem banco, sem IO)
- Cobertura de casos válidos, inválidos, edge cases e cenários complexos
- Asserções explícitas de comportamento esperado

### Por que essas escolhas ajudam

**Feedback rápido:** Testes unitários executam em ~1.5s. Isso permite TDD e refatoração confiante.

**Documentação viva:** Os testes descrevem exatamente como usar `Money` e `Wallet`:
```typescript
it('should reject debit causing negative balance', () => {
  const wallet = Wallet.open('player-123', 'USD');
  wallet.credit(Money.fromString('50.00', 'USD'));
  
  expect(() => wallet.debit(Money.fromString('60.00', 'USD')))
    .toThrow('Insufficient balance');
});
```

**Regressão zero:** Ao adicionar novas features, os 62 testes garantem que nada quebrou.

**Design melhor:** Escrever testes força você a pensar na API pública. Se é difícil testar, o design está ruim.

---

## 5. Benefícios para o Projeto de Challenge

### Correção Financeira

- **Precisão decimal garantida** via string e `.toFixed(2)`
- **Saldo negativo impossível** via validação na entidade e constraint no banco
- **Moeda sempre válida e consistente** via validação ISO 4217
- **Operações protegidas** contra mistura de moedas

### Preparação para Concorrência

Embora a implementação de locks ainda não exista, o design já suporta:

- **Versão otimista** via `@Property({ version: true })`
- **Estado encapsulado** permite adicionar lock pessimista sem quebrar contratos
- **Operações atômicas** (credit/debit) facilitam transações SQL envolvendo wallet + ledger

### Manutenibilidade

- **Domínio explícito:** `Money` e `Wallet` expressam conceitos de negócio, não detalhes técnicos
- **Testes como especificação:** qualquer desenvolvedor entende as regras lendo os testes
- **Migrations versionadas:** histórico completo de mudanças de schema
- **Type safety:** TypeScript detecta erros em tempo de compilação

### Extensibilidade

- **Novos métodos fáceis:** adicionar `Wallet.freeze()` ou `Money.multiply()` é direto
- **Novas moedas:** basta respeitar ISO 4217, nada mais
- **Novos campos:** migrations suportam evolução incremental

### Alinhamento com Requisitos

O README copy.md exige:

> "Money imutável, string decimal escala 2, moeda, validação, operações seguras"

✅ Implementado integralmente.

> "Wallet encapsulada, factories open/rehydrate, métodos de crédito/débito, proteção de saldo"

✅ Implementado integralmente.

> "Migrations versionadas e reversíveis"

✅ Implementado com `up()`/`down()` e scripts npm.

> "Constraints no banco para não-negatividade"

✅ `CHECK (balance >= 0)` na migration.

---

## Próximos Passos

1. **`WagerTransaction`**: entidade com status, transições, validações BET/WIN/LOSS/REFUND/ROLLBACK, hash de payload e chave de idempotência
2. **`WalletLedgerEntry`**: entidade imutável de auditoria com `balanceBefore`/`balanceAfter` e validação aritmética
3. **Migrations completas**: tabelas de transações, ledger, inbox e outbox com FKs e constraints
4. **Use case transacional**: `EntityManager.transactional()` com lock por wallet e atomicidade wallet+ledger+inbox+outbox
5. **API HTTP**: endpoints com DTOs, `Idempotency-Key`, mapeamento de erros e health checks
6. **SQS/Inbox/Outbox**: integração real com AWS SDK, consumer, publisher, retry/DLQ e workers
7. **Testes de integração**: PostgreSQL e LocalStack reais, cenários de concorrência multiprocesso

---

## Conclusão

As implementações atuais estabelecem uma **base sólida e correta** para o processador financeiro:

- **Correção** via validações e imutabilidade
- **Clareza** via domínio rico e testes
- **Segurança** via encapsulamento e type safety
- **Evolução** via migrations e extensibilidade

O código está pronto para receber as próximas camadas (transações, API, mensageria) sem precisar refatorar o núcleo financeiro.

---

## Histórico de Mudanças

### 2026-10-08 22:01 - Docker Compose Completo com Aplicação

**O que foi implementado:**
1. `Dockerfile` multi-stage para produção:
   - Stage builder: compila TypeScript
   - Stage runner: apenas runtime e dependências de produção
   - Imagem otimizada baseada em `node:22-alpine`

2. `docker-compose.yml` completo com 5 serviços:
   - `postgres`: PostgreSQL 16 com healthcheck
   - `localstack`: AWS SQS local
   - `sqs-init`: Provisiona filas FIFO + DLQ
   - `app`: Aplicação NestJS com migrations automáticas
   - Rede isolada `backend-network`

3. `.dockerignore`: Otimiza build excluindo `node_modules`, `dist`, logs

**Como usar:**

**Subir todo o sistema:**
```bash
docker compose up --build
```

Isso irá:
1. Construir a imagem da aplicação
2. Subir PostgreSQL e aguardar health check
3. Subir LocalStack e criar filas SQS
4. Executar migrations automaticamente
5. Iniciar a aplicação na porta 3000

**Testar a API:**
```bash
# Criar wallet
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -d '{"playerId":"player-docker","currency":"BRL"}'

# Listar wallets
curl http://localhost:3000/wallets
```

**Ver logs da aplicação:**
```bash
docker compose logs -f app
```

**Ver logs do PostgreSQL:**
```bash
docker compose logs -f postgres
```

**Parar todos os serviços:**
```bash
docker compose down
```

**Limpar volumes (reset completo do banco):**
```bash
docker compose down -v
```

**Características do setup:**
- ✅ Migrations executam automaticamente no startup
- ✅ Health checks garantem ordem de inicialização
- ✅ Restart automático da app se crashar (`restart: unless-stopped`)
- ✅ Rede isolada para comunicação entre serviços
- ✅ Volumes persistentes para PostgreSQL
- ✅ Build otimizado com multi-stage (reduz tamanho da imagem)
- ✅ Variáveis de ambiente configuradas para conectar serviços

**Troubleshooting:**

Se a aplicação não subir:
```bash
# Ver logs detalhados
docker compose logs app

# Verificar saúde dos serviços
docker compose ps

# Recriar do zero
docker compose down -v
docker compose up --build
```

**Arquivos criados:**
- `Dockerfile`: Imagem multi-stage da aplicação
- `docker-compose.yml`: Orquestração completa (atualizado)
- `.dockerignore`: Otimização de build

**Próxima prioridade:** Implementar `WalletLedgerEntry` para completar o domínio financeiro com auditoria.

---

### 2026-10-08 21:58 - API REST Básica para Testes

**O que foi implementado:**
1. Módulo completo de Wallets (`src/wallets/`):
   - `WalletsService`: lógica de negócio com validação de duplicatas
   - `WalletsController`: endpoints REST
   - `WalletsModule`: integração com MikroORM
   - DTOs com validação via `class-validator`

2. Endpoints disponíveis:
   - `POST /wallets` - Criar nova wallet
   - `GET /wallets/:id` - Buscar wallet por ID
   - `GET /wallets` - Listar todas as wallets

3. Validação global ativada no `main.ts`:
   - `whitelist: true` - Remove propriedades não declaradas
   - `forbidNonWhitelisted: true` - Rejeita propriedades extras
   - `transform: true` - Converte tipos automaticamente

**Arquivos criados/modificados:**
- `src/wallets/wallets.service.ts`: Service com EntityManager
- `src/wallets/wallets.controller.ts`: Controller REST
- `src/wallets/wallets.module.ts`: Módulo NestJS
- `src/wallets/dto/wallet.dto.ts`: DTOs de request/response
- `src/main.ts`: ValidationPipe global
- `src/app.module.ts`: Import do WalletsModule
- `package.json`: Dependências `class-validator` e `class-transformer`

**Como testar no Postman:**

**Passo 1: Iniciar infraestrutura**
```bash
# Terminal 1: Subir PostgreSQL
docker compose up -d postgres

# Terminal 2: Iniciar aplicação
npm run start:dev
```

A aplicação estará disponível em `http://localhost:3000`

**Passo 2: Criar uma wallet (POST /wallets)**
```
POST http://localhost:3000/wallets
Content-Type: application/json

{
  "playerId": "player-123",
  "currency": "USD"
}
```

**Resposta esperada (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "playerId": "player-123",
  "currency": "USD",
  "balance": {
    "amount": "0.00",
    "currency": "USD"
  },
  "version": 1,
  "createdAt": "2026-10-08T01:58:00.000Z",
  "updatedAt": "2026-10-08T01:58:00.000Z"
}
```

**Passo 3: Buscar wallet por ID (GET /wallets/:id)**
```
GET http://localhost:3000/wallets/550e8400-e29b-41d4-a716-446655440000
```

**Resposta esperada (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "playerId": "player-123",
  "currency": "USD",
  "balance": {
    "amount": "0.00",
    "currency": "USD"
  },
  "version": 1,
  "createdAt": "2026-10-08T01:58:00.000Z",
  "updatedAt": "2026-10-08T01:58:00.000Z"
}
```

**Passo 4: Listar todas as wallets (GET /wallets)**
```
GET http://localhost:3000/wallets
```

**Resposta esperada (200 OK):**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "playerId": "player-123",
    "currency": "USD",
    "balance": {
      "amount": "0.00",
      "currency": "USD"
    },
    "version": 1,
    "createdAt": "2026-10-08T01:58:00.000Z",
    "updatedAt": "2026-10-08T01:58:00.000Z"
  }
]
```

**Cenários de erro para testar:**

**Erro 1: Validação de currency (400 Bad Request)**
```json
POST /wallets
{
  "playerId": "player-456",
  "currency": "usd"
}
```
Resposta: `Currency must be 3 uppercase letters (ISO 4217)`

**Erro 2: Wallet duplicada (409 Conflict)**
```json
POST /wallets
{
  "playerId": "player-123",
  "currency": "USD"
}
```
Resposta: `Wallet already exists for player player-123 with currency USD`

**Erro 3: Wallet não encontrada (404 Not Found)**
```
GET /wallets/00000000-0000-0000-0000-000000000000
```
Resposta: `Wallet 00000000-0000-0000-0000-000000000000 not found`

**Erro 4: Campo obrigatório faltando (400 Bad Request)**
```json
POST /wallets
{
  "playerId": "player-789"
}
```
Resposta: `currency should not be empty`

**Validações implementadas:**
- ✅ `playerId` obrigatório e string
- ✅ `currency` obrigatório, exatamente 3 letras maiúsculas (ISO 4217)
- ✅ Unicidade de `(playerId, currency)` no banco
- ✅ Saldo inicial sempre `0.00`
- ✅ Validação de entrada via `class-validator`
- ✅ Respostas HTTP consistentes (201, 200, 404, 409, 400)

**Limitações atuais (a implementar):**
- Não há endpoint para operações de crédito/débito ainda
- Não há endpoint de ledger
- Não há endpoint de reconciliação
- Não há idempotência (header `Idempotency-Key` não processado)
- Não há autenticação
- Não há health checks

**Próxima prioridade:** Implementar `WalletLedgerEntry` para permitir operações de crédito/débito com auditoria completa.

---

### 2026-10-08 21:42 - Implementação de WagerTransaction

**O que foi implementado:**
1. Criação de enums de domínio (`src/domain/enums.ts`):
   - `WagerTransactionKind`: OPENING, BET, WIN, LOSS, REFUND, ROLLBACK
   - `WagerTransactionStatus`: PENDING, PENDING_REFERENCE, PROCESSED, REJECTED, FAILED
   - `FailureCode`: 13 códigos específicos (INSUFFICIENT_BALANCE, REFERENCE_NOT_FOUND, etc.)
   - `LedgerDirection`: DEBIT, CREDIT

2. Entidade `WagerTransaction` (`src/transactions/wager-transaction.entity.ts`):
   - Factories: `create()` e `rehydrate()`
   - Transições de estado: `markProcessed()`, `markPendingReference()`, `reject()`, `fail()`
   - Métodos de domínio: `affectsBalance()`, `requiresReference()`, `ledgerDirectionFor()`
   - Validações: referência obrigatória para REFUND/ROLLBACK, proibição de OPENING via API
   - Encapsulamento: propriedades protegidas, getters readonly
   - Constraint de unicidade: `@Unique({ properties: ['idempotencyKey'] })`

3. Testes completos (`src/transactions/wager-transaction.entity.spec.ts`):
   - 31 testes unitários cobrindo criação, transições, validações e regras de negócio
   - Total de 93 testes no projeto

**Validações de negócio implementadas:**
- OPENING não pode ser criado via API/SQS (apenas internamente)
- Valores negativos são rejeitados
- REFUND e ROLLBACK exigem `referenceTransactionId`
- BET, WIN e LOSS não podem ter referência
- Transições de estado são protegidas (terminal → não pode mudar)
- Status PENDING_REFERENCE automático quando há referência

**Mapeamento de direções do ledger:**
- BET → DEBIT (diminui saldo)
- WIN → CREDIT (aumenta saldo)
- REFUND → CREDIT (devolve aposta)
- ROLLBACK → DEBIT (reverte WIN incorreto)
- LOSS → null (sem efeito no saldo)
- OPENING → CREDIT (saldo inicial)

**Arquivos criados/modificados:**
- `src/domain/enums.ts`: Enums compartilhados
- `src/transactions/wager-transaction.entity.ts`: Entidade de domínio
- `src/transactions/wager-transaction.entity.spec.ts`: Testes unitários

**Próxima prioridade:** Implementar `WalletLedgerEntry` com validação aritmética e imutabilidade conforme README copy.md seção 6.4.

---

### 2026-10-08 21:35 - Correção Crítica: Substituição de parseFloat por decimal.js

**Problema identificado:** A implementação inicial de `Money` usava `parseFloat()` para operações aritméticas (linhas 32, 39, 46, 50, 54, 59, 64, 69, 120 do arquivo original). Isso violava o requisito **eliminatório** do README copy.md seções 5.1 e 6.1 que proíbem explicitamente o uso de `number`, `float` ou `double` para valores monetários.

**Solução implementada:**
1. Instalação da dependência `decimal.js` via `npm install --legacy-peer-deps decimal.js`
2. Substituição de todas as operações aritméticas por chamadas à API `Decimal`:
   - `parseFloat(a) + parseFloat(b)` → `new Decimal(a).add(new Decimal(b))`
   - `parseFloat(a) - parseFloat(b)` → `new Decimal(a).sub(new Decimal(b))`
   - `parseFloat(a) > parseFloat(b)` → `new Decimal(a).greaterThan(new Decimal(b))`
   - E todas as demais comparações
3. Correção do import ESM: `import { Decimal } from 'decimal.js'`

**Validação:**
- ✅ Todos os 62 testes unitários passaram sem modificação
- ✅ Build compilou sem erros TypeScript
- ✅ Lint passou sem warnings
- ✅ Precisão decimal garantida para todos os cenários financeiros

**Impacto:** Esta mudança elimina completamente a possibilidade de erros de arredondamento de ponto flutuante e torna o sistema compatível com os requisitos eliminatórios do desafio. O comportamento externo de `Money` permanece idêntico, mas a implementação interna agora é matematicamente correta para operações financeiras.

**Arquivos modificados:**
- `src/domain/money.ts`: Substituição completa de parseFloat por Decimal
- `package.json`: Adição de `decimal.js` como dependência de produção
- `explicacao.md`: Atualização da seção 2 com detalhes da correção

**Próxima prioridade:** Implementar `WagerTransaction`, `WalletLedgerEntry`, `InboxMessage` e `OutboxMessage` conforme especificado no README copy.md seções 6.3, 6.4 e 6.5.
