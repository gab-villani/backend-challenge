import { describe, it, expect } from 'vitest';
import { WalletLedgerEntry, CreateLedgerEntryProps } from './wallet-ledger-entry.entity';
import { Wallet } from '../wallets/wallet.entity';
import { WagerTransaction } from '../transactions/wager-transaction.entity';
import { Money } from '../domain/money';
import { LedgerDirection, WagerTransactionKind, WagerTransactionStatus } from '../domain/enums';

const makeWallet = (currency = 'BRL') => 
  Wallet.rehydrate({
    id: 'w-1',
    playerId: 'p-1',
    currency,
    balance: '100.00',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

const makeTransaction = (id = 'tx-1') =>
  WagerTransaction.rehydrate({
    id,
    providerId: 'prov-a',
    externalTransactionId: 'ext-1',
    idempotencyKey: 'prov-a:ext-1',
    payloadHash: 'hash-1',
    walletId: 'w-1',
    playerId: 'p-1',
    roundId: 'r-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    moneyAmount: '25.00',
    moneyCurrency: 'BRL',
    referenceExternalTransactionId: undefined,
    status: WagerTransactionStatus.Processed,
    referenceTransactionId: undefined,
    failureCode: undefined,
    processedAt: undefined,
    createdAt: new Date(),
  });

const makeProps = (overrides: Partial<CreateLedgerEntryProps> = {}): CreateLedgerEntryProps => ({
  wallet: makeWallet(),
  transaction: makeTransaction(),
  direction: LedgerDirection.Debit,
  money: Money.fromString('25.00', 'BRL'),
  balanceBefore: Money.fromString('100.00', 'BRL'),
  balanceAfter: Money.fromString('75.00', 'BRL'),
  ...overrides,
});

describe('WalletLedgerEntry', () => {
  describe('create', () => {
    it('should create valid DEBIT entry', () => {
      const entry = WalletLedgerEntry.create(makeProps());
      expect(entry.id).toBeDefined();
      expect(entry.direction).toBe(LedgerDirection.Debit);
      expect(entry.money.equals(Money.fromString('25.00', 'BRL'))).toBe(true);
      expect(entry.balanceBefore.equals(Money.fromString('100.00', 'BRL'))).toBe(true);
      expect(entry.balanceAfter.equals(Money.fromString('75.00', 'BRL'))).toBe(true);
      expect(entry.isBalanced()).toBe(true);
    });

    it('should create valid CREDIT entry', () => {
      const entry = WalletLedgerEntry.create({
        ...makeProps(),
        direction: LedgerDirection.Credit,
        balanceBefore: Money.fromString('75.00', 'BRL'),
        balanceAfter: Money.fromString('100.00', 'BRL'),
      });
      expect(entry.direction).toBe(LedgerDirection.Credit);
      expect(entry.isBalanced()).toBe(true);
    });

    it('should reject zero money', () => {
      expect(() => WalletLedgerEntry.create({
        ...makeProps(),
        money: Money.zero('BRL'),
      })).toThrow('Ledger entry money must be positive');
    });

    it('should reject negative money', () => {
      expect(() => WalletLedgerEntry.create({
        ...makeProps(),
        money: Money.fromString('25.00', 'BRL').negate(), // se existisse
      })).toThrow();
    });

    it('should reject currency mismatch wallet vs money', () => {
      expect(() => WalletLedgerEntry.create({
        ...makeProps(),
        wallet: makeWallet('USD'),
        money: Money.fromString('25.00', 'BRL'),
      })).toThrow('Wallet currency mismatch');
    });

    it('should reject currency mismatch balanceBefore vs money', () => {
      expect(() => WalletLedgerEntry.create({
        ...makeProps(),
        balanceBefore: Money.fromString('100.00', 'USD'),
      })).toThrow('Currency mismatch in ledger entry');
    });

    it('should reject invalid DEBIT arithmetic', () => {
      expect(() => WalletLedgerEntry.create({
        ...makeProps(),
        balanceAfter: Money.fromString('80.00', 'BRL'), // 100 - 25 = 75, não 80
      })).toThrow('Ledger arithmetic invalid');
    });

    it('should reject invalid CREDIT arithmetic', () => {
      expect(() => WalletLedgerEntry.create({
        ...makeProps(),
        direction: LedgerDirection.Credit,
        balanceBefore: Money.fromString('75.00', 'BRL'),
        balanceAfter: Money.fromString('90.00', 'BRL'), // 75 + 25 = 100, não 90
      })).toThrow('Ledger arithmetic invalid');
    });
  });

  describe('rehydrate', () => {
    it('should reconstruct entry without revalidating', () => {
      const state = {
        id: 'ledger-1',
        walletId: 'w-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Debit,
        moneyAmount: '25.00',
        moneyCurrency: 'BRL',
        balanceBeforeAmount: '100.00',
        balanceBeforeCurrency: 'BRL',
        balanceAfterAmount: '75.00',
        balanceAfterCurrency: 'BRL',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };

      const entry = WalletLedgerEntry.rehydrate(state);
      expect(entry.id).toBe('ledger-1');
      expect(entry.money.equals(Money.fromString('25.00', 'BRL'))).toBe(true);
      expect(entry.isBalanced()).toBe(true);
    });
  });

  describe('immutability', () => {
    it('should be frozen', () => {
      const entry = WalletLedgerEntry.create(makeProps());
      expect(Object.isFrozen(entry)).toBe(true);
    });

    it('should not allow property mutation', () => {
      const entry = WalletLedgerEntry.create(makeProps());
      expect(() => { entry.direction = LedgerDirection.Credit; }).toThrow();
    });
  });

  describe('toJSON', () => {
    it('should serialize with MoneyProps format', () => {
      const entry = WalletLedgerEntry.create(makeProps());
      const json = entry.toJSON();
      expect(json.money).toEqual({ amount: '25.00', currency: 'BRL' });
      expect(json.balanceBefore).toEqual({ amount: '100.00', currency: 'BRL' });
      expect(json.balanceAfter).toEqual({ amount: '75.00', currency: 'BRL' });
    });
  });
});