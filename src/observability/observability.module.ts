import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { StructuredLoggerService } from './logger.service.js';
import { MetricsService } from './metrics.service.js';
import { MetricsController } from './metrics.controller.js';
import { CorrelationIdInterceptor } from './correlation-id.interceptor.js';

@Global()
@Module({
  providers: [
    StructuredLoggerService,
    MetricsService,
    CorrelationIdInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useExisting: CorrelationIdInterceptor,
    },
  ],
  controllers: [MetricsController],
  exports: [StructuredLoggerService, MetricsService, CorrelationIdInterceptor],
})
export class ObservabilityModule {}