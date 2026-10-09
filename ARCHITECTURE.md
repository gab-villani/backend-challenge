# Arquitetura de Autenticação

## Visão Geral

A autenticação **não está implementada** neste desafio — conforme a especificação (seção 2), ela não pontua. No entanto, a arquitetura precisa suportar um ponto de extensão limpo para que um IdP futuro (Keycloak / Zitadel) possa ser conectado sem tocar na lógica central de apostas.

## Estado Atual

- Um `AuthGuard` no-op está registrado em todas as rotas protegidas.
- `ProviderIdentityPort` define o contrato que o domínio espera de qualquer mecanismo de auth.
- A camada HTTP já propaga `correlationId` / `providerId` a partir de headers — um guarda futuro apenas **afirmará** que esses valores são válidos, ao invés de confiar cegamente.

## Design Proposto

### Modelo de Atores

```
+----------+        1. JWT access_token         +-----------+
|  Provider |  ---------------------------->>   |  API GW   |
|  (IdP)    |   (OIDC, assinado w/ RS256)        |  / Edge   |
+----------+                                    +-----------+
                                                    |
                                               2. API call
                                               + auth header
                                                    |
                                                    v
                                        +-----------------------+
                                        |  AuthGuard (NestJS)   |
                                        |  - verifica assinatura|
                                        |  - valida scopes      |
                                        |  - extrai claims      |
                                        +-----------------------+
                                                    |
                                      3. ProviderIdentity (context)
                                                    |
                                                    v
                             +---------------------------------------------+
                             |  ProviderIdentityPort (interface de domínio)|
                             |  - getProviderId(): string                 |
                             |  - getPlayerId(): string                   |
                             |  - getAllowedCurrencies(): Currency[]      |
                             +---------------------------------------------+
                                                    |
             +------------------------------------------+--------------------------------+
             |                               |                          |                |
             v                               v                          v                v
    +-------------------+     +----------------------+     +----------------+     +----------------+
    |   Wallet API      |     |   Transaction API    |     |   Events API   |     |   Admin API    |
    |  - GET /wallets   |     |  - POST /wagers     |     |  - GET /events |     | - /reconcile   |
    |  - authorize:     |     |  - authorize:       |     |  - authorize:  |     | - authorize:   |
    |    wallet:owner   |     |    wagering:submit  |     |   wagering:read |    |   admin:all    |
    +-------------------+     +----------------------+     +----------------+     +----------------+

Legenda:
  >>= JWT (assinado, RS256)
```

### Claims JWT (esperadas)

| Claim            | Origem         | Uso                             |
|------------------|----------------|---------------------------------|
| `iss`            | IdP            | Validar emissor                 |
| `sub`            | IdP            | Sujeito único (player id)       |
| `aud`            | IdP            | Deve conter o client id da API  |
| `exp` / `nbf`    | IdP            | Validação de janela temporal    |
| `scp`            | IdP            | Autorização baseada em scope    |
| `provider_id`    | Claim custom   | Isolamento de locatário         |
| `currency_limits`| Claim custom   | Lista de moedas permitidas      |

### Mapeamento Scope → Endpoint

| Scope              | Endpoints                                  |
|--------------------|---------------------------------------------|
| `wallet:owner`     | `GET /wallets/:id`, `POST /wallets/:id/reconciliation` |
| `wagering:submit`  | `POST /wallets/:id/wagers`                  |
| `wagering:read`    | `GET /wallets/:id/transactions`             |
| `admin:all`        | `GET /health/*`, `GET /metrics`             |

## Pontos de Extensão

1. **`AuthGuard`** (`src/auth/auth.guard.ts`) — atualmente retorna `true`. Substituir por um guarda real que valida o JWT contra o IdP.
2. **`ProviderIdentityPort`** (`src/auth/ports/provider-identity.port.ts`) — interface injetada nos serviços de domínio; a camada de infraestrutura fornece a implementação baseada em JWT.
3. **`AuthModule`** — contém `JwtModule` + `ConfigModule`; o trabalho futuro conecta `jwks-rsa` + `passport-jwt`.

## Considerações de Segurança

- **No-op por design**: durante o desafio, os endpoints confiam no `providerId` passado pelo caller (lacuna documentada, veja §13 do documento principal).
- **Futuro**: nunca logar tokens JWT; validar assinaturas no servidor; rotacionar chaves via JWKS.
- **Rate limiting**: colocar um gateway de API (NGINX / Traefik) na entrada; rejeitar antes do NestJS quando o limite for excedido.

## Implementação Mínima Viável (TODO)

```
src/auth/
├── auth.guard.ts              # <- substituir no-op por verificação real de JWT
├── auth.module.ts             # JwtModule.registerAsync(...)
├── strategies/
│   └── jwt.strategy.ts        # passport-jwt + jwks-rsa
├── decorators/
│   ├── provider-id.decorator.ts
│   └── scopes.decorator.ts
└── ports/
    └── provider-identity.port.ts  # interface de domínio
```
