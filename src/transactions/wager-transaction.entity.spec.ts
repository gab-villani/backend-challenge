import { describe, it, expect } from 'vitest';
import { WagerTransaction } from './wager-transaction.entity.js';
import { Money } from '../domain/money.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
  FailureCode,
  LedgerDirection,
} from '../domain/enums.js';

describe('WagerTransaction', () => {
  const validParams = {
    walletId: 'wallet-123',
    providerId: 'provider-abc',
    externalTransactionId: 'ext-tx-456',
    idempotencyKey: 'idem-key-789',
    amount: Money.fromString('100.00', 'USD'),
    playerId: 'player-999',
    roundId: 'round-555',
    gameId: 'game-123',
    payloadHash: 'hash123',
  };

  describe('create', () => {
    it('should create a BET transaction in PENDING status', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.BET,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        null,
        null,
        validParams.payloadHash,
      );

      expect(tx.id).toBeDefined();
      expect(tx.kind).toBe(WagerTransactionKind.BET);
      expect(tx.status).toBe(WagerTransactionStatus.PENDING);
      expect(tx.getAmount().equals(validParams.amount)).toBe(true);
      expect(tx.referenceTransactionId).toBeNull();
    });

    it('should create a REFUND transaction in PENDING_REFERENCE status', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.REFUND,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        'ref-tx-123',
        'ref-ext-tx-123',
        validParams.payloadHash,
      );

      expect(tx.status).toBe(WagerTransactionStatus.PENDING_REFERENCE);
      expect(tx.referenceTransactionId).toBe('ref-tx-123');
    });

    it('should reject OPENING kind', () => {
      expect(() =>
        WagerTransaction.create(
          validParams.walletId,
          validParams.providerId,
          validParams.externalTransactionId,
          validParams.idempotencyKey,
          WagerTransactionKind.OPENING,
          validParams.amount,
          validParams.playerId,
          validParams.roundId,
          validParams.gameId,
          null,
          null,
          validParams.payloadHash,
        ),
      ).toThrow('OPENING transactions cannot be created via API/SQS');
    });

    it('should reject negative amount', () => {
      const negativeAmount = Money.fromString('-50.00', 'USD');

      expect(() =>
        WagerTransaction.create(
          validParams.walletId,
          validParams.providerId,
          validParams.externalTransactionId,
          validParams.idempotencyKey,
          WagerTransactionKind.BET,
          negativeAmount,
          validParams.playerId,
          validParams.roundId,
          validParams.gameId,
          null,
          null,
          validParams.payloadHash,
        ),
      ).toThrow('Transaction amount cannot be negative');
    });

    it('should require reference for REFUND', () => {
      expect(() =>
        WagerTransaction.create(
          validParams.walletId,
          validParams.providerId,
          validParams.externalTransactionId,
          validParams.idempotencyKey,
          WagerTransactionKind.REFUND,
          validParams.amount,
          validParams.playerId,
          validParams.roundId,
          validParams.gameId,
          null,
          null,
          validParams.payloadHash,
        ),
      ).toThrow('REFUND requires a reference transaction');
    });

    it('should require reference for ROLLBACK', () => {
      expect(() =>
        WagerTransaction.create(
          validParams.walletId,
          validParams.providerId,
          validParams.externalTransactionId,
          validParams.idempotencyKey,
          WagerTransactionKind.ROLLBACK,
          validParams.amount,
          validParams.playerId,
          validParams.roundId,
          validParams.gameId,
          null,
          null,
          validParams.payloadHash,
        ),
      ).toThrow('ROLLBACK requires a reference transaction');
    });

    it('should reject reference for BET', () => {
      expect(() =>
        WagerTransaction.create(
          validParams.walletId,
          validParams.providerId,
          validParams.externalTransactionId,
          validParams.idempotencyKey,
          WagerTransactionKind.BET,
          validParams.amount,
          validParams.playerId,
          validParams.roundId,
          validParams.gameId,
          'ref-tx-123',
          'ref-ext-tx-123',
          validParams.payloadHash,
        ),
      ).toThrow('BET cannot have a reference transaction');
    });

    it('should reject reference for WIN', () => {
      expect(() =>
        WagerTransaction.create(
          validParams.walletId,
          validParams.providerId,
          validParams.externalTransactionId,
          validParams.idempotencyKey,
          WagerTransactionKind.WIN,
          validParams.amount,
          validParams.playerId,
          validParams.roundId,
          validParams.gameId,
          'ref-tx-123',
          'ref-ext-tx-123',
          validParams.payloadHash,
        ),
      ).toThrow('WIN cannot have a reference transaction');
    });
  });

  describe('markProcessed', () => {
    it('should transition from PENDING to PROCESSED', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.BET,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        null,
        null,
        validParams.payloadHash,
      );

      tx.markProcessed();

      expect(tx.status).toBe(WagerTransactionStatus.PROCESSED);
      expect(tx.processedAt).toBeInstanceOf(Date);
    });

    it('should transition from PENDING_REFERENCE to PROCESSED', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.REFUND,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        'ref-tx-123',
        'ref-ext-tx-123',
        validParams.payloadHash,
      );

      tx.markProcessed();

      expect(tx.status).toBe(WagerTransactionStatus.PROCESSED);
    });

    it('should reject transition from PROCESSED', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.BET,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        null,
        null,
        validParams.payloadHash,
      );

      tx.markProcessed();

      expect(() => tx.markProcessed()).toThrow(
        'Cannot mark as processed: transaction is PROCESSED',
      );
    });

    it('should reject transition from REJECTED', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.BET,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        null,
        null,
        validParams.payloadHash,
      );

      tx.reject(FailureCode.INSUFFICIENT_BALANCE, 'Not enough funds');

      expect(() => tx.markProcessed()).toThrow(
        'Cannot mark as processed: transaction is REJECTED',
      );
    });
  });

  describe('reject', () => {
    it('should transition to REJECTED with code and reason', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.BET,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        null,
        null,
        validParams.payloadHash,
      );

      tx.reject(FailureCode.INSUFFICIENT_BALANCE, 'Balance too low');

      expect(tx.status).toBe(WagerTransactionStatus.REJECTED);
      expect(tx.failureCode).toBe(FailureCode.INSUFFICIENT_BALANCE);
      expect(tx.failureReason).toBe('Balance too low');
      expect(tx.processedAt).toBeInstanceOf(Date);
    });

    it('should reject transition from terminal state', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.BET,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        null,
        null,
        validParams.payloadHash,
      );

      tx.markProcessed();

      expect(() =>
        tx.reject(FailureCode.INVALID_PAYLOAD, 'reason'),
      ).toThrow('Cannot reject: transaction is already terminal (PROCESSED)');
    });
  });

  describe('fail', () => {
    it('should transition to FAILED with code and reason', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.BET,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        null,
        null,
        validParams.payloadHash,
      );

      tx.fail(FailureCode.INTERNAL_ERROR, 'Database connection failed');

      expect(tx.status).toBe(WagerTransactionStatus.FAILED);
      expect(tx.failureCode).toBe(FailureCode.INTERNAL_ERROR);
      expect(tx.failureReason).toBe('Database connection failed');
      expect(tx.processedAt).toBeInstanceOf(Date);
    });
  });

  describe('affectsBalance', () => {
    it('should return true for BET', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.BET,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        null,
        null,
        validParams.payloadHash,
      );

      expect(tx.affectsBalance()).toBe(true);
    });

    it('should return true for WIN', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.WIN,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        null,
        null,
        validParams.payloadHash,
      );

      expect(tx.affectsBalance()).toBe(true);
    });

    it('should return false for LOSS', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.LOSS,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        null,
        null,
        validParams.payloadHash,
      );

      expect(tx.affectsBalance()).toBe(false);
    });

    it('should return true for REFUND', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.REFUND,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        'ref-tx-123',
        'ref-ext-tx-123',
        validParams.payloadHash,
      );

      expect(tx.affectsBalance()).toBe(true);
    });

    it('should return true for ROLLBACK', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.ROLLBACK,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        'ref-tx-123',
        'ref-ext-tx-123',
        validParams.payloadHash,
      );

      expect(tx.affectsBalance()).toBe(true);
    });
  });

  describe('requiresReference', () => {
    it('should return true for REFUND', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.REFUND,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        'ref-tx-123',
        'ref-ext-tx-123',
        validParams.payloadHash,
      );

      expect(tx.requiresReference()).toBe(true);
    });

    it('should return true for ROLLBACK', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.ROLLBACK,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        'ref-tx-123',
        'ref-ext-tx-123',
        validParams.payloadHash,
      );

      expect(tx.requiresReference()).toBe(true);
    });

    it('should return false for BET', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.BET,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        null,
        null,
        validParams.payloadHash,
      );

      expect(tx.requiresReference()).toBe(false);
    });
  });

  describe('ledgerDirectionFor', () => {
    it('should return DEBIT for BET', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.BET,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        null,
        null,
        validParams.payloadHash,
      );

      expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.DEBIT);
    });

    it('should return CREDIT for WIN', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.WIN,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        null,
        null,
        validParams.payloadHash,
      );

      expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.CREDIT);
    });

    it('should return CREDIT for REFUND', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.REFUND,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        'ref-tx-123',
        'ref-ext-tx-123',
        validParams.payloadHash,
      );

      expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.CREDIT);
    });

    it('should return DEBIT for ROLLBACK', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.ROLLBACK,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        'ref-tx-123',
        'ref-ext-tx-123',
        validParams.payloadHash,
      );

      expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.DEBIT);
    });

    it('should return null for LOSS', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.LOSS,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        null,
        null,
        validParams.payloadHash,
      );

      expect(tx.ledgerDirectionFor()).toBeNull();
    });
  });

  describe('status checks', () => {
    it('should identify pending status', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.BET,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        null,
        null,
        validParams.payloadHash,
      );

      expect(tx.isPending()).toBe(true);
      expect(tx.isTerminal()).toBe(false);
    });

    it('should identify terminal status', () => {
      const tx = WagerTransaction.create(
        validParams.walletId,
        validParams.providerId,
        validParams.externalTransactionId,
        validParams.idempotencyKey,
        WagerTransactionKind.BET,
        validParams.amount,
        validParams.playerId,
        validParams.roundId,
        validParams.gameId,
        null,
        null,
        validParams.payloadHash,
      );

      tx.markProcessed();

      expect(tx.isPending()).toBe(false);
      expect(tx.isTerminal()).toBe(true);
    });
  });

  describe('rehydrate', () => {
    it('should reconstruct transaction from persistence', () => {
      const tx = WagerTransaction.rehydrate(
        'tx-id',
        'wallet-123',
        'provider-abc',
        'ext-tx-456',
        'idem-key',
        WagerTransactionKind.BET,
        '100.00',
        'USD',
        'player-999',
        'round-555',
        'game-123',
        null,
        null,
        WagerTransactionStatus.PROCESSED,
        'hash123',
        null,
        null,
        new Date('2024-01-01'),
        new Date('2024-01-02'),
      );

      expect(tx.id).toBe('tx-id');
      expect(tx.status).toBe(WagerTransactionStatus.PROCESSED);
      expect(tx.processedAt).toEqual(new Date('2024-01-02'));
    });
  });
});
