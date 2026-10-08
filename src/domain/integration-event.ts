import { Money } from './money.js';
import { LedgerDirection } from './enums.js';

export interface MoneyProps {
  amount: string;
  currency: string;
}

export interface IntegrationEventProps<T> {
  eventId: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: Date;
  data: T;
}

export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
  readonly data: Readonly<T>;

  protected constructor(props: IntegrationEventProps<T>) {
    this.eventId = props.eventId;
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this.occurredAt = props.occurredAt;
    this.data = props.data;
    Object.freeze(this);
  }

  toJSON(): {
    eventId: string;
    eventType: string;
    aggregateId: string;
    correlationId: string;
    causationId?: string;
    occurredAt: string;
    version: number;
    data: T;
  } {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      causationId: this.causationId,
      occurredAt: this.occurredAt.toISOString(),
      version: this.version,
      data: this.data,
    };
  }
}

export interface WagerTransactionProcessedData {
  transactionId: string;
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  kind: string;
  money: MoneyProps;
  roundId: string;
  gameId: string;
  referenceExternalTransactionId?: string;
  processedAt: string;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  static from(
    transactionId: string,
    walletId: string,
    playerId: string,
    providerId: string,
    externalTransactionId: string,
    kind: string,
    money: Money,
    roundId: string,
    gameId: string,
    referenceExternalTransactionId: string | undefined,
    processedAt: Date,
    balanceAfter: Money,
    walletVersion: number,
    correlationId: string,
    causationId?: string,
  ): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
      eventId: crypto.randomUUID(),
      aggregateId: transactionId,
      correlationId,
      causationId,
      occurredAt: processedAt,
      data: {
        transactionId,
        walletId,
        playerId,
        providerId,
        externalTransactionId,
        kind,
        money: money.toJSON(),
        roundId,
        gameId,
        referenceExternalTransactionId,
        processedAt: processedAt.toISOString(),
        balanceAfter: balanceAfter.toJSON(),
        walletVersion,
      },
    });
  }
}

export interface WagerTransactionRejectedData {
  transactionId: string;
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  kind: string;
  money: MoneyProps;
  roundId: string;
  gameId: string;
  referenceExternalTransactionId?: string;
  failureCode: string;
  failureReason: string;
  rejectedAt: string;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  static from(
    transactionId: string,
    walletId: string,
    playerId: string,
    providerId: string,
    externalTransactionId: string,
    kind: string,
    money: Money,
    roundId: string,
    gameId: string,
    referenceExternalTransactionId: string | undefined,
    failureCode: string,
    failureReason: string,
    rejectedAt: Date,
    correlationId: string,
    causationId?: string,
  ): WagerTransactionRejected {
    return new WagerTransactionRejected({
      eventId: crypto.randomUUID(),
      aggregateId: transactionId,
      correlationId,
      causationId,
      occurredAt: rejectedAt,
      data: {
        transactionId,
        walletId,
        playerId,
        providerId,
        externalTransactionId,
        kind,
        money: money.toJSON(),
        roundId,
        gameId,
        referenceExternalTransactionId,
        failureCode,
        failureReason,
        rejectedAt: rejectedAt.toISOString(),
      },
    });
  }
}

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  static from(
    walletId: string,
    transactionId: string,
    direction: LedgerDirection,
    money: Money,
    balanceBefore: Money,
    balanceAfter: Money,
    walletVersion: number,
    correlationId: string,
    causationId?: string,
  ): WalletBalanceChanged {
    return new WalletBalanceChanged({
      eventId: crypto.randomUUID(),
      aggregateId: walletId,
      correlationId,
      causationId,
      occurredAt: new Date(),
      data: {
        walletId,
        transactionId,
        direction,
        money: money.toJSON(),
        balanceBefore: balanceBefore.toJSON(),
        balanceAfter: balanceAfter.toJSON(),
        walletVersion,
      },
    });
  }
}

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  kind: string;
  money: MoneyProps;
  roundId: string;
  gameId: string;
  referenceExternalTransactionId: string;
  receivedAt: string;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  static from(
    transactionId: string,
    walletId: string,
    playerId: string,
    providerId: string,
    externalTransactionId: string,
    kind: string,
    money: Money,
    roundId: string,
    gameId: string,
    referenceExternalTransactionId: string,
    receivedAt: Date,
    correlationId: string,
    causationId?: string,
  ): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference({
      eventId: crypto.randomUUID(),
      aggregateId: transactionId,
      correlationId,
      causationId,
      occurredAt: receivedAt,
      data: {
        transactionId,
        walletId,
        playerId,
        providerId,
        externalTransactionId,
        kind,
        money: money.toJSON(),
        roundId,
        gameId,
        referenceExternalTransactionId,
        receivedAt: receivedAt.toISOString(),
      },
    });
  }
}