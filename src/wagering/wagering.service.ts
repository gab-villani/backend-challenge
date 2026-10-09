import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { EntityManager, EntityRepository, LockMode } from '@mikro-orm/core';
import { Money } from '../domain/money.js';
import { Wallet } from '../wallets/wallet.entity.js';
import { WagerTransaction } from '../transactions/wager-transaction.entity.js';
import { WalletLedgerEntry } from '../ledger/wallet-ledger-entry.entity.js';
import { InboxMessage } from '../messaging/inbox-message.entity.js';
import { OutboxMessage } from '../messaging/outbox-message.entity.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
  FailureCode,
  LedgerDirection,
} from '../domain/enums.js';
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
  WagerTransactionPendingReference,
} from '../domain/integration-event.js';
import { StructuredLoggerService } from '../observability/logger.service.js';
import { MetricsService } from '../observability/metrics.service.js';

export interface ProcessTransactionInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
}

export interface ProcessTransactionResult {
  transaction: WagerTransaction;
  balance: Money;
  idempotentReplay: boolean;
}

@Injectable()
export class WageringService {
  constructor(
    private readonly em: EntityManager,
    private readonly logger: StructuredLoggerService,
    private readonly metrics: MetricsService,
  ) {}

  private get walletRepository(): EntityRepository<Wallet> {
    return this.em.getRepository(Wallet);
  }

  private get transactionRepository(): EntityRepository<WagerTransaction> {
    return this.em.getRepository(WagerTransaction);
  }

  private get ledgerRepository(): EntityRepository<WalletLedgerEntry> {
    return this.em.getRepository(WalletLedgerEntry);
  }

  private get inboxRepository(): EntityRepository<InboxMessage> {
    return this.em.getRepository(InboxMessage);
  }

  private get outboxRepository(): EntityRepository<OutboxMessage> {
    return this.em.getRepository(OutboxMessage);
  }

  static computePayloadHash(input: ProcessTransactionInput): string {
    const canonical = JSON.stringify({
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      playerId: input.playerId,
      walletId: input.walletId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: input.money.toJSON(),
      referenceExternalTransactionId: input.referenceExternalTransactionId ?? null,
    }, Object.keys({
      providerId: '',
      externalTransactionId: '',
      playerId: '',
      walletId: '',
      roundId: '',
      gameId: '',
      kind: '',
      money: '',
      referenceExternalTransactionId: '',
    }).sort());
    
    return createHash('sha256').update(canonical).digest('hex');
  }

  async processTransaction(input: ProcessTransactionInput): Promise<ProcessTransactionResult> {
    const payloadHash = WageringService.computePayloadHash(input);
    const startTime = Date.now();
    
    try {
      return await this.em.transactional(async (em) => {
      const existingTx = await this.transactionRepository.findOne(
        { idempotencyKey: input.idempotencyKey },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      if (existingTx) {
        if (!existingTx.matchesPayload(payloadHash)) {
          this.logger.warn('Idempotency conflict: same key with different payload', {
            idempotencyKey: input.idempotencyKey,
            transactionId: existingTx.id,
          });
          throw new Error('IDEMPOTENCY_CONFLICT: Same idempotency key with different payload');
        }
        
        this.logger.log('Idempotent replay', {
          idempotencyKey: input.idempotencyKey,
          transactionId: existingTx.id,
          status: existingTx.status,
        });

        this.metrics.incrementIdempotentReplays();
        this.metrics.incrementTransactions('REPLAY', input.kind);

        const existingWallet = await this.walletRepository.findOne({ id: existingTx.walletId });
        
        return {
          transaction: existingTx,
          balance: existingWallet?.getBalance() ?? input.money,
          idempotentReplay: true,
        };
      }

      const wallet = await this.walletRepository.findOne(
        { id: input.walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      if (!wallet) {
        throw new Error('WALLET_NOT_FOUND');
      }

      if (wallet.currency !== input.money.currency) {
        throw new Error('CURRENCY_MISMATCH');
      }

      const requiresReference = input.kind === WagerTransactionKind.REFUND || 
                                input.kind === WagerTransactionKind.ROLLBACK;

      let referenceTransaction: WagerTransaction | null = null;
      let initialStatus = WagerTransactionStatus.PENDING;

      if (requiresReference && input.referenceExternalTransactionId) {
        referenceTransaction = await this.transactionRepository.findOne({
          providerId: input.providerId,
          externalTransactionId: input.referenceExternalTransactionId,
        });

        if (!referenceTransaction) {
          initialStatus = WagerTransactionStatus.PENDING_REFERENCE;
      } else {
        await this.validateReference(referenceTransaction, input);
      }
      }

      const transaction = WagerTransaction.create(
        input.walletId,
        input.providerId,
        input.externalTransactionId,
        input.idempotencyKey,
        input.kind,
        input.money,
        input.playerId,
        input.roundId,
        input.gameId,
        referenceTransaction?.id ?? null,
        input.referenceExternalTransactionId ?? null,
        payloadHash,
      );

      if (initialStatus === WagerTransactionStatus.PENDING_REFERENCE) {
        transaction.markPendingReference();
      }

      em.persist(transaction);

      let newBalance = wallet.getBalance();

      if (initialStatus === WagerTransactionStatus.PENDING) {
        const result = await this.applyTransaction(em, wallet, transaction, referenceTransaction);
        newBalance = result.newBalance;
      }

      const correlationId = randomUUID();
      await this.publishEvents(em, wallet, transaction, newBalance, correlationId, referenceTransaction ?? undefined);

      const duration = (Date.now() - startTime) / 1000;
      this.metrics.observeProcessingDuration(input.kind, duration);
      this.metrics.incrementTransactions(transaction.status, input.kind);
      this.metrics.setWalletBalance(wallet.id, wallet.currency, parseFloat(newBalance.amount));

return {
        transaction,
        balance: newBalance,
        idempotentReplay: false,
      };
    });
    } catch (error) {
      if (error instanceof Error && (error.message.includes('could not obtain lock') || error.message.includes('deadlock detected') || error.message.includes('lock timeout') || error.message.includes('LockNotAvailable') || error.message.includes('SerializationFailure'))) {
        this.metrics.incrementLockConflicts();
        this.logger.warn('Lock conflict detected', { error: error.message });
      }
      throw error;
    }
  }

  private async applyTransaction(
    em: EntityManager,
    wallet: Wallet,
    transaction: WagerTransaction,
    referenceTransaction: WagerTransaction | null,
  ): Promise<{ newBalance: Money }> {
    const balanceBefore = wallet.getBalance();
    let newBalance: Money;

    try {
      switch (transaction.kind) {
        case WagerTransactionKind.BET:
          newBalance = wallet.debit(transaction.getAmount());
          break;
        case WagerTransactionKind.WIN:
          newBalance = wallet.credit(transaction.getAmount());
          break;
        case WagerTransactionKind.REFUND:
          if (!referenceTransaction) throw new Error('REFERENCE_REQUIRED');
          newBalance = wallet.credit(referenceTransaction.getAmount());
          break;
        case WagerTransactionKind.ROLLBACK:
          if (!referenceTransaction) throw new Error('REFERENCE_REQUIRED');
          const refDirection = referenceTransaction.ledgerDirectionFor();
          if (refDirection === LedgerDirection.DEBIT) {
            newBalance = wallet.credit(referenceTransaction.getAmount());
          } else if (refDirection === LedgerDirection.CREDIT) {
            newBalance = wallet.debit(referenceTransaction.getAmount());
          } else {
            throw new Error('CANNOT_ROLLBACK_LOSS');
          }
          break;
        case WagerTransactionKind.OPENING:
          newBalance = wallet.credit(transaction.getAmount());
          break;
        case WagerTransactionKind.LOSS:
        default:
          newBalance = balanceBefore;
      }

      if (transaction.affectsBalance()) {
        const direction = transaction.ledgerDirectionFor(referenceTransaction)!;
        const ledgerEntry = WalletLedgerEntry.create({
          wallet,
          transaction,
          direction,
          money: transaction.getAmount(),
          balanceBefore,
          balanceAfter: newBalance,
        });
        em.persist(ledgerEntry);
      }

      transaction.markProcessed();
      
      return { newBalance };
    } catch (error) {
      if (error instanceof Error && error.message === 'Insufficient balance') {
        const isReversalDebit = 
          transaction.kind === WagerTransactionKind.ROLLBACK &&
          referenceTransaction &&
          referenceTransaction.ledgerDirectionFor() === LedgerDirection.CREDIT;
        
        const failureCode = isReversalDebit
          ? FailureCode.REVERSAL_INSUFFICIENT_BALANCE
          : FailureCode.INSUFFICIENT_BALANCE;
        
        const errorMessage = isReversalDebit
          ? 'Insufficient balance for reversal'
          : 'Insufficient balance for transaction';
        
        transaction.reject(failureCode, errorMessage);
        throw new Error(errorMessage);
      }
      throw error;
    }
  }

  private async validateReference(refTx: WagerTransaction, input: ProcessTransactionInput): Promise<void> {
    if (refTx.providerId !== input.providerId) {
      throw new Error('REFERENCE_INCORRECT_PROVIDER');
    }
    if (refTx.playerId !== input.playerId) {
      throw new Error('REFERENCE_INCORRECT_PLAYER');
    }
    if (refTx.walletId !== input.walletId) {
      throw new Error('REFERENCE_INCORRECT_WALLET');
    }
    if (refTx.currency !== input.money.currency) {
      throw new Error('REFERENCE_INCORRECT_CURRENCY');
    }
    if (refTx.roundId !== input.roundId) {
      throw new Error('REFERENCE_INCORRECT_ROUND');
    }
    if (!refTx.isTerminal()) {
      throw new Error('REFERENCE_NOT_TERMINAL');
    }
    if (refTx.status === WagerTransactionStatus.REJECTED ||
        refTx.status === WagerTransactionStatus.FAILED) {
      throw new Error('REFERENCE_ALREADY_REVERSED');
    }

    const existingReversal = await this.transactionRepository.findOne({
      referenceTransactionId: refTx.id,
      kind: input.kind,
      status: WagerTransactionStatus.PROCESSED,
    });
    if (existingReversal) {
      throw new Error('REFERENCE_ALREADY_REVERSED');
    }

    if (input.kind === WagerTransactionKind.REFUND && refTx.kind !== WagerTransactionKind.BET) {
      throw new Error('REFERENCE_INCORRECT_KIND');
    }
    if (input.kind === WagerTransactionKind.ROLLBACK) {
      const allowedRefKinds = [
        WagerTransactionKind.BET,
        WagerTransactionKind.WIN,
        WagerTransactionKind.REFUND,
      ];
      if (!allowedRefKinds.includes(refTx.kind)) {
        throw new Error('REFERENCE_INCORRECT_KIND');
      }
    }
    if (!refTx.getAmount().equals(input.money)) {
      throw new Error('REFERENCE_INCORRECT_AMOUNT');
    }
  }

  private async publishEvents(
    em: EntityManager,
    wallet: Wallet,
    transaction: WagerTransaction,
    balanceAfter: Money,
    correlationId: string,
    referenceTransaction?: WagerTransaction,
  ): Promise<void> {
    const causationId = transaction.id;
    const processedAt = transaction.processedAt!;

    if (transaction.status === WagerTransactionStatus.PROCESSED) {
      const event = WagerTransactionProcessed.from(
        transaction.id,
        wallet.id,
        wallet.playerId,
        transaction.providerId,
        transaction.externalTransactionId,
        transaction.kind,
        transaction.getAmount(),
        transaction.roundId,
        transaction.gameId,
        transaction.referenceTransactionId ? undefined : undefined,
        processedAt,
        balanceAfter,
        wallet.version,
        correlationId,
        causationId,
      );
      em.persist(OutboxMessage.enqueue(event));

      if (transaction.affectsBalance()) {
        const balanceEvent = WalletBalanceChanged.from(
          wallet.id,
          transaction.id,
          transaction.ledgerDirectionFor(referenceTransaction)!,
          transaction.getAmount(),
          wallet.getBalance().subtract(transaction.getAmount()),
          balanceAfter,
          wallet.version,
          correlationId,
          causationId,
        );
        em.persist(OutboxMessage.enqueue(balanceEvent));
      }
    } else if (transaction.status === WagerTransactionStatus.REJECTED) {
      const event = WagerTransactionRejected.from(
        transaction.id,
        wallet.id,
        wallet.playerId,
        transaction.providerId,
        transaction.externalTransactionId,
        transaction.kind,
        transaction.getAmount(),
        transaction.roundId,
        transaction.gameId,
        transaction.referenceTransactionId ? undefined : undefined,
        transaction.failureCode!,
        transaction.failureReason!,
        processedAt,
        correlationId,
        causationId,
      );
      em.persist(OutboxMessage.enqueue(event));
    } else if (transaction.status === WagerTransactionStatus.PENDING_REFERENCE) {
      const event = WagerTransactionPendingReference.from(
        transaction.id,
        wallet.id,
        wallet.playerId,
        transaction.providerId,
        transaction.externalTransactionId,
        transaction.kind,
        transaction.getAmount(),
        transaction.roundId,
        transaction.gameId,
        transaction.referenceExternalTransactionId!,
        transaction.createdAt,
        correlationId,
        causationId,
      );
      em.persist(OutboxMessage.enqueue(event));
    }
  }

  async reprocessPendingReferences(): Promise<number> {
    const em = this.em.fork();

    const pendingTxs = await em.getRepository(WagerTransaction).find(
      { status: WagerTransactionStatus.PENDING_REFERENCE },
      { limit: 100 },
    );

    let processed = 0;
    for (const tx of pendingTxs) {
      try {
        await em.transactional(async (txEm) => {
          const referenceTx = await txEm.getRepository(WagerTransaction).findOne({
            providerId: tx.providerId,
            externalTransactionId: tx.referenceExternalTransactionId!,
          });

          if (!referenceTx) {
            return;
          }

        try {
          await this.validateReference(referenceTx, {
            providerId: tx.providerId,
            externalTransactionId: tx.externalTransactionId,
            idempotencyKey: tx.idempotencyKey,
            playerId: tx.playerId,
            walletId: tx.walletId,
            roundId: tx.roundId,
            gameId: tx.gameId,
            kind: tx.kind,
            money: tx.getAmount(),
            referenceExternalTransactionId: tx.referenceExternalTransactionId ?? undefined,
          });
        } catch (e) {
          const code = Object.values(FailureCode).includes((e as Error).message as FailureCode)
            ? (e as Error).message as FailureCode
            : FailureCode.INTERNAL_ERROR;
          tx.reject(code, 'Reference validation failed during reprocessing');
          return;
        }

          const wallet = await txEm.getRepository(Wallet).findOne(
            { id: tx.walletId },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
          );

          if (!wallet) {
            tx.fail(FailureCode.INTERNAL_ERROR, 'Wallet not found');
            return;
          }

          const result = await this.applyTransaction(txEm, wallet, tx, referenceTx);
          const correlationId = randomUUID();
          await this.publishEvents(txEm, wallet, tx, result.newBalance, correlationId, referenceTx);
          processed++;
        });
      } catch (error) {
        this.logger.error('Failed to reprocess pending reference', error instanceof Error ? error.stack : String(error), {
          transactionId: tx.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return processed;
  }

  async reconcileWallet(walletId: string): Promise<{
    storedBalance: Money;
    calculatedBalance: Money;
    difference: Money;
    consistent: boolean;
    checkedEntries: number;
  }> {
    const wallet = await this.walletRepository.findOne({ id: walletId });
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    const entries = await this.ledgerRepository.find(
      { wallet: walletId },
      { orderBy: { createdAt: 'ASC' } },
    );

    let calculated = Money.zero(wallet.currency);
    for (const entry of entries) {
      if (entry.direction === LedgerDirection.CREDIT) {
        calculated = calculated.add(entry.money);
      } else {
        calculated = calculated.subtract(entry.money);
      }
    }

    const stored = wallet.getBalance();
    const difference = stored.isGreaterThan(calculated)
      ? stored.subtract(calculated)
      : calculated.subtract(stored);

    return {
      storedBalance: stored,
      calculatedBalance: calculated,
      difference,
      consistent: difference.isZero(),
      checkedEntries: entries.length,
    };
  }

  async getTransactionById(transactionId: string): Promise<any> {
    return this.transactionRepository.findOne({ id: transactionId });
  }

  async getTransactionByProviderAndExternalId(providerId: string, externalTransactionId: string): Promise<any> {
    return this.transactionRepository.findOne({ providerId, externalTransactionId });
  }

  private static encodeCursor(date: Date, id: string): string {
    const payload = `${date.toISOString()}|${id}`;
    return Buffer.from(payload).toString('base64');
  }

  private static decodeCursor(cursor: string): { date: Date | null; id: string | null } {
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
      const [dateStr, id] = decoded.split('|');
      const date = new Date(dateStr);
      return { date: isNaN(date.getTime()) ? null : date, id: id ?? null };
    } catch {
      return { date: null, id: null };
    }
  }

  async getWalletLedger(walletId: string, cursor?: string, limit = 50): Promise<{ entries: WalletLedgerEntry[]; nextCursor?: string }> {
    const query: Record<string, unknown> = { wallet: walletId };

    if (cursor) {
      const { date: cursorDate, id: cursorId } = WageringService.decodeCursor(cursor);
      if (cursorDate) {
        query.$or = [
          { createdAt: { $gt: cursorDate } },
          { createdAt: cursorDate, id: { $gt: cursorId } },
        ];
      }
    }

    const entries = await this.ledgerRepository.find(
      query,
      {
        orderBy: { createdAt: 'ASC', id: 'ASC' },
        limit: limit + 1,
      },
    );

    let nextCursor: string | undefined;
    if (entries.length > limit) {
      const nextEntry = entries[limit];
      nextCursor = WageringService.encodeCursor(nextEntry.createdAt, nextEntry.id);
      entries.pop();
    }

    return { entries, nextCursor };
  }
}