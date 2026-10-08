import { describe, it, expect } from 'vitest';
import { Money } from './money.js';

describe('Money', () => {
  describe('construction', () => {
    it('should create money from valid string amount and currency', () => {
      const money = Money.fromString('10.50', 'USD');
      expect(money.amount).toBe('10.50');
      expect(money.currency).toBe('USD');
    });

    it('should create zero money', () => {
      const money = Money.zero('EUR');
      expect(money.amount).toBe('0.00');
      expect(money.currency).toBe('EUR');
    });

    it('should normalize amount to 2 decimal places', () => {
      const money = Money.fromString('10.5', 'USD');
      expect(money.amount).toBe('10.50');
    });

    it('should create money from number', () => {
      const money = Money.fromNumber(10.5, 'USD');
      expect(money.amount).toBe('10.50');
      expect(money.currency).toBe('USD');
    });

    it('should reject non-finite numbers', () => {
      expect(() => Money.fromNumber(Number.NaN, 'USD')).toThrow(
        'Amount must be a finite number',
      );
      expect(() => Money.fromNumber(Number.POSITIVE_INFINITY, 'USD')).toThrow(
        'Amount must be a finite number',
      );
    });

    it('should be immutable', () => {
      const money = Money.fromString('10.00', 'USD');
      expect(Object.isFrozen(money)).toBe(true);
    });
  });

  describe('currency validation', () => {
    it('should reject empty currency', () => {
      expect(() => Money.fromString('10.00', '')).toThrow(
        'Currency is required and must be a string',
      );
    });

    it('should reject non-string currency', () => {
      expect(() => Money.fromString('10.00', null as any)).toThrow(
        'Currency is required and must be a string',
      );
    });

    it('should reject currency not 3 letters', () => {
      expect(() => Money.fromString('10.00', 'US')).toThrow(
        'Currency must be a 3-letter ISO code',
      );
      expect(() => Money.fromString('10.00', 'USDD')).toThrow(
        'Currency must be a 3-letter ISO code',
      );
    });

    it('should reject lowercase currency', () => {
      expect(() => Money.fromString('10.00', 'usd')).toThrow(
        'Currency must be uppercase letters only (ISO 4217)',
      );
    });

    it('should reject currency with numbers', () => {
      expect(() => Money.fromString('10.00', 'U5D')).toThrow(
        'Currency must be uppercase letters only (ISO 4217)',
      );
    });
  });

  describe('amount validation', () => {
    it('should reject empty amount', () => {
      expect(() => Money.fromString('', 'USD')).toThrow(
        'Amount is required and must be a string',
      );
    });

    it('should reject non-string amount', () => {
      expect(() => Money.fromString(null as any, 'USD')).toThrow(
        'Amount is required and must be a string',
      );
    });

    it('should reject amount with more than 2 decimal places', () => {
      expect(() => Money.fromString('10.123', 'USD')).toThrow(
        'Amount must be a decimal string with at most 2 decimal places',
      );
    });

    it('should reject non-numeric amount', () => {
      expect(() => Money.fromString('abc', 'USD')).toThrow(
        'Amount must be a decimal string with at most 2 decimal places',
      );
    });

    it('should accept negative amounts', () => {
      const money = Money.fromString('-10.50', 'USD');
      expect(money.amount).toBe('-10.50');
    });

    it('should accept zero decimal places', () => {
      const money = Money.fromString('10', 'USD');
      expect(money.amount).toBe('10.00');
    });

    it('should accept one decimal place', () => {
      const money = Money.fromString('10.5', 'USD');
      expect(money.amount).toBe('10.50');
    });
  });

  describe('arithmetic operations', () => {
    it('should add money with same currency', () => {
      const a = Money.fromString('10.50', 'USD');
      const b = Money.fromString('5.25', 'USD');
      const result = a.add(b);
      expect(result.amount).toBe('15.75');
      expect(result.currency).toBe('USD');
    });

    it('should subtract money with same currency', () => {
      const a = Money.fromString('10.50', 'USD');
      const b = Money.fromString('5.25', 'USD');
      const result = a.subtract(b);
      expect(result.amount).toBe('5.25');
      expect(result.currency).toBe('USD');
    });

    it('should reject add with different currencies', () => {
      const a = Money.fromString('10.00', 'USD');
      const b = Money.fromString('5.00', 'EUR');
      expect(() => a.add(b)).toThrow('Currency mismatch: USD vs EUR');
    });

    it('should reject subtract with different currencies', () => {
      const a = Money.fromString('10.00', 'USD');
      const b = Money.fromString('5.00', 'EUR');
      expect(() => a.subtract(b)).toThrow('Currency mismatch: USD vs EUR');
    });

    it('should not mutate original money on operations', () => {
      const a = Money.fromString('10.00', 'USD');
      const b = Money.fromString('5.00', 'USD');
      a.add(b);
      expect(a.amount).toBe('10.00');
      expect(b.amount).toBe('5.00');
    });
  });

  describe('comparison operations', () => {
    it('should identify positive money', () => {
      expect(Money.fromString('10.00', 'USD').isPositive()).toBe(true);
      expect(Money.fromString('0.00', 'USD').isPositive()).toBe(false);
      expect(Money.fromString('-10.00', 'USD').isPositive()).toBe(false);
    });

    it('should identify zero money', () => {
      expect(Money.fromString('0.00', 'USD').isZero()).toBe(true);
      expect(Money.fromString('0.01', 'USD').isZero()).toBe(false);
      expect(Money.fromString('-0.01', 'USD').isZero()).toBe(false);
    });

    it('should identify negative money', () => {
      expect(Money.fromString('-10.00', 'USD').isNegative()).toBe(true);
      expect(Money.fromString('0.00', 'USD').isNegative()).toBe(false);
      expect(Money.fromString('10.00', 'USD').isNegative()).toBe(false);
    });

    it('should compare greater than', () => {
      const a = Money.fromString('10.00', 'USD');
      const b = Money.fromString('5.00', 'USD');
      expect(a.isGreaterThan(b)).toBe(true);
      expect(b.isGreaterThan(a)).toBe(false);
    });

    it('should compare greater than or equal', () => {
      const a = Money.fromString('10.00', 'USD');
      const b = Money.fromString('10.00', 'USD');
      const c = Money.fromString('5.00', 'USD');
      expect(a.isGreaterThanOrEqual(b)).toBe(true);
      expect(a.isGreaterThanOrEqual(c)).toBe(true);
      expect(c.isGreaterThanOrEqual(a)).toBe(false);
    });

    it('should compare less than', () => {
      const a = Money.fromString('5.00', 'USD');
      const b = Money.fromString('10.00', 'USD');
      expect(a.isLessThan(b)).toBe(true);
      expect(b.isLessThan(a)).toBe(false);
    });

    it('should reject comparisons with different currencies', () => {
      const a = Money.fromString('10.00', 'USD');
      const b = Money.fromString('5.00', 'EUR');
      expect(() => a.isGreaterThan(b)).toThrow('Currency mismatch: USD vs EUR');
    });

    it('should check equality', () => {
      const a = Money.fromString('10.00', 'USD');
      const b = Money.fromString('10.00', 'USD');
      const c = Money.fromString('10.00', 'EUR');
      const d = Money.fromString('5.00', 'USD');
      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
      expect(a.equals(d)).toBe(false);
    });
  });

  describe('serialization', () => {
    it('should serialize to JSON', () => {
      const money = Money.fromString('10.50', 'USD');
      expect(money.toJSON()).toEqual({ amount: '10.50', currency: 'USD' });
    });
  });

  describe('edge cases', () => {
    it('should handle large amounts', () => {
      const money = Money.fromString('999999999.99', 'USD');
      expect(money.amount).toBe('999999999.99');
    });

    it('should handle precision in addition', () => {
      const a = Money.fromString('0.01', 'USD');
      const b = Money.fromString('0.02', 'USD');
      const result = a.add(b);
      expect(result.amount).toBe('0.03');
    });

    it('should handle precision in subtraction', () => {
      const a = Money.fromString('0.03', 'USD');
      const b = Money.fromString('0.01', 'USD');
      const result = a.subtract(b);
      expect(result.amount).toBe('0.02');
    });

    it('should handle subtraction resulting in negative', () => {
      const a = Money.fromString('5.00', 'USD');
      const b = Money.fromString('10.00', 'USD');
      const result = a.subtract(b);
      expect(result.amount).toBe('-5.00');
      expect(result.isNegative()).toBe(true);
    });
  });
  
});
