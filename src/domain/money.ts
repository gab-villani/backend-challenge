import { Decimal } from 'decimal.js';

export class Money {
  private constructor(
    public readonly amount: string,
    public readonly currency: string,
  ) {
    Object.freeze(this);
  }

  static zero(currency: string): Money {
    Money.validateCurrency(currency);
    return new Money('0.00', currency);
  }

  static fromString(amount: string, currency: string): Money {
    Money.validateCurrency(currency);
    Money.validateAmount(amount);

    const normalized = Money.normalizeAmount(amount);
    return new Money(normalized, currency);
  }

  static fromNumber(amount: number, currency: string): Money {
    if (!Number.isFinite(amount)) {
      throw new Error('Amount must be a finite number');
    }
    return Money.fromString(amount.toFixed(2), currency);
  }

  add(other: Money): Money {
    this.ensureSameCurrency(other);
    const result = new Decimal(this.amount)
      .add(new Decimal(other.amount))
      .toFixed(2);
    return new Money(result, this.currency);
  }

  subtract(other: Money): Money {
    this.ensureSameCurrency(other);
    const result = new Decimal(this.amount)
      .sub(new Decimal(other.amount))
      .toFixed(2);
    return new Money(result, this.currency);
  }

  isPositive(): boolean {
    return new Decimal(this.amount).greaterThan(0);
  }

  isZero(): boolean {
    return new Decimal(this.amount).isZero();
  }

  isNegative(): boolean {
    return new Decimal(this.amount).lessThan(0);
  }

  isGreaterThan(other: Money): boolean {
    this.ensureSameCurrency(other);
    return new Decimal(this.amount).greaterThan(new Decimal(other.amount));
  }

  isGreaterThanOrEqual(other: Money): boolean {
    this.ensureSameCurrency(other);
    return new Decimal(this.amount).greaterThanOrEqualTo(
      new Decimal(other.amount),
    );
  }

  isLessThan(other: Money): boolean {
    this.ensureSameCurrency(other);
    return new Decimal(this.amount).lessThan(new Decimal(other.amount));
  }

  equals(other: Money): boolean {
    return (
      this.currency === other.currency && this.amount === other.amount
    );
  }

  toJSON(): { amount: string; currency: string } {
    return { amount: this.amount, currency: this.currency };
  }

  private ensureSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `Currency mismatch: ${this.currency} vs ${other.currency}`,
      );
    }
  }

  private static validateCurrency(currency: string): void {
    if (!currency || typeof currency !== 'string') {
      throw new Error('Currency is required and must be a string');
    }
    if (currency.length !== 3) {
      throw new Error('Currency must be a 3-letter ISO code');
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error(
        'Currency must be uppercase letters only (ISO 4217)',
      );
    }
  }

  private static validateAmount(amount: string): void {
    if (!amount || typeof amount !== 'string') {
      throw new Error('Amount is required and must be a string');
    }
    if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) {
      throw new Error(
        'Amount must be a decimal string with at most 2 decimal places',
      );
    }
  }

  private static normalizeAmount(amount: string): string {
    return new Decimal(amount).toFixed(2);
  }
}
