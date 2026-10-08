import { Injectable, OnModuleInit } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: Registry;

  readonly transactionsTotal: Counter;
  readonly idempotentReplaysTotal: Counter;
  readonly retriesTotal: Counter;
  readonly dlqMessagesTotal: Counter;
  readonly lockConflictsTotal: Counter;
  readonly outboxLagSeconds: Gauge;
  readonly processingDurationSeconds: Histogram;
  readonly walletBalanceGauge: Gauge;
  readonly pendingReferencesGauge: Gauge;

  constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry, prefix: 'wagering_' });

    this.transactionsTotal = new Counter({
      name: 'wagering_transactions_total',
      help: 'Total number of processed transactions by status',
      labelNames: ['status', 'kind'],
      registers: [this.registry],
    });

    this.idempotentReplaysTotal = new Counter({
      name: 'wagering_idempotent_replays_total',
      help: 'Total number of idempotent replays',
      registers: [this.registry],
    });

    this.retriesTotal = new Counter({
      name: 'wagering_retries_total',
      help: 'Total number of retries by type',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.dlqMessagesTotal = new Counter({
      name: 'wagering_dlq_messages_total',
      help: 'Total number of messages sent to DLQ',
      registers: [this.registry],
    });

    this.lockConflictsTotal = new Counter({
      name: 'wagering_lock_conflicts_total',
      help: 'Total number of database lock conflicts',
      registers: [this.registry],
    });

    this.outboxLagSeconds = new Gauge({
      name: 'wagering_outbox_lag_seconds',
      help: 'Age of oldest pending outbox message in seconds',
      registers: [this.registry],
    });

    this.processingDurationSeconds = new Histogram({
      name: 'wagering_processing_duration_seconds',
      help: 'Transaction processing latency in seconds',
      labelNames: ['kind'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.walletBalanceGauge = new Gauge({
      name: 'wagering_wallet_balance',
      help: 'Current wallet balance',
      labelNames: ['wallet_id', 'currency'],
      registers: [this.registry],
    });

    this.pendingReferencesGauge = new Gauge({
      name: 'wagering_pending_references',
      help: 'Number of transactions waiting for reference',
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    this.updateOutboxLag();
    setInterval(() => this.updateOutboxLag(), 30000);
  }

  private async updateOutboxLag(): Promise<void> {
    // This will be called by the outbox publisher worker
  }

  setOutboxLag(seconds: number): void {
    this.outboxLagSeconds.set(seconds);
  }

  incrementTransactions(status: string, kind: string): void {
    this.transactionsTotal.inc({ status, kind });
  }

  incrementIdempotentReplays(): void {
    this.idempotentReplaysTotal.inc();
  }

  incrementRetries(type: string): void {
    this.retriesTotal.inc({ type });
  }

  incrementDlqMessages(): void {
    this.dlqMessagesTotal.inc();
  }

  incrementLockConflicts(): void {
    this.lockConflictsTotal.inc();
  }

  observeProcessingDuration(kind: string, seconds: number): void {
    this.processingDurationSeconds.observe({ kind }, seconds);
  }

  setWalletBalance(walletId: string, currency: string, amount: number): void {
    this.walletBalanceGauge.set({ wallet_id: walletId, currency }, amount);
  }

  setPendingReferences(count: number): void {
    this.pendingReferencesGauge.set(count);
  }

  getRegistry(): Registry {
    return this.registry;
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  async getContentType(): Promise<string> {
    return this.registry.contentType;
  }
}