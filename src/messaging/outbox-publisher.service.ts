import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/core';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { OutboxMessage } from './outbox-message.entity.js';
import { IntegrationEvent } from '../domain/integration-event.js';
import { StructuredLoggerService } from '../observability/logger.service.js';
import { MetricsService } from '../observability/metrics.service.js';

@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly queueUrl: string;
  private isRunning = false;
  private pollInterval?: NodeJS.Timeout;
  private readonly batchSize = 10;
  private readonly maxAttempts = 10;
  private inFlightPublishing = 0;
  private shutdownResolve?: () => void;

  constructor(
    private readonly em: EntityManager,
    private readonly sqsClient: SQSClient,
    private readonly logger: StructuredLoggerService,
    private readonly metrics: MetricsService,
  ) {
    this.queueUrl = process.env.SQS_OUTBOX_QUEUE_URL || 'http://localhost:4566/000000000000/wagering-events.fifo';
  }

  async onModuleInit(): Promise<void> {
    this.startPolling();
    this.setupSignalHandlers();
  }

  async onModuleDestroy(): Promise<void> {
    await this.gracefulShutdown();
  }

  private setupSignalHandlers(): void {
    const handleSignal = async (signal: string) => {
      this.logger.log(`Received ${signal}, starting graceful shutdown`);
      await this.gracefulShutdown();
      process.exit(0);
    };

    process.on('SIGTERM', () => handleSignal('SIGTERM'));
    process.on('SIGINT', () => handleSignal('SIGINT'));
  }

  private startPolling(): void {
    this.isRunning = true;
    this.poll();
  }

  private async gracefulShutdown(): Promise<void> {
    this.logger.log('Graceful shutdown initiated for outbox publisher');
    this.isRunning = false;

    if (this.pollInterval) {
      clearTimeout(this.pollInterval);
      this.pollInterval = undefined;
    }

    if (this.inFlightPublishing > 0) {
      this.logger.log('Waiting for in-flight publishing to complete', { count: this.inFlightPublishing });
      
      await new Promise<void>((resolve) => {
        this.shutdownResolve = resolve;
        const checkInterval = setInterval(() => {
          if (this.inFlightPublishing === 0) {
            clearInterval(checkInterval);
            this.shutdownResolve?.();
          }
        }, 100);
        
        setTimeout(() => {
          clearInterval(checkInterval);
          this.logger.warn('Shutdown timeout for outbox publisher');
          this.shutdownResolve?.();
        }, 15000);
      });
    }

    this.logger.log('Graceful shutdown completed for outbox publisher');
  }

  private stopPolling(): void {
    this.isRunning = false;
    if (this.pollInterval) {
      clearTimeout(this.pollInterval);
    }
  }

  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    try {
      await this.publishPendingMessages();
    } catch (error) {
      this.logger.error('Error publishing outbox messages', error instanceof Error ? error.stack : String(error), {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (this.isRunning) {
        this.pollInterval = setTimeout(() => this.poll(), 5000);
      }
    }
  }

  private async publishPendingMessages(): Promise<void> {
    await this.em.transactional(async (em) => {
      const outboxRepo = em.getRepository(OutboxMessage);
      const now = new Date();

      const pendingMessages = await outboxRepo.find(
        {
          publishedAt: null,
          $or: [
            { nextAttemptAt: { $lte: now } },
            { nextAttemptAt: null },
          ],
        },
        {
          orderBy: { occurredAt: 'ASC' },
          limit: this.batchSize,
          lockMode: LockMode.PESSIMISTIC_WRITE,
        },
      );

      for (const message of pendingMessages) {
        this.inFlightPublishing++;
        try {
          await this.publishMessage(message);
          message.markPublished(new Date());
        } catch (error) {
          if (message.attempts >= this.maxAttempts) {
            this.logger.error('Outbox message exceeded max attempts, giving up', undefined, {
              messageId: message.id,
              eventType: message.eventType,
              attempts: message.attempts,
            });
            this.metrics.incrementDlqMessages();
            message.markPublished(new Date());
          } else {
            this.metrics.incrementRetries('outbox');
            message.scheduleRetry(now);
          }
        } finally {
          this.inFlightPublishing--;
          if (this.shutdownResolve && this.inFlightPublishing === 0) {
            this.shutdownResolve();
          }
        }
      }
    });
  }

  private async publishMessage(message: OutboxMessage): Promise<void> {
    const envelope = message.getEventEnvelope();
    
    const command = new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(envelope),
      MessageGroupId: message.aggregateId,
      MessageDeduplicationId: `${message.id}-${message.attempts}`,
    });

    await this.sqsClient.send(command);
    
    this.logger.log('Published outbox message', {
      messageId: message.id,
      eventType: message.eventType,
      aggregateId: message.aggregateId,
    });
  }
}