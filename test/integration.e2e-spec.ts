import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { AppModule } from '../src/app.module.js';

describe('Integration Tests (e2e)', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let orm: MikroORM;
  let em: EntityManager;

  beforeAll(async () => {
    process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS = '100';

    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    orm = moduleFixture.get(MikroORM);
    em = orm.em.fork();

    const generator = orm.schema;
    await generator.ensureDatabase();
    await generator.drop();
    await generator.create();
  });

  afterAll(async () => {
    // Don't await app.close() as it hangs in test environment
    await orm.close();
  });

  beforeEach(async () => {
    await em.nativeDelete('OutboxMessage', {});
    await em.nativeDelete('InboxMessage', {});
    await em.nativeDelete('WalletLedgerEntry', {});
    await em.nativeDelete('WagerTransaction', {});
    await em.nativeDelete('Wallet', {});
  });

  describe('Wallet Creation', () => {
    it('should create a wallet with initial balance', async () => {
      const response = await request(app.getHttpServer())
        .post('/wallets')
        .send({
          playerId: 'player-123',
          initialBalance: { amount: '1000.00', currency: 'BRL' },
        })
        .expect(201);

      expect(response.body).toMatchObject({
        playerId: 'player-123',
        currency: 'BRL',
        balance: { amount: '1000.00', currency: 'BRL' },
        version: 1,
      });
      expect(response.body.id).toBeDefined();
    });

    it('should reject duplicate wallet for same player and currency', async () => {
      await request(app.getHttpServer())
        .post('/wallets')
        .send({
          playerId: 'player-123',
          initialBalance: { amount: '1000.00', currency: 'BRL' },
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/wallets')
        .send({
          playerId: 'player-123',
          initialBalance: { amount: '500.00', currency: 'BRL' },
        })
        .expect(409);
    });
  });

  describe('Transaction Processing', () => {
    let walletId: string;

    beforeEach(async () => {
      const walletResponse = await request(app.getHttpServer())
        .post('/wallets')
        .send({
          playerId: 'player-123',
          initialBalance: { amount: '1000.00', currency: 'BRL' },
        })
        .expect(201);
      walletId = walletResponse.body.id;
    });

    it('should process a BET transaction', async () => {
      const idempotencyKey = 'provider-a:tx-1';
      
      const response = await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'tx-1',
          playerId: 'player-123',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '100.00', currency: 'BRL' },
        })
        .expect(200);

      expect(response.body).toMatchObject({
        transactionId: expect.any(String),
        status: 'PROCESSED',
        balance: { amount: '900.00', currency: 'BRL' },
        idempotentReplay: false,
      });
    });

    it('should reject BET with insufficient balance', async () => {
      const idempotencyKey = 'provider-a:tx-2';
      
      const response = await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'tx-2',
          playerId: 'player-123',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '1500.00', currency: 'BRL' },
        })
        .expect(400);

      expect(response.body.code).toBe('INSUFFICIENT_BALANCE');
    });

    it('should process WIN transaction', async () => {
      // First place a bet
      await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:bet-1')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'bet-1',
          playerId: 'player-123',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '100.00', currency: 'BRL' },
        })
        .expect(200);

      // Then process win
      const response = await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:win-1')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'win-1',
          playerId: 'player-123',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: 'WIN',
          money: { amount: '200.00', currency: 'BRL' },
        })
        .expect(200);

      expect(response.body.status).toBe('PROCESSED');
      expect(response.body.balance.amount).toBe('1100.00');
    });

    it('should process LOSS transaction (no balance change)', async () => {
      await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:bet-2')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'bet-2',
          playerId: 'player-123',
          walletId,
          roundId: 'round-2',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '100.00', currency: 'BRL' },
        })
        .expect(200);

      const response = await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:loss-1')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'loss-1',
          playerId: 'player-123',
          walletId,
          roundId: 'round-2',
          gameId: 'game-1',
          kind: 'LOSS',
          money: { amount: '100.00', currency: 'BRL' },
        })
        .expect(200);

      expect(response.body.status).toBe('PROCESSED');
      expect(response.body.balance.amount).toBe('900.00');
    });

    it('should handle idempotent replay', async () => {
      const idempotencyKey = 'provider-a:tx-3';
      
      await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'tx-3',
          playerId: 'player-123',
          walletId,
          roundId: 'round-3',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '50.00', currency: 'BRL' },
        })
        .expect(200);

      const replayResponse = await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'tx-3',
          playerId: 'player-123',
          walletId,
          roundId: 'round-3',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '50.00', currency: 'BRL' },
        })
        .expect(200);

      expect(replayResponse.body.idempotentReplay).toBe(true);
      expect(replayResponse.body.balance.amount).toBe('950.00');
    });

    it('should reject idempotency key with different payload', async () => {
      const idempotencyKey = 'provider-a:tx-4';
      
      await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'tx-4',
          playerId: 'player-123',
          walletId,
          roundId: 'round-4',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '50.00', currency: 'BRL' },
        })
        .expect(200);

      await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'tx-4',
          playerId: 'player-123',
          walletId,
          roundId: 'round-4',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '100.00', currency: 'BRL' },
        })
        .expect(409);
    });
  });

  describe('REFUND and ROLLBACK', () => {
    let walletId: string;

    beforeEach(async () => {
      const walletResponse = await request(app.getHttpServer())
        .post('/wallets')
        .send({
          playerId: 'player-123',
          initialBalance: { amount: '1000.00', currency: 'BRL' },
        })
        .expect(201);
      walletId = walletResponse.body.id;
    });

    it('should process REFUND referencing a BET', async () => {
      // Place a bet
      await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:bet-refund')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'bet-refund',
          playerId: 'player-123',
          walletId,
          roundId: 'round-refund',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '100.00', currency: 'BRL' },
        })
        .expect(200);

      // Refund the bet
      const response = await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:refund-1')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'refund-1',
          playerId: 'player-123',
          walletId,
          roundId: 'round-refund',
          gameId: 'game-1',
          kind: 'REFUND',
          money: { amount: '100.00', currency: 'BRL' },
          referenceExternalTransactionId: 'bet-refund',
        })
        .expect(200);

      expect(response.body.status).toBe('PROCESSED');
      expect(response.body.balance.amount).toBe('1000.00');
    });

    it('should reject REFUND with wrong amount', async () => {
      await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:bet-refund-2')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'bet-refund-2',
          playerId: 'player-123',
          walletId,
          roundId: 'round-refund-2',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '100.00', currency: 'BRL' },
        })
        .expect(200);

      const response = await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:refund-2')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'refund-2',
          playerId: 'player-123',
          walletId,
          roundId: 'round-refund-2',
          gameId: 'game-1',
          kind: 'REFUND',
          money: { amount: '50.00', currency: 'BRL' },
          referenceExternalTransactionId: 'bet-refund-2',
        })
        .expect(400);

      expect(response.body.code).toBe('INVALID_REFERENCE');
    });

    it('should process ROLLBACK of a WIN', async () => {
      // Place a bet
      await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:bet-rollback')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'bet-rollback',
          playerId: 'player-123',
          walletId,
          roundId: 'round-rollback',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '100.00', currency: 'BRL' },
        })
        .expect(200);

      // Process win
      await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:win-rollback')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'win-rollback',
          playerId: 'player-123',
          walletId,
          roundId: 'round-rollback',
          gameId: 'game-1',
          kind: 'WIN',
          money: { amount: '200.00', currency: 'BRL' },
        })
        .expect(200);

      // Rollback the win
      const response = await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:rollback-1')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'rollback-1',
          playerId: 'player-123',
          walletId,
          roundId: 'round-rollback',
          gameId: 'game-1',
          kind: 'ROLLBACK',
          money: { amount: '200.00', currency: 'BRL' },
          referenceExternalTransactionId: 'win-rollback',
        })
        .expect(200);

      expect(response.body.status).toBe('PROCESSED');
      expect(response.body.balance.amount).toBe('900.00');
    });
  });

  describe('Reconciliation', () => {
    it('should return consistent reconciliation for correct wallet', async () => {
      const walletResponse = await request(app.getHttpServer())
        .post('/wallets')
        .send({
          playerId: 'player-123',
          initialBalance: { amount: '1000.00', currency: 'BRL' },
        })
        .expect(201);

      const walletId = walletResponse.body.id;

      await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:recon-bet')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'recon-bet',
          playerId: 'player-123',
          walletId,
          roundId: 'round-recon',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '100.00', currency: 'BRL' },
        })
        .expect(200);

      const response = await request(app.getHttpServer())
        .post(`/wallets/${walletId}/reconciliation`)
        .expect(200);

      expect(response.body).toMatchObject({
        walletId,
        storedBalance: { amount: '900.00', currency: 'BRL' },
        calculatedBalance: { amount: '900.00', currency: 'BRL' },
        difference: { amount: '0.00', currency: 'BRL' },
        consistent: true,
        checkedEntries: 1,
      });
    });
  });

  describe('Ledger Pagination', () => {
    it('should return paginated ledger entries with cursor', async () => {
      const walletResponse = await request(app.getHttpServer())
        .post('/wallets')
        .send({
          playerId: 'player-123',
          initialBalance: { amount: '1000.00', currency: 'BRL' },
        })
        .expect(201);

      const walletId = walletResponse.body.id;

      // Create multiple transactions
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/wagering/transactions')
          .set('Idempotency-Key', `provider-a:bet-page-${i}`)
          .send({
            providerId: 'provider-a',
            externalTransactionId: `bet-page-${i}`,
            playerId: 'player-123',
            walletId,
            roundId: `round-page-${i}`,
            gameId: 'game-1',
            kind: 'BET',
            money: { amount: '10.00', currency: 'BRL' },
          })
          .expect(200);
      }

      const firstPage = await request(app.getHttpServer())
        .get(`/wallets/${walletId}/ledger?limit=2`)
        .expect(200);

      expect(firstPage.body.entries).toHaveLength(2);
      expect(firstPage.body.nextCursor).toBeDefined();

      const secondPage = await request(app.getHttpServer())
        .get(`/wallets/${walletId}/ledger?limit=2&cursor=${firstPage.body.nextCursor}`)
        .expect(200);

      expect(secondPage.body.entries).toHaveLength(2);
      expect(secondPage.body.nextCursor).toBeDefined();

      const thirdPage = await request(app.getHttpServer())
        .get(`/wallets/${walletId}/ledger?limit=2&cursor=${secondPage.body.nextCursor}`)
        .expect(200);

      expect(thirdPage.body.entries).toHaveLength(1);
    });
  });

  describe('Provider Transaction Lookup', () => {
    it('should find transaction by provider and external ID', async () => {
      const walletResponse = await request(app.getHttpServer())
        .post('/wallets')
        .send({
          playerId: 'player-123',
          initialBalance: { amount: '1000.00', currency: 'BRL' },
        })
        .expect(201);

      const walletId = walletResponse.body.id;

      await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:lookup-1')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'lookup-1',
          playerId: 'player-123',
          walletId,
          roundId: 'round-lookup',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '100.00', currency: 'BRL' },
        })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get('/providers/provider-a/wagering/transactions/lookup-1')
        .expect(200);

      expect(response.body.externalTransactionId).toBe('lookup-1');
      expect(response.body.providerId).toBe('provider-a');
    });
  });

  describe('Health Checks', () => {
    it('should return liveness', async () => {
      await request(app.getHttpServer())
        .get('/health/live')
        .expect(200)
        .expect({ status: 'ok' });
    });

    it('should return readiness', async () => {
      const response = await request(app.getHttpServer())
        .get('/health/ready')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ready',
        checks: {
          database: 'up',
          sqs: 'up',
        },
      });
    });
  });

  describe('Metrics Endpoint', () => {
    it('should expose Prometheus metrics', async () => {
      const response = await request(app.getHttpServer())
        .get('/metrics')
        .expect(200);

      expect(response.text).toContain('wagering_transactions_total');
      expect(response.text).toContain('wagering_idempotent_replays_total');
      expect(response.text).toContain('wagering_processing_duration_seconds');
    });
  });
});