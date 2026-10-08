import { describe, it, expect } from 'vitest';
import { WalletLedgerEntry, CreateLedgerEntryProps } from './wallet-ledger-entry.entity.js';
import { Wallet } from '../wallets/wallet.entity.js';
import { WagerTransaction } from '../transactions/wager-transaction.entity.js';
import { Money } from '../domain/money.js';
import { LedgerDirection, WagerTransactionKind, WagerTransactionStatus } from '../domain/enums.js';

const makeWallet = (currency = 'BRL') => 
  Wallet.rehydrate(
    'w-1',
    'p-1',
    currency,
    '100.00',
    1,
    new Date(),
    new Date(),
  );

const makeTransaction = (id = 'tx-1') =>
  WagerTransaction.rehydrate(
    id,
    'w-1',
    'prov-a',
    'ext-1',
    'prov-a:ext-1',
    WagerTransactionKind.BET,
    '25.00',
    'BRL',
    'p-1',
    'r-1',
    'game-1',
    undefined,
    WagerTransactionStatus.PROCESSED,
    'hash-1',
    undefined,
    undefined,
    new Date(),
    undefined,
  );

const makeProps = (overrides: Partial<CreateLedgerEntryProps> = {}): CreateLedgerEntryProps => ({
  wallet: makeWallet(),
  transaction: makeTransaction(),
  direction: LedgerDirection.DEBIT,
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
      expect(entry.direction).toBe(LedgerDirection.DEBIT);
      expect(entry.money.equals(Money.fromString('25.00', 'BRL'))).toBe(true);
      expect(entry.balanceBefore.equals(Money.fromString('100.00', 'BRL'))).toBe(true);
      expect(entry.balanceAfter.equals(Money.fromString('75.00', 'BRL'))).toBe(true);
      expect(entry.isBalanced()).toBe(true);
    });

    it('should create valid CREDIT entry', () => {
      const entry = WalletLedgerEntry.create({
        ...makeProps(),
        direction: LedgerDirection.CREDIT,
        balanceBefore: Money.fromString('75.00', 'BRL'),
        balanceAfter: Money.fromString('100.00', 'BRL'),
      });
      expect(entry.direction).toBe(LedgerDirection.CREDIT);
      expect(entry.isBalanced()).toBe(true);
    });

    it('should reject zero money', () => {
      expect(() => WalletLedgerEntry.create({
        ...makeProps(),
        money: Money.zero('BRL'),
      })).toThrow('O valor do lançamento contábil deve ser positivo.');
    });

    it('should reject negative money', () => {
      expect(() => WalletLedgerEntry.create({
        ...makeProps(),
        money: Money.fromString('-25.00', 'BRL'),
      })).toThrow();
    });

    it('should reject currency mismatch wallet vs money', () => {
      expect(() => WalletLedgerEntry.create({
        ...makeProps(),
        wallet: makeWallet('USD'),
        money: Money.fromString('25.00', 'BRL'),
      })).toThrow('Incompatibilidade de moeda na carteira.');
    });

    it('should reject currency mismatch balanceBefore vs money', () => {
      expect(() => WalletLedgerEntry.create({
        ...makeProps(),
        balanceBefore: Money.fromString('100.00', 'USD'),
      })).toThrow('Irregularidade cambial no lançamento contábil.');
    });

    it('should reject invalid DEBIT arithmetic', () => {
      expect(() => WalletLedgerEntry.create({
        ...makeProps(),
        balanceAfter: Money.fromString('80.00', 'BRL'),
      })).toThrow('Cálculo contábil inválido');
    });

    it('should reject invalid CREDIT arithmetic', () => {
      expect(() => WalletLedgerEntry.create({
        ...makeProps(),
        direction: LedgerDirection.CREDIT,
        balanceBefore: Money.fromString('75.00', 'BRL'),
        balanceAfter: Money.fromString('90.00', 'BRL'),
      })).toThrow('Cálculo contábil inválido');
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