import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WageringService } from '../wagering/wagering.service.js';
import { StructuredLoggerService } from '../observability/logger.service.js';
import { MetricsService } from '../observability/metrics.service.js';

@Injectable()
export class ReferenceReprocessorScheduler {
  constructor(
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
        this.metrics.setPendingReferences(0); // Will be updated by next query
      } else {
        this.logger.debug('No pending references to reprocess');
      }
    } catch (error) {
      this.logger.error('Reference reprocessing failed', error instanceof Error ? error.stack : String(error), {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}