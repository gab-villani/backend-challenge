import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import { randomUUID } from 'node:crypto';
import { Money } from '../domain/money.js';

@Entity({ tableName: 'wallets' })
export class Wallet {
  @PrimaryKey({ type: 'uuid' })
  protected readonly _id: string;

  @Property({ type: 'string', fieldName: 'player_id' })
  protected readonly _playerId: string;

  @Property({ type: 'string', length: 3 })
  protected readonly _currency: string;

  @Property({
    type: 'string',
    columnType: 'numeric(18, 2)',
    default: '0.00',
  })
  protected _balance: string;

  @Property({ type: 'number', version: true })
  protected _version!: number;

  @Property({ type: 'Date', fieldName: 'created_at' })
  protected readonly _createdAt: Date;

  @Property({
    type: 'Date',
    fieldName: 'updated_at',
    onUpdate: () => new Date(),
  })
  protected _updatedAt: Date;

  private constructor(
    id: string,
    playerId: string,
    currency: string,
    balance: string,
    createdAt: Date,
  ) {
    this._id = id;
    this._playerId = playerId;
    this._currency = currency;
    this._balance = balance;
    this._createdAt = createdAt;
    this._updatedAt = createdAt;
  }

  static open(playerId: string, currency: string): Wallet {
    if (!playerId || typeof playerId !== 'string') {
      throw new Error('playerId is required');
    }

    const initialBalance = Money.zero(currency);

    return new Wallet(
      randomUUID(),
      playerId,
      currency,
      initialBalance.amount,
      new Date(),
    );
  }

  static rehydrate(
    id: string,
    playerId: string,
    currency: string,
    balance: string,
    version: number,
    createdAt: Date,
    updatedAt: Date,
  ): Wallet {
    const wallet = new Wallet(id, playerId, currency, balance, createdAt);
    wallet._version = version;
    wallet._updatedAt = updatedAt;
    return wallet;
  }

  credit(amount: Money): Money {
    this.ensureSameCurrency(amount);

    if (amount.isNegative() || amount.isZero()) {
      throw new Error('Credit amount must be positive');
    }

    const currentBalance = this.getBalance();
    const newBalance = currentBalance.add(amount);

    this._balance = newBalance.amount;
    return newBalance;
  }

  debit(amount: Money): Money {
    this.ensureSameCurrency(amount);

    if (amount.isNegative() || amount.isZero()) {
      throw new Error('Debit amount must be positive');
    }

    const currentBalance = this.getBalance();
    const newBalance = currentBalance.subtract(amount);

    if (newBalance.isNegative()) {
      throw new Error('Insufficient balance');
    }

    this._balance = newBalance.amount;
    return newBalance;
  }

  getBalance(): Money {
    return Money.fromString(this._balance, this._currency);
  }

  get id(): string {
    return this._id;
  }

  get playerId(): string {
    return this._playerId;
  }

  get currency(): string {
    return this._currency;
  }

  get version(): number {
    return this._version;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  private ensureSameCurrency(amount: Money): void {
    if (this._currency !== amount.currency) {
      throw new Error(
        `Currency mismatch: wallet is ${this._currency}, amount is ${amount.currency}`,
      );
    }
  }
}
