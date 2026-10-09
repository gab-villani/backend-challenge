import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { WagerTransaction } from '../transactions/wager-transaction.entity.js';
import { ReferenceReprocessorScheduler } from './reference-reprocessor.scheduler.js';
import { WageringModule } from '../wagering/wagering.module.js';
import { ObservabilityModule } from '../observability/observability.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MikroOrmModule.forFeature([WagerTransaction]),
    WageringModule,
    ObservabilityModule,
  ],
  providers: [ReferenceReprocessorScheduler],
})
export class SchedulerModule {}