import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from '@aws-sdk/client-sqs';
import { WageringService } from '../wagering/wagering.service.js';
import { InboxMessage } from '../messaging/inbox-message.entity.js';
import { WagerTransactionKind } from '../domain/enums.js';
import { Money } from '../domain/money.js';
import { createHash } from 'node:crypto';
import { StructuredLoggerService } from '../observability/logger.service.js';
import { MetricsService } from '../observability/metrics.service.js';

interface SqsMessage {
  messageId: string;
  body: string;
  receiptHandle: string;
}

@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly queueUrl: string;
  private readonly consumerName = 'wager-transactions-processor';
  private isRunning = false;
  private pollInterval?: NodeJS.Timeout;
  private inFlightMessages = new Set<string>();
  private shutdownResolve?: () => void;

  constructor(
    private readonly sqsClient: SQSClient,
    private readonly em: EntityManager,
    private readonly wageringService: WageringService,
    private readonly logger: StructuredLoggerService,
    private readonly metrics: MetricsService,
  ) {
    this.queueUrl = process.env.SQS_QUEUE_URL || 'http://localhost:4566/000000000000/wager-transactions.fifo';
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
    this.logger.log('Graceful shutdown initiated');
    this.isRunning = false;

    if (this.pollInterval) {
      clearTimeout(this.pollInterval);
      this.pollInterval = undefined;
    }

    if (this.inFlightMessages.size > 0) {
      this.logger.log('Waiting for in-flight messages to complete', { count: this.inFlightMessages.size });
      
      await new Promise<void>((resolve) => {
        this.shutdownResolve = resolve;
        const checkInterval = setInterval(() => {
          if (this.inFlightMessages.size === 0) {
            clearInterval(checkInterval);
            this.shutdownResolve?.();
          }
        }, 100);
        
        const shutdownTimeoutMs = Number.parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS ?? '30000', 10);
        setTimeout(() => {
          clearInterval(checkInterval);
          this.logger.warn('Shutdown timeout, returning visibility for in-flight messages');
          this.returnInFlightMessages();
          this.shutdownResolve?.();
        }, shutdownTimeoutMs);
      });
    }

    this.logger.log('Graceful shutdown completed');
  }

  private async returnInFlightMessages(): Promise<void> {
    for (const receiptHandle of this.inFlightMessages) {
      try {
        await this.changeVisibility(receiptHandle, 0);
      } catch (error) {
        this.logger.error('Failed to return message visibility', error instanceof Error ? error.stack : String(error), {
          receiptHandle,
        });
      }
    }
    this.inFlightMessages.clear();
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
      const messages = await this.receiveMessages();
      
      for (const message of messages) {
        await this.processMessage(message);
      }
    } catch (error) {
      this.logger.error('Error polling SQS', error instanceof Error ? error.stack : String(error), {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (this.isRunning) {
        this.pollInterval = setTimeout(() => this.poll(), 1000);
      }
    }
  }

  private async receiveMessages(): Promise<SqsMessage[]> {
    const command = new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 60,
      AttributeNames: ['All'],
      MessageAttributeNames: ['All'],
    });

    const response = await this.sqsClient.send(command);
    return (response.Messages || []).map(msg => ({
      messageId: msg.MessageId!,
      body: msg.Body!,
      receiptHandle: msg.ReceiptHandle!,
    }));
  }

  private async processMessage(message: SqsMessage): Promise<void> {
    this.inFlightMessages.add(message.receiptHandle);
    this.logger.setMessageId(message.messageId);

    try {
      let parsed: {
        messageId: string;
        type: string;
        occurredAt: string;
        data: {
          providerId: string;
          externalTransactionId: string;
          idempotencyKey: string;
          playerId: string;
          walletId: string;
          roundId: string;
          gameId: string;
          kind: WagerTransactionKind;
          money: { amount: string; currency: string };
          referenceExternalTransactionId?: string;
        };
      };

      try {
        parsed = JSON.parse(message.body);
      } catch {
        await this.deleteMessage(message.receiptHandle);
        return;
      }

      if (parsed.type !== 'WagerTransactionRequested') {
        await this.deleteMessage(message.receiptHandle);
        return;
      }

      this.logger.setCorrelationId(parsed.messageId);
      this.logger.setWalletId(parsed.data.walletId);
      this.logger.setProviderId(parsed.data.providerId);

      await this.em.transactional(async (em) => {
        const inboxRepo = em.getRepository(InboxMessage);

        const existingInbox = await inboxRepo.findOne({
          consumerName: this.consumerName,
          messageId: parsed.messageId,
        });

        if (existingInbox) {
          if (existingInbox.isProcessed()) {
            this.logger.debug('Message already processed, acking', { messageId: parsed.messageId });
            await this.deleteMessage(message.receiptHandle);
            return;
          }
        } else {
          this.logger.log('Received new message', { messageId: parsed.messageId, type: parsed.type });
          const inboxMessage = InboxMessage.receive(
            parsed.messageId,
            this.consumerName,
            this.computePayloadHash(parsed.data),
          );
          em.persist(inboxMessage);
        }

        const money = Money.fromString(parsed.data.money.amount, parsed.data.money.currency);

        try {
          const transaction = await this.wageringService.processTransaction({
            providerId: parsed.data.providerId,
            externalTransactionId: parsed.data.externalTransactionId,
            idempotencyKey: parsed.data.idempotencyKey,
            playerId: parsed.data.playerId,
            walletId: parsed.data.walletId,
            roundId: parsed.data.roundId,
            gameId: parsed.data.gameId,
            kind: parsed.data.kind,
            money,
            referenceExternalTransactionId: parsed.data.referenceExternalTransactionId,
          });

          if (transaction) {
            this.logger.setTransactionId(transaction.transaction.id);
          }

          await em.getRepository(InboxMessage).nativeUpdate(
            { consumerName: this.consumerName, messageId: parsed.messageId },
            { processedAt: new Date() },
          );

          await this.deleteMessage(message.receiptHandle);
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('IDEMPOTENCY_CONFLICT')) {
              await this.deleteMessage(message.receiptHandle);
              return;
            }
            if (error.message.includes('Insufficient balance') ||
                error.message.includes('INVALID_REFERENCE') ||
                error.message.includes('CANNOT_ROLLBACK_LOSS')) {
              await this.deleteMessage(message.receiptHandle);
              return;
            }
          }
          throw error;
        }
      });
    } finally {
      this.inFlightMessages.delete(message.receiptHandle);
      if (this.shutdownResolve && this.inFlightMessages.size === 0) {
        this.shutdownResolve();
      }
    }
  }

  private computePayloadHash(data: {
    providerId: string;
    externalTransactionId: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: { amount: string; currency: string };
    referenceExternalTransactionId?: string;
  }): string {
    const canonical = JSON.stringify({
      providerId: data.providerId,
      externalTransactionId: data.externalTransactionId,
      playerId: data.playerId,
      walletId: data.walletId,
      roundId: data.roundId,
      gameId: data.gameId,
      kind: data.kind,
      money: data.money,
      referenceExternalTransactionId: data.referenceExternalTransactionId ?? null,
    }, Object.keys({
      providerId: '',
      externalTransactionId: '',
      playerId: '',
      walletId: '',
      roundId: '',
      gameId: '',
      kind: '',
      money: '',
      referenceExternalTransactionId: '',
    }).sort());
    
    return createHash('sha256').update(canonical).digest('hex');
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    const command = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    });
    await this.sqsClient.send(command);
  }

  private async changeVisibility(receiptHandle: string, timeoutSeconds: number): Promise<void> {
    const command = new ChangeMessageVisibilityCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: timeoutSeconds,
    });
    await this.sqsClient.send(command);
  }
}