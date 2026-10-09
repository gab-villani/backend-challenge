import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import { randomUUID } from 'node:crypto';
import { Money } from '../domain/money.js';

@Entity({ tableName: 'wallets' })
@Unique({ properties: ['playerId', 'currency'] })
export class Wallet {
  @PrimaryKey({ type: 'uuid', fieldName: 'id' })
  id: string;

  @Property({ type: 'string', fieldName: 'player_id' })
  playerId: string;

  @Property({ type: 'string', length: 3, fieldName: 'currency' })
  currency: string;

  @Property({
    type: 'string',
    columnType: 'numeric(18, 2)',
    default: '0.00',
    fieldName: 'balance',
  })
  balance: string;

  @Property({ type: 'number', version: true, fieldName: 'version' })
  version: number;

  @Property({ type: 'Date', fieldName: 'created_at' })
  createdAt: Date;

  @Property({
    type: 'Date',
    fieldName: 'updated_at',
    onUpdate: () => new Date(),
  })
  updatedAt: Date;

  private constructor(
    id: string,
    playerId: string,
    currency: string,
    balance: string,
    createdAt: Date,
  ) {
    this.id = id;
    this.playerId = playerId;
    this.currency = currency;
    this.balance = balance;
    this.createdAt = createdAt;
    this.updatedAt = createdAt;
    this.version = 1;
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
    wallet.version = version;
    wallet.updatedAt = updatedAt;
    return wallet;
  }

  credit(amount: Money): Money {
    this.ensureSameCurrency(amount);

    if (amount.isNegative() || amount.isZero()) {
      throw new Error('Credit amount must be positive');
    }

    const currentBalance = this.getBalance();
    const newBalance = currentBalance.add(amount);

    this.balance = newBalance.amount;
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

    this.balance = newBalance.amount;
    return newBalance;
  }

  getBalance(): Money {
    return Money.fromString(this.balance, this.currency);
  }

  private ensureSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new Error(
        `Currency mismatch: wallet is ${this.currency}, amount is ${money.currency}`,
      );
    }
  }
}
