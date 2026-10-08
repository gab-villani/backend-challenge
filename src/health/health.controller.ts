import { Controller, Get, Inject } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { SQSClient, ReceiveMessageCommand } from '@aws-sdk/client-sqs';

@Controller('health')
export class HealthController {
  constructor(
    private readonly em: EntityManager,
    @Inject('SQS_CLIENT') private readonly sqsClient: SQSClient,
  ) {}

  @Get('live')
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  async readiness() {
    const checks = await Promise.allSettled([
      this.checkDatabase(),
      this.checkSqs(),
    ]);

    const dbCheck = checks[0];
    const sqsCheck = checks[1];

    const ready = dbCheck.status === 'fulfilled' && sqsCheck.status === 'fulfilled';

    return {
      status: ready ? 'ready' : 'not ready',
      checks: {
        database: dbCheck.status === 'fulfilled' ? 'up' : 'down',
        sqs: sqsCheck.status === 'fulfilled' ? 'up' : 'down',
      },
    };
  }

  private async checkDatabase(): Promise<void> {
    await this.em.getConnection().execute('SELECT 1');
  }

  private async checkSqs(): Promise<void> {
    await this.sqsClient.send(new ReceiveMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL || 'http://localhost:4566/000000000000/wager-transactions.fifo',
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 0,
    }));
  }
}