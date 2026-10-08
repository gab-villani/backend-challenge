import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import { randomUUID } from 'node:crypto';
import { Money } from '../domain/money.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
  FailureCode,
  LedgerDirection,
} from '../domain/enums.js';

@Entity({ tableName: 'wager_transactions' })
@Unique({ properties: ['idempotencyKey'] })
export class WagerTransaction {
  @PrimaryKey({ type: 'uuid' })
  protected readonly _id: string;

  @Property({ type: 'string', fieldName: 'wallet_id' })
  protected readonly _walletId: string;

  @Property({ type: 'string', fieldName: 'provider_id' })
  protected readonly _providerId: string;

  @Property({ type: 'string', fieldName: 'external_transaction_id' })
  protected readonly _externalTransactionId: string;

  @Property({ type: 'string', fieldName: 'idempotency_key' })
  protected readonly _idempotencyKey: string;

  @Property({ type: 'string', length: 10 })
  protected readonly _kind: WagerTransactionKind;

  @Property({ type: 'string', columnType: 'numeric(18, 2)' })
  protected readonly _amount: string;

  @Property({ type: 'string', length: 3 })
  protected readonly _currency: string;

  @Property({ type: 'string', length: 255 })
  protected readonly _playerId: string;

  @Property({ type: 'string', length: 255 })
  protected readonly _roundId: string;

  @Property({ type: 'string', length: 255, fieldName: 'game_id' })
  protected readonly _gameId: string;

  @Property({
    type: 'string',
    fieldName: 'reference_transaction_id',
    nullable: true,
  })
  protected _referenceTransactionId: string | null;

  @Property({ type: 'string', length: 255, fieldName: 'reference_external_transaction_id', nullable: true })
  protected readonly _referenceExternalTransactionId: string | null;

  @Property({ type: 'string', length: 20 })
  protected _status: WagerTransactionStatus;

  @Property({ type: 'string', length: 64, nullable: true })
  protected _payloadHash: string | null;

  @Property({ type: 'string', length: 50, nullable: true })
  protected _failureCode: FailureCode | null;

  @Property({ type: 'string', columnType: 'text', nullable: true })
  protected _failureReason: string | null;

  @Property({ type: 'Date', fieldName: 'created_at' })
  protected readonly _createdAt: Date;

  @Property({ type: 'Date', fieldName: 'processed_at', nullable: true })
  protected _processedAt: Date | null;

  private constructor(
    id: string,
    walletId: string,
    providerId: string,
    externalTransactionId: string,
    idempotencyKey: string,
    kind: WagerTransactionKind,
    amount: string,
    currency: string,
    playerId: string,
    roundId: string,
    gameId: string,
    referenceTransactionId: string | null,
    referenceExternalTransactionId: string | null,
    status: WagerTransactionStatus,
    payloadHash: string | null,
    createdAt: Date,
  ) {
    this._id = id;
    this._walletId = walletId;
    this._providerId = providerId;
    this._externalTransactionId = externalTransactionId;
    this._idempotencyKey = idempotencyKey;
    this._kind = kind;
    this._amount = amount;
    this._currency = currency;
    this._playerId = playerId;
    this._roundId = roundId;
    this._gameId = gameId;
    this._referenceTransactionId = referenceTransactionId;
    this._referenceExternalTransactionId = referenceExternalTransactionId;
    this._status = status;
    this._payloadHash = payloadHash;
    this._failureCode = null;
    this._failureReason = null;
    this._createdAt = createdAt;
    this._processedAt = null;
  }

  static create(
    walletId: string,
    providerId: string,
    externalTransactionId: string,
    idempotencyKey: string,
    kind: WagerTransactionKind,
    amount: Money,
    playerId: string,
    roundId: string,
    gameId: string,
    referenceTransactionId: string | null,
    referenceExternalTransactionId: string | null,
    payloadHash: string,
  ): WagerTransaction {
    WagerTransaction.validateCreate(
      kind,
      amount,
      referenceTransactionId,
    );

    const initialStatus = referenceTransactionId
      ? WagerTransactionStatus.PENDING_REFERENCE
      : WagerTransactionStatus.PENDING;

    return new WagerTransaction(
      randomUUID(),
      walletId,
      providerId,
      externalTransactionId,
      idempotencyKey,
      kind,
      amount.amount,
      amount.currency,
      playerId,
      roundId,
      gameId,
      referenceTransactionId,
      referenceExternalTransactionId,
      initialStatus,
      payloadHash,
      new Date(),
    );
  }

  static rehydrate(
    id: string,
    walletId: string,
    providerId: string,
    externalTransactionId: string,
    idempotencyKey: string,
    kind: WagerTransactionKind,
    amount: string,
    currency: string,
    playerId: string,
    roundId: string,
    gameId: string,
    referenceTransactionId: string | null,
    referenceExternalTransactionId: string | null,
    status: WagerTransactionStatus,
    payloadHash: string | null,
    failureCode: FailureCode | null,
    failureReason: string | null,
    createdAt: Date,
    processedAt: Date | null,
  ): WagerTransaction {
    const tx = new WagerTransaction(
      id,
      walletId,
      providerId,
      externalTransactionId,
      idempotencyKey,
      kind,
      amount,
      currency,
      playerId,
      roundId,
      gameId,
      referenceTransactionId,
      referenceExternalTransactionId,
      status,
      payloadHash,
      createdAt,
    );
    tx._failureCode = failureCode;
    tx._failureReason = failureReason;
    tx._processedAt = processedAt;
    return tx;
  }

  markProcessed(): void {
    if (!this.isPending()) {
      throw new Error(
        `Cannot mark as processed: transaction is ${this._status}`,
      );
    }
    this._status = WagerTransactionStatus.PROCESSED;
    this._processedAt = new Date();
  }

  markPendingReference(): void {
    if (this._status !== WagerTransactionStatus.PENDING) {
      throw new Error(
        `Cannot mark as pending reference: transaction is ${this._status}`,
      );
    }
    this._status = WagerTransactionStatus.PENDING_REFERENCE;
  }

  reject(code: FailureCode, reason: string): void {
    if (this.isTerminal()) {
      throw new Error(
        `Cannot reject: transaction is already terminal (${this._status})`,
      );
    }
    this._status = WagerTransactionStatus.REJECTED;
    this._failureCode = code;
    this._failureReason = reason;
    this._processedAt = new Date();
  }

  fail(code: FailureCode, reason: string): void {
    if (this.isTerminal()) {
      throw new Error(
        `Cannot fail: transaction is already terminal (${this._status})`,
      );
    }
    this._status = WagerTransactionStatus.FAILED;
    this._failureCode = code;
    this._failureReason = reason;
    this._processedAt = new Date();
  }

  affectsBalance(): boolean {
    return (
      this._kind === WagerTransactionKind.BET ||
      this._kind === WagerTransactionKind.WIN ||
      this._kind === WagerTransactionKind.REFUND ||
      this._kind === WagerTransactionKind.ROLLBACK ||
      this._kind === WagerTransactionKind.OPENING
    );
  }

  requiresReference(): boolean {
    return (
      this._kind === WagerTransactionKind.REFUND ||
      this._kind === WagerTransactionKind.ROLLBACK
    );
  }

  ledgerDirectionFor(): LedgerDirection | null {
    if (!this.affectsBalance()) {
      return null;
    }

    switch (this._kind) {
      case WagerTransactionKind.BET:
        return LedgerDirection.DEBIT;
      case WagerTransactionKind.WIN:
      case WagerTransactionKind.REFUND:
      case WagerTransactionKind.OPENING:
        return LedgerDirection.CREDIT;
      case WagerTransactionKind.ROLLBACK:
        return LedgerDirection.DEBIT;
      default:
        return null;
    }
  }

  getAmount(): Money {
    return Money.fromString(this._amount, this._currency);
  }

  isPending(): boolean {
    return (
      this._status === WagerTransactionStatus.PENDING ||
      this._status === WagerTransactionStatus.PENDING_REFERENCE
    );
  }

  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.PROCESSED ||
      this._status === WagerTransactionStatus.REJECTED ||
      this._status === WagerTransactionStatus.FAILED
    );
  }

  get id(): string {
    return this._id;
  }

  get walletId(): string {
    return this._walletId;
  }

  get providerId(): string {
    return this._providerId;
  }

  get externalTransactionId(): string {
    return this._externalTransactionId;
  }

  get idempotencyKey(): string {
    return this._idempotencyKey;
  }

  get kind(): WagerTransactionKind {
    return this._kind;
  }

  get currency(): string {
    return this._currency;
  }

  get playerId(): string {
    return this._playerId;
  }

  get roundId(): string {
    return this._roundId;
  }

  get gameId(): string {
    return this._gameId;
  }

  get referenceTransactionId(): string | null {
    return this._referenceTransactionId;
  }

  get referenceExternalTransactionId(): string | null {
    return this._referenceExternalTransactionId;
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get payloadHash(): string | null {
    return this._payloadHash;
  }

  matchesPayload(payloadHash: string): boolean {
    return this._payloadHash === payloadHash;
  }

  get failureCode(): FailureCode | null {
    return this._failureCode;
  }

  get failureReason(): string | null {
    return this._failureReason;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get processedAt(): Date | null {
    return this._processedAt;
  }

  private static validateCreate(
    kind: WagerTransactionKind,
    amount: Money,
    referenceTransactionId: string | null,
  ): void {
    if (kind === WagerTransactionKind.OPENING) {
      throw new Error('OPENING transactions cannot be created via API/SQS');
    }

    if (amount.isNegative()) {
      throw new Error('Transaction amount cannot be negative');
    }

    const requiresRef =
      kind === WagerTransactionKind.REFUND ||
      kind === WagerTransactionKind.ROLLBACK;

    if (requiresRef && !referenceTransactionId) {
      throw new Error(`${kind} requires a reference transaction`);
    }

    if (!requiresRef && referenceTransactionId) {
      throw new Error(`${kind} cannot have a reference transaction`);
    }
  }
}
