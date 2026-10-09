import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { InboxMessage } from './inbox-message.entity.js';
import { OutboxMessage } from './outbox-message.entity.js';
import { SqsConsumerService } from './sqs-consumer.service.js';
import { OutboxPublisherService } from './outbox-publisher.service.js';
import { WageringModule } from '../wagering/wagering.module.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([InboxMessage, OutboxMessage]),
    WageringModule,
  ],
  providers: [
    SqsConsumerService,
    OutboxPublisherService,
  ],
  exports: [],
})
export class MessagingModule {}