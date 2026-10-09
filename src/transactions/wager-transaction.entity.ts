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
  id: string;

  @Property({ type: 'string', fieldName: 'wallet_id' })
  walletId: string;

  @Property({ type: 'string', fieldName: 'provider_id' })
  providerId: string;

  @Property({ type: 'string', fieldName: 'external_transaction_id' })
  externalTransactionId: string;

  @Property({ type: 'string', fieldName: 'idempotency_key' })
  idempotencyKey: string;

  @Property({ type: 'string', length: 10, fieldName: 'kind' })
  kind: WagerTransactionKind;

  @Property({ type: 'string', columnType: 'numeric(18, 2)', fieldName: 'amount' })
  amount: string;

  @Property({ type: 'string', length: 3, fieldName: 'currency' })
  currency: string;

  @Property({ type: 'string', length: 255, fieldName: 'player_id' })
  playerId: string;

  @Property({ type: 'string', length: 255, fieldName: 'round_id' })
  roundId: string;

  @Property({ type: 'string', length: 255, fieldName: 'game_id' })
  gameId: string;

  @Property({
    type: 'string',
    fieldName: 'reference_transaction_id',
    nullable: true,
  })
  referenceTransactionId: string | null;

  @Property({
    type: 'string',
    length: 255,
    fieldName: 'reference_external_transaction_id',
    nullable: true,
  })
  referenceExternalTransactionId: string | null;

  @Property({ type: 'string', length: 20, fieldName: 'status' })
  status: WagerTransactionStatus;

  @Property({ type: 'string', length: 64, nullable: true, fieldName: 'payload_hash' })
  payloadHash: string | null;

  @Property({ type: 'string', length: 50, nullable: true, fieldName: 'failure_code' })
  failureCode: FailureCode | null;

  @Property({ type: 'string', columnType: 'text', nullable: true, fieldName: 'failure_reason' })
  failureReason: string | null;

  @Property({ type: 'Date', fieldName: 'created_at' })
  createdAt: Date;

  @Property({ type: 'Date', fieldName: 'processed_at', nullable: true })
  processedAt: Date | null;

  @Property({ type: 'Date', fieldName: 'expires_at', nullable: true })
  expiresAt: Date | null;

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
    expiresAt: Date | null,
  ) {
    this.id = id;
    this.walletId = walletId;
    this.providerId = providerId;
    this.externalTransactionId = externalTransactionId;
    this.idempotencyKey = idempotencyKey;
    this.kind = kind;
    this.amount = amount;
    this.currency = currency;
    this.playerId = playerId;
    this.roundId = roundId;
    this.gameId = gameId;
    this.referenceTransactionId = referenceTransactionId;
    this.referenceExternalTransactionId = referenceExternalTransactionId;
    this.status = status;
    this.payloadHash = payloadHash;
    this.failureCode = null;
    this.failureReason = null;
    this.createdAt = createdAt;
    this.processedAt = null;
    this.expiresAt = expiresAt;
  }

  /** Nasce em PENDING. Valida a exigência de referência por kind. */
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

    const now = new Date();
    const ttlHours = Number.parseInt(process.env.PENDING_REFERENCE_TTL_HOURS ?? '24', 10);
    const expiresAt = referenceTransactionId
      ? new Date(now.getTime() + ttlHours * 60 * 60 * 1000)
      : null;

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
      now,
      expiresAt,
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
    expiresAt: Date | null,
  ): WagerTransaction {
    const tx = Object.create(WagerTransaction.prototype);

    tx.id = id;
    tx.walletId = walletId;
    tx.providerId = providerId;
    tx.externalTransactionId = externalTransactionId;
    tx.idempotencyKey = idempotencyKey;
    tx.kind = kind;
    tx.amount = amount;
    tx.currency = currency;
    tx.playerId = playerId;
    tx.roundId = roundId;
    tx.gameId = gameId;
    tx.referenceTransactionId = referenceTransactionId;
    tx.referenceExternalTransactionId = referenceExternalTransactionId;
    tx.status = status;
    tx.payloadHash = payloadHash;
    tx.failureCode = failureCode;
    tx.failureReason = failureReason;
    tx.createdAt = createdAt;
    tx.processedAt = processedAt;
    tx.expiresAt = expiresAt;

    return tx;
  }

  // ---- transições (lançam InvalidTransactionStateError se o estado atual for terminal)
  markProcessed(): void {
    if (!this.isPending()) {
      throw new Error(
        `Cannot mark as processed: transaction is ${this.status}`,
      );
    }
    this.status = WagerTransactionStatus.PROCESSED;
    this.processedAt = new Date();
  }

  markPendingReference(): void {
    if (this.status !== WagerTransactionStatus.PENDING) {
      throw new Error(
        `Cannot mark as pending reference: transaction is ${this.status}`,
      );
    }
    this.status = WagerTransactionStatus.PENDING_REFERENCE;
  }

  reject(code: FailureCode, reason: string): void {
    if (this.isTerminal()) {
      throw new Error(
        `Cannot reject: transaction is already terminal (${this.status})`,
      );
    }
    this.status = WagerTransactionStatus.REJECTED;
    this.failureCode = code;
    this.failureReason = reason;
    this.processedAt = new Date();
  }

  fail(code: FailureCode, reason: string): void {
    if (this.isTerminal()) {
      throw new Error(
        `Cannot fail: transaction is already terminal (${this.status})`,
      );
    }
    this.status = WagerTransactionStatus.FAILED;
    this.failureCode = code;
    this.failureReason = reason;
    this.processedAt = new Date();
  }

  // ---- consultas de domínio
  affectsBalance(): boolean {
    return (
      this.kind === WagerTransactionKind.BET ||
      this.kind === WagerTransactionKind.WIN ||
      this.kind === WagerTransactionKind.REFUND ||
      this.kind === WagerTransactionKind.ROLLBACK ||
      this.kind === WagerTransactionKind.OPENING
    );
  }

  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.REFUND ||
      this.kind === WagerTransactionKind.ROLLBACK
    );
  }

  ledgerDirectionFor(): LedgerDirection | null {
    if (!this.affectsBalance()) {
      return null;
    }

    switch (this.kind) {
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
    return Money.fromString(this.amount, this.currency);
  }

  isPending(): boolean {
    return (
      this.status === WagerTransactionStatus.PENDING ||
      this.status === WagerTransactionStatus.PENDING_REFERENCE
    );
  }

  isTerminal(): boolean {
    return (
      this.status === WagerTransactionStatus.PROCESSED ||
      this.status === WagerTransactionStatus.REJECTED ||
      this.status === WagerTransactionStatus.FAILED
    );
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  isExpired(): boolean {
    return this.expiresAt !== null && new Date() > this.expiresAt;
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
