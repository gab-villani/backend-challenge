import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ReferenceReprocessorScheduler } from './reference-reprocessor.scheduler.js';
import { WageringModule } from '../wagering/wagering.module.js';
import { ObservabilityModule } from '../observability/observability.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    WageringModule,
    ObservabilityModule,
  ],
  providers: [ReferenceReprocessorScheduler],
})
export class SchedulerModule {}