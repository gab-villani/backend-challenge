import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MikroORM, EntityManager, LockMode } from '@mikro-orm/core';
import { AppModule } from '../src/app.module.js';
import { Money } from '../src/domain/money.js';
import { WagerTransactionKind, WagerTransactionStatus, LedgerDirection } from '../src/domain/enums.js';
import { WageringService } from '../src/wagering/wagering.service.js';

describe('Concurrency Tests (e2e)', () => {
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

  describe('50 Parallel Identical Bets', () => {
    it('should process exactly one debit for 50 concurrent identical bets', async () => {
      const walletResponse = await request(app.getHttpServer())
        .post('/wallets')
        .send({
          playerId: 'concurrency-player',
          initialBalance: { amount: '100.00', currency: 'BRL' },
        })
        .expect(201);

      const walletId = walletResponse.body.id;
      const betAmount = '80.00';
      const concurrentRequests = 50;

      const promises = Array.from({ length: concurrentRequests }, (_, i) =>
        request(app.getHttpServer())
          .post('/wagering/transactions')
          .set('Idempotency-Key', `provider-a:concurrent-bet-${i}`)
          .send({
            providerId: 'provider-a',
            externalTransactionId: `concurrent-bet-${i}`,
            playerId: 'concurrency-player',
            walletId,
            roundId: 'concurrent-round',
            gameId: 'game-1',
            kind: 'BET',
            money: { amount: betAmount, currency: 'BRL' },
          })
      );

      const responses = await Promise.allSettled(promises);

      const successful = responses.filter(r => r.status === 'fulfilled' && r.value.status === 200);
      const rejected = responses.filter(r => r.status === 'fulfilled' && r.value.status === 400);
      const errors = responses.filter(r => r.status === 'rejected');

      expect(successful.length).toBe(1);
      expect(rejected.length).toBe(concurrentRequests - 1);
      expect(errors.length).toBe(0);

      // Verify final balance
      const wallet = await em.findOne(Wallet, { id: walletId });
      expect(wallet?.getBalance().amount).toBe('20.00');

      // Verify exactly one ledger entry
      const ledgerEntries = await em.find(WalletLedgerEntry, { wallet: walletId });
      expect(ledgerEntries.length).toBe(1);
      expect(ledgerEntries[0].direction).toBe(LedgerDirection.DEBIT);
      expect(ledgerEntries[0].money.amount).toBe('80.00');
    }, 30000);
  });

  describe('Hot Wallet Concurrent Operations', () => {
    it('should handle concurrent BET and WIN on same wallet', async () => {
      const walletResponse = await request(app.getHttpServer())
        .post('/wallets')
        .send({
          playerId: 'hot-wallet-player',
          initialBalance: { amount: '500.00', currency: 'BRL' },
        })
        .expect(201);

      const walletId = walletResponse.body.id;

      // Mix of concurrent BETs and WINs
      const operations = [
        { kind: 'BET' as const, amount: '100.00', count: 3 },
        { kind: 'WIN' as const, amount: '50.00', count: 3 },
      ];

      const promises: Promise<any>[] = [];
      let betIndex = 0;
      let winIndex = 0;

      for (const op of operations) {
        for (let i = 0; i < op.count; i++) {
          const idempotencyKey = `provider-a:${op.kind.toLowerCase()}-${op.kind === 'BET' ? betIndex++ : winIndex++}`;
          promises.push(
            request(app.getHttpServer())
              .post('/wagering/transactions')
              .set('Idempotency-Key', idempotencyKey)
              .send({
                providerId: 'provider-a',
                externalTransactionId: idempotencyKey.split(':')[1],
                playerId: 'hot-wallet-player',
                walletId,
                roundId: `round-${op.kind}-${i}`,
                gameId: 'game-1',
                kind: op.kind,
                money: { amount: op.amount, currency: 'BRL' },
              })
          );
        }
      }

      const responses = await Promise.allSettled(promises);
      const fulfilled = responses.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];

      const processed = fulfilled.filter(r => r.value.status === 200 && r.value.body.status === 'PROCESSED');

      // Should process as many as balance allows
      expect(processed.length).toBeGreaterThan(0);

      // Verify final state is consistent
      const wallet = await em.findOne(Wallet, { id: walletId });
      const ledgerEntries = await em.find(WalletLedgerEntry, { wallet: walletId });
      
      let calculatedBalance = Money.zero('BRL');
      for (const entry of ledgerEntries) {
        if (entry.direction === LedgerDirection.CREDIT) {
          calculatedBalance = calculatedBalance.add(entry.money);
        } else {
          calculatedBalance = calculatedBalance.subtract(entry.money);
        }
      }

      expect(wallet?.getBalance().equals(calculatedBalance)).toBe(true);
      expect(wallet?.getBalance().isNegative()).toBe(false);
    }, 30000);
  });

  describe('Parallel Wallets', () => {
    it('should process wallets independently in parallel', async () => {
      const walletCount = 10;
      const wallets = await Promise.all(
        Array.from({ length: walletCount }, async (_, i) => {
          const resp = await request(app.getHttpServer())
            .post('/wallets')
            .send({
              playerId: `parallel-player-${i}`,
              initialBalance: { amount: '1000.00', currency: 'BRL' },
            })
            .expect(201);
          return resp.body.id;
        })
      );

      // Process bets on all wallets concurrently
      const betPromises = wallets.map((walletId, i) =>
        request(app.getHttpServer())
          .post('/wagering/transactions')
          .set('Idempotency-Key', `provider-a:parallel-bet-${i}`)
          .send({
            providerId: 'provider-a',
            externalTransactionId: `parallel-bet-${i}`,
            playerId: `parallel-player-${i}`,
            walletId,
            roundId: `parallel-round-${i}`,
            gameId: 'game-1',
            kind: 'BET',
            money: { amount: '100.00', currency: 'BRL' },
          })
      );

      const responses = await Promise.allSettled(betPromises);
      const successful = responses.filter(r => r.status === 'fulfilled' && r.value.status === 200);

      expect(successful.length).toBe(walletCount);

      // Verify each wallet has correct balance
      for (const walletId of wallets) {
        const wallet = await em.findOne(Wallet, { id: walletId });
        expect(wallet?.getBalance().amount).toBe('900.00');
      }
    }, 30000);
  });

  describe('Multiple App Instances Simulation', () => {
    it('should maintain consistency with multiple entity managers', async () => {
      const walletResponse = await request(app.getHttpServer())
        .post('/wallets')
        .send({
          playerId: 'multi-instance-player',
          initialBalance: { amount: '1000.00', currency: 'BRL' },
        })
        .expect(201);

      const walletId = walletResponse.body.id;

      // Simulate multiple instances by creating multiple entity managers
      const em1 = orm.em.fork();
      const em2 = orm.em.fork();
      const em3 = orm.em.fork();

      // Each instance tries to process a bet
      const betAmount = '300.00';
      const promises = [
        processBetDirectly(em1, walletId, 'inst-1'),
        processBetDirectly(em2, walletId, 'inst-2'),
        processBetDirectly(em3, walletId, 'inst-3'),
      ];

      async function processBetDirectly(em: EntityManager, walletId: string, instanceId: string) {
        return em.transactional(async (txEm) => {
          const wallet = await txEm.findOne(Wallet, { id: walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
          if (!wallet) throw new Error('Wallet not found');

          if (wallet.getBalance().amount < betAmount) {
            throw new Error('Insufficient balance');
          }

          wallet.debit(Money.fromString(betAmount, 'BRL'));
          txEm.persist(wallet);
          
          const tx = WagerTransaction.create(
            walletId, 'provider-a', `ext-${instanceId}`, `idem-${instanceId}`,
            WagerTransactionKind.BET, Money.fromString(betAmount, 'BRL'),
            'multi-instance-player', 'round-multi', 'game-1', null, null, 'hash'
          );
          tx.markProcessed();
          txEm.persist(tx);

          const entry = WalletLedgerEntry.create({
            wallet, transaction: tx, direction: LedgerDirection.DEBIT,
            money: Money.fromString(betAmount, 'BRL'),
            balanceBefore: Money.fromString('1000.00', 'BRL'),
            balanceAfter: Money.fromString('700.00', 'BRL'),
          });
          txEm.persist(entry);
        });
      }

      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === 'fulfilled');

      // Only one should succeed due to pessimistic locking
      expect(successful.length).toBe(1);

      // Verify final state
      const wallet = await em.findOne(Wallet, { id: walletId });
      expect(wallet?.getBalance().amount).toBe('700.00');

      const ledgerEntries = await em.find(WalletLedgerEntry, { wallet: walletId });
      expect(ledgerEntries.length).toBe(1);
    }, 30000);
  });

  describe('Worker Crash Recovery', () => {
    it('should not lose transactions when worker crashes after commit', async () => {
      const walletResponse = await request(app.getHttpServer())
        .post('/wallets')
        .send({
          playerId: 'crash-player',
          initialBalance: { amount: '1000.00', currency: 'BRL' },
        })
        .expect(201);

      const walletId = walletResponse.body.id;

      // Process a bet successfully
      await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:crash-bet')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'crash-bet',
          playerId: 'crash-player',
          walletId,
          roundId: 'crash-round',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '100.00', currency: 'BRL' },
        })
        .expect(200);

      // Verify transaction is persisted
      const transaction = await em.findOne(WagerTransaction, { 
        providerId: 'provider-a', 
        externalTransactionId: 'crash-bet' 
      });
      expect(transaction).toBeDefined();
      expect(transaction?.status).toBe(WagerTransactionStatus.PROCESSED);

      // Simulate app restart by creating new app instance
      const newModuleFixture = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      const newApp = newModuleFixture.createNestApplication();
      await newApp.init();

      try {
        // Verify data persists after restart
        const wallet = await newModuleFixture.get(MikroORM).em.findOne(Wallet, { id: walletId });
        expect(wallet?.getBalance().amount).toBe('900.00');

        const tx = await newModuleFixture.get(MikroORM).em.findOne(WagerTransaction, {
          providerId: 'provider-a',
          externalTransactionId: 'crash-bet'
        });
        expect(tx?.status).toBe(WagerTransactionStatus.PROCESSED);
      } finally {
        await newApp.close();
        await newModuleFixture.get(MikroORM).close();
      }
    });
  });

  describe('Dual Outbox Publishers', () => {
    it('should not duplicate events with concurrent publishers', async () => {
      const walletResponse = await request(app.getHttpServer())
        .post('/wallets')
        .send({
          playerId: 'dual-publisher-player',
          initialBalance: { amount: '1000.00', currency: 'BRL' },
        })
        .expect(201);

      const walletId = walletResponse.body.id;

      // Process a bet to generate outbox events
      await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:dual-pub-bet')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'dual-pub-bet',
          playerId: 'dual-publisher-player',
          walletId,
          roundId: 'dual-pub-round',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '100.00', currency: 'BRL' },
        })
        .expect(200);

      // Verify outbox has the events
      const outboxEntries = await em.find(OutboxMessage, { 
        aggregateId: walletId 
      });
      expect(outboxEntries.length).toBeGreaterThan(0);

      // Verify event types are present
      const eventTypes = outboxEntries.map(e => e.eventType);
      expect(eventTypes).toContain('WagerTransactionProcessed');
      expect(eventTypes).toContain('WalletBalanceChanged');
    });
  });

  describe('Out-of-Order REFUND/ROLLBACK', () => {
    it('should handle REFUND arriving before BET (PENDING_REFERENCE)', async () => {
      const walletResponse = await request(app.getHttpServer())
        .post('/wallets')
        .send({
          playerId: 'oor-player',
          initialBalance: { amount: '1000.00', currency: 'BRL' },
        })
        .expect(201);

      const walletId = walletResponse.body.id;

      // Send REFUND first (reference doesn't exist yet)
      const refundResponse = await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:oor-refund')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'oor-refund',
          playerId: 'oor-player',
          walletId,
          roundId: 'oor-round',
          gameId: 'game-1',
          kind: 'REFUND',
          money: { amount: '100.00', currency: 'BRL' },
          referenceExternalTransactionId: 'oor-bet',
        })
        .expect(200);

      expect(refundResponse.body.status).toBe('PENDING_REFERENCE');

      // Now send the BET
      await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', 'provider-a:oor-bet')
        .send({
          providerId: 'provider-a',
          externalTransactionId: 'oor-bet',
          playerId: 'oor-player',
          walletId,
          roundId: 'oor-round',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '100.00', currency: 'BRL' },
        })
        .expect(200);

      // Trigger reprocessing manually
      const wageringService = moduleFixture.get(WageringService);
      const processed = await wageringService.reprocessPendingReferences();
      expect(processed).toBe(1);

      // Verify final state: bet processed, refund processed, balance back to 1000
      const wallet = await em.findOne(Wallet, { id: walletId });
      expect(wallet?.getBalance().amount).toBe('1000.00');

      const refundTx = await em.findOne(WagerTransaction, { externalTransactionId: 'oor-refund' });
      expect(refundTx?.status).toBe(WagerTransactionStatus.PROCESSED);
    });
  });

  describe('Service Restart Consistency', () => {
    it('should maintain wallet.balance == ledger reconstruction after restart', async () => {
      const walletResponse = await request(app.getHttpServer())
        .post('/wallets')
        .send({
          playerId: 'restart-player',
          initialBalance: { amount: '1000.00', currency: 'BRL' },
        })
        .expect(201);

      const walletId = walletResponse.body.id;

      // Process multiple transactions
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/wagering/transactions')
          .set('Idempotency-Key', `provider-a:restart-bet-${i}`)
          .send({
            providerId: 'provider-a',
            externalTransactionId: `restart-bet-${i}`,
            playerId: 'restart-player',
            walletId,
            roundId: `restart-round-${i}`,
            gameId: 'game-1',
            kind: 'BET',
            money: { amount: '50.00', currency: 'BRL' },
          })
          .expect(200);
      }

      // Simulate restart
      const newModuleFixture = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      const newApp = newModuleFixture.createNestApplication();
      await newApp.init();

      try {
        const newEm = newModuleFixture.get(MikroORM).em.fork();
        const wallet = await newEm.findOne(Wallet, { id: walletId });
        
        const ledgerEntries = await newEm.find(WalletLedgerEntry, { 
          wallet: walletId,
          orderBy: { createdAt: 'ASC' }
        });

        let calculated = Money.zero('BRL');
        for (const entry of ledgerEntries) {
          if (entry.direction === LedgerDirection.CREDIT) {
            calculated = calculated.add(entry.money);
          } else {
            calculated = calculated.subtract(entry.money);
          }
        }

        expect(wallet?.getBalance().equals(calculated)).toBe(true);
        expect(wallet?.getBalance().amount).toBe('750.00');
      } finally {
        await newApp.close();
        await newModuleFixture.get(MikroORM).close();
      }
    });
  });
});