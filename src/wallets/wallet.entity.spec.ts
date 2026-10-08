import { describe, it, expect } from 'vitest';
import { Wallet } from './wallet.entity.js';
import { Money } from '../domain/money.js';

describe('Wallet', () => {
  describe('open', () => {
    it('should create a new wallet with zero balance', () => {
      const wallet = Wallet.open('player-123', 'USD');

      expect(wallet.id).toBeDefined();
      expect(wallet.playerId).toBe('player-123');
      expect(wallet.currency).toBe('USD');
      expect(wallet.getBalance().equals(Money.zero('USD'))).toBe(true);
      expect(wallet.createdAt).toBeInstanceOf(Date);
    });

    it('should validate currency on open', () => {
      expect(() => Wallet.open('player-123', 'usd')).toThrow(
        'Currency must be uppercase letters only (ISO 4217)',
      );
    });

    it('should reject empty playerId', () => {
      expect(() => Wallet.open('', 'USD')).toThrow('playerId is required');
    });

    it('should reject null playerId', () => {
      expect(() => Wallet.open(null as any, 'USD')).toThrow(
        'playerId is required',
      );
    });

    it('should generate unique ids', () => {
      const wallet1 = Wallet.open('player-123', 'USD');
      const wallet2 = Wallet.open('player-123', 'EUR');
      expect(wallet1.id).not.toBe(wallet2.id);
    });
  });

  describe('rehydrate', () => {
    it('should reconstruct wallet from persistence', () => {
      const id = 'wallet-id';
      const playerId = 'player-123';
      const currency = 'USD';
      const balance = '100.50';
      const version = 5;
      const createdAt = new Date('2024-01-01');
      const updatedAt = new Date('2024-01-02');

      const wallet = Wallet.rehydrate(
        id,
        playerId,
        currency,
        balance,
        version,
        createdAt,
        updatedAt,
      );

      expect(wallet.id).toBe(id);
      expect(wallet.playerId).toBe(playerId);
      expect(wallet.currency).toBe(currency);
      expect(wallet.getBalance().amount).toBe('100.50');
      expect(wallet.version).toBe(version);
      expect(wallet.createdAt).toEqual(createdAt);
      expect(wallet.updatedAt).toEqual(updatedAt);
    });
  });

  describe('credit', () => {
    it('should increase balance on credit', () => {
      const wallet = Wallet.open('player-123', 'USD');
      const amount = Money.fromString('50.00', 'USD');

      const newBalance = wallet.credit(amount);

      expect(newBalance.amount).toBe('50.00');
      expect(wallet.getBalance().amount).toBe('50.00');
    });

    it('should accumulate multiple credits', () => {
      const wallet = Wallet.open('player-123', 'USD');

      wallet.credit(Money.fromString('50.00', 'USD'));
      wallet.credit(Money.fromString('25.50', 'USD'));

      expect(wallet.getBalance().amount).toBe('75.50');
    });

    it('should reject negative credit', () => {
      const wallet = Wallet.open('player-123', 'USD');
      const amount = Money.fromString('-10.00', 'USD');

      expect(() => wallet.credit(amount)).toThrow(
        'Credit amount must be positive',
      );
    });

    it('should reject zero credit', () => {
      const wallet = Wallet.open('player-123', 'USD');
      const amount = Money.zero('USD');

      expect(() => wallet.credit(amount)).toThrow(
        'Credit amount must be positive',
      );
    });

    it('should reject credit with different currency', () => {
      const wallet = Wallet.open('player-123', 'USD');
      const amount = Money.fromString('10.00', 'EUR');

      expect(() => wallet.credit(amount)).toThrow(
        'Currency mismatch: wallet is USD, amount is EUR',
      );
    });
  });

  describe('debit', () => {
    it('should decrease balance on debit', () => {
      const wallet = Wallet.open('player-123', 'USD');
      wallet.credit(Money.fromString('100.00', 'USD'));

      const newBalance = wallet.debit(Money.fromString('30.00', 'USD'));

      expect(newBalance.amount).toBe('70.00');
      expect(wallet.getBalance().amount).toBe('70.00');
    });

    it('should allow debit to reach zero balance', () => {
      const wallet = Wallet.open('player-123', 'USD');
      wallet.credit(Money.fromString('50.00', 'USD'));

      wallet.debit(Money.fromString('50.00', 'USD'));

      expect(wallet.getBalance().isZero()).toBe(true);
    });

    it('should reject debit causing negative balance', () => {
      const wallet = Wallet.open('player-123', 'USD');
      wallet.credit(Money.fromString('50.00', 'USD'));

      expect(() => wallet.debit(Money.fromString('60.00', 'USD'))).toThrow(
        'Insufficient balance',
      );
    });

    it('should reject debit on zero balance', () => {
      const wallet = Wallet.open('player-123', 'USD');

      expect(() => wallet.debit(Money.fromString('10.00', 'USD'))).toThrow(
        'Insufficient balance',
      );
    });

    it('should reject negative debit', () => {
      const wallet = Wallet.open('player-123', 'USD');
      const amount = Money.fromString('-10.00', 'USD');

      expect(() => wallet.debit(amount)).toThrow(
        'Debit amount must be positive',
      );
    });

    it('should reject zero debit', () => {
      const wallet = Wallet.open('player-123', 'USD');
      const amount = Money.zero('USD');

      expect(() => wallet.debit(amount)).toThrow(
        'Debit amount must be positive',
      );
    });

    it('should reject debit with different currency', () => {
      const wallet = Wallet.open('player-123', 'USD');
      wallet.credit(Money.fromString('100.00', 'USD'));
      const amount = Money.fromString('10.00', 'EUR');

      expect(() => wallet.debit(amount)).toThrow(
        'Currency mismatch: wallet is USD, amount is EUR',
      );
    });
  });

  describe('getBalance', () => {
    it('should return Money object', () => {
      const wallet = Wallet.open('player-123', 'USD');
      wallet.credit(Money.fromString('75.50', 'USD'));

      const balance = wallet.getBalance();

      expect(balance).toBeInstanceOf(Money);
      expect(balance.amount).toBe('75.50');
      expect(balance.currency).toBe('USD');
    });

    it('should return immutable Money', () => {
      const wallet = Wallet.open('player-123', 'USD');
      wallet.credit(Money.fromString('50.00', 'USD'));

      const balance1 = wallet.getBalance();
      wallet.credit(Money.fromString('25.00', 'USD'));
      const balance2 = wallet.getBalance();

      expect(balance1.amount).toBe('50.00');
      expect(balance2.amount).toBe('75.00');
    });
  });

  describe('encapsulation', () => {
    it('should expose only readonly properties through getters', () => {
      const wallet = Wallet.open('player-123', 'USD');
      
      expect(wallet.id).toBeDefined();
      expect(wallet.playerId).toBe('player-123');
      expect(wallet.currency).toBe('USD');
      expect(wallet.getBalance()).toBeInstanceOf(Money);
    });

    it('should require operations through methods', () => {
      const wallet = Wallet.open('player-123', 'USD');
      
      wallet.credit(Money.fromString('100.00', 'USD'));
      expect(wallet.getBalance().amount).toBe('100.00');
      
      wallet.debit(Money.fromString('30.00', 'USD'));
      expect(wallet.getBalance().amount).toBe('70.00');
    });
  });

  describe('complex scenarios', () => {
    it('should handle multiple operations correctly', () => {
      const wallet = Wallet.open('player-123', 'USD');

      wallet.credit(Money.fromString('100.00', 'USD'));
      wallet.debit(Money.fromString('30.00', 'USD'));
      wallet.credit(Money.fromString('20.00', 'USD'));
      wallet.debit(Money.fromString('15.00', 'USD'));

      expect(wallet.getBalance().amount).toBe('75.00');
    });

    it('should maintain precision with small amounts', () => {
      const wallet = Wallet.open('player-123', 'USD');

      wallet.credit(Money.fromString('0.01', 'USD'));
      wallet.credit(Money.fromString('0.02', 'USD'));

      expect(wallet.getBalance().amount).toBe('0.03');
    });

    it('should handle large amounts', () => {
      const wallet = Wallet.open('player-123', 'USD');

      wallet.credit(Money.fromString('999999.99', 'USD'));

      expect(wallet.getBalance().amount).toBe('999999.99');
    });
  });
});
