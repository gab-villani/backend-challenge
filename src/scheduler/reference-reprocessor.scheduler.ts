import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MikroORM } from '@mikro-orm/core';
import { WageringService } from '../wagering/wagering.service.js';
import { StructuredLoggerService } from '../observability/logger.service.js';
import { MetricsService } from '../observability/metrics.service.js';
import { WagerTransaction } from '../transactions/wager-transaction.entity.js';
import { WagerTransactionStatus, FailureCode } from '../domain/enums.js';

@Injectable()
export class ReferenceReprocessorScheduler {
  constructor(
    private readonly orm: MikroORM,
    private readonly wageringService: WageringService,
    private readonly logger: StructuredLoggerService,
    private readonly metrics: MetricsService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async reprocessPendingReferences(): Promise<void> {
    this.logger.log('Starting scheduled reference reprocessing');

    try {
      const processed = await this.wageringService.reprocessPendingReferences();

      if (processed > 0) {
        this.logger.log('Reference reprocessing completed', { processedCount: processed });
      } else {
        this.logger.debug('No pending references to reprocess');
      }

      const expiredCount = await this.rejectExpiredReferences();
      const pendingCount = await this.countPendingReferences();
      this.metrics.setPendingReferences(pendingCount);

      if (expiredCount > 0) {
        this.logger.log('Expired references rejected', { expiredCount });
      }
    } catch (error) {
      this.logger.error('Reference reprocessing failed', error instanceof Error ? error.stack : String(error), {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async rejectExpiredReferences(): Promise<number> {
    const em = this.orm.em.fork();
    const now = new Date();

    const expiredTxs = await em.find(WagerTransaction, {
      status: WagerTransactionStatus.PENDING_REFERENCE,
      expiresAt: { $lt: now },
    });

    let rejected = 0;
    for (const tx of expiredTxs) {
      tx.reject(FailureCode.REFERENCE_NOT_FOUND, 'Reference transaction not found within 24h TTL');
      rejected++;
    }

    if (rejected > 0) {
      await em.flush();
    }

    return rejected;
  }

  private async countPendingReferences(): Promise<number> {
    const em = this.orm.em.fork();
    return em.count(WagerTransaction, { status: WagerTransactionStatus.PENDING_REFERENCE });
  }
}
