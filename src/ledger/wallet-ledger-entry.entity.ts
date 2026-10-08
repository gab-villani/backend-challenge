import { Wallet } from '../wallets/wallet.entity.js';
import { WagerTransaction } from '../transactions/wager-transaction.entity.js';
import { LedgerDirection } from '../domain/enums.js';
import { Money } from '../domain/money.js';
import { Entity, PrimaryKey, Property, ManyToOne, Index } from '@mikro-orm/decorators/legacy';
import { randomUUID } from 'node:crypto';

export interface CreateLedgerEntryProps {
    wallet: Wallet;
    transaction: WagerTransaction;
    direction: LedgerDirection;
    money: Money;
    balanceBefore: Money;
    balanceAfter: Money;
}

export interface LedgerEntryState {
    id: string;
    walletId: string;
    transactionId: string;
    direction: LedgerDirection;
    moneyAmount: string;
    moneyCurrency: string;
    balanceBeforeAmount: string;
    balanceBeforeCurrency: string;
    balanceAfterAmount: string;
    balanceAfterCurrency: string;
    createdAt: Date;
}

@Entity({ tableName: 'wallet_ledger_entries' })
@Index({ properties: ['wallet', 'createdAt'] })
@Index({ properties: ['transaction'] })
export class WalletLedgerEntry {
    @PrimaryKey({ type: 'uuid' })
    public readonly id: string;

    @ManyToOne(() => Wallet, { fieldName: 'wallet_id', deleteRule: 'cascade' })
    public readonly wallet: Wallet;

    @ManyToOne(() => WagerTransaction, { fieldName: 'transaction_id', deleteRule: 'cascade' })
    public readonly transaction: WagerTransaction;

    @Property({ fieldName: 'direction', type: 'enum' })
    public readonly direction: LedgerDirection;

    @Property({ fieldName: 'money_amount', type: 'decimal', precision: 18, scale: 2 })
    public readonly moneyAmount: string;

    @Property({ fieldName: 'money_currency', length: 3 })
    public readonly moneyCurrency: string;

    @Property({ fieldName: 'balance_before_amount', type: 'decimal', precision: 18, scale: 2 })
    public readonly balanceBeforeAmount: string;

    @Property({ fieldName: 'balance_before_currency', length: 3 })
    public readonly balanceBeforeCurrency: string;

    @Property({ fieldName: 'balance_after_amount', type: 'decimal', precision: 18, scale: 2 })
    public readonly balanceAfterAmount: string;

    @Property({ fieldName: 'balance_after_currency', length: 3 })
    public readonly balanceAfterCurrency: string;

    @Property({ fieldName: 'created_at', onCreate: () => new Date() })
    public readonly createdAt: Date;

    private constructor(props: {
        id: string;
        wallet: Wallet;
        transaction: WagerTransaction;
        direction: LedgerDirection;
        money: Money;
        balanceBefore: Money;
        balanceAfter: Money;
        createdAt: Date;
    }) {
        this.id = props.id;
        this.wallet = props.wallet;
        this.transaction = props.transaction;
        this.direction = props.direction;
        this.moneyAmount = props.money.toJSON().amount;
        this.moneyCurrency = props.money.toJSON().currency;
        this.balanceBeforeAmount = props.balanceBefore.toJSON().amount;
        this.balanceBeforeCurrency = props.balanceBefore.toJSON().currency;
        this.balanceAfterAmount = props.balanceAfter.toJSON().amount;
        this.balanceAfterCurrency = props.balanceAfter.toJSON().currency;
        this.createdAt = props.createdAt;       
        
        Object.freeze(this); // imutabilidade 
    }

    static create(props: CreateLedgerEntryProps) {
        const { wallet, transaction, direction, money, balanceBefore, balanceAfter } = props;
    
        if (money.isNegative() || money.isZero()) {
            throw new Error('O valor do lançamento contábil deve ser positivo.');
        }

        if (balanceBefore.currency !== money.currency || balanceAfter.currency !== money.currency) {
            throw new Error('Irregularidade cambial no lançamento contábil.');
        }

        if (wallet.currency !== money.currency) {
            throw new Error('Incompatibilidade de moeda na carteira.');
        }

        const expectedAfter = direction === LedgerDirection.CREDIT
            ? balanceBefore.add(money)
            : balanceBefore.subtract(money);

        if (!expectedAfter.equals(balanceAfter)) {
            throw new Error(
                `Cálculo contábil inválido: ${balanceBefore.toString()} ${direction} ${money.toString()} !== ${balanceAfter.toString()}`
            );
        }

        return new WalletLedgerEntry({
            id: randomUUID(),
            wallet,
            transaction,
            direction,
            money,
            balanceBefore,
            balanceAfter,
            createdAt: new Date(),
        });
    }

    static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
        const entry = Object.create(WalletLedgerEntry.prototype);
        
        entry.id = state.id;
        entry.wallet = null as any; 
        entry.transaction = null as any;
        entry.direction = state.direction;
        entry.moneyAmount = state.moneyAmount;
        entry.moneyCurrency = state.moneyCurrency;
        entry.balanceBeforeAmount = state.balanceBeforeAmount;
        entry.balanceBeforeCurrency = state.balanceBeforeCurrency;
        entry.balanceAfterAmount = state.balanceAfterAmount;
        entry.balanceAfterCurrency = state.balanceAfterCurrency;
        entry.createdAt = state.createdAt;

        Object.freeze(entry);
        return entry;
    }

  get money(): Money {
    return Money.fromString(this.moneyAmount, this.moneyCurrency);
  }

  get balanceBefore(): Money {
    return Money.fromString(this.balanceBeforeAmount, this.balanceBeforeCurrency);
  }

  get balanceAfter(): Money {
    return Money.fromString(this.balanceAfterAmount, this.balanceAfterCurrency);
  }

  isBalanced(): boolean {
    const expectedAfter = this.direction === LedgerDirection.CREDIT
      ? this.balanceBefore.add(this.money)
      : this.balanceBefore.subtract(this.money);
      
    return expectedAfter.equals(this.balanceAfter);
  }

  toJSON() {
    return {
      id: this.id,
      walletId: this.wallet?.id ?? this.wallet,
      transactionId: this.transaction?.id ?? this.transaction,
      direction: this.direction,
      money: this.money.toJSON(),
      balanceBefore: this.balanceBefore.toJSON(),
      balanceAfter: this.balanceAfter.toJSON(),
      createdAt: this.createdAt.toISOString(),
    };
  }
}
