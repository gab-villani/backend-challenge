#!/usr/bin/env bun

/**
 * SQS Producer Utility for Integration Tests
 * 
 * Usage:
 *   bun run test/sqs-producer.ts --help
 *   bun run test/sqs-producer.ts --queue=wager-transactions --count=10
 *   bun run test/sqs-producer.ts --queue=wagering-events --count=5
 */

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { randomUUID } from 'node:crypto';
import { WagerTransactionKind } from '../src/domain/enums.js';

interface CliOptions {
  queue: 'wager-transactions' | 'wagering-events';
  count: number;
  endpoint?: string;
  region?: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    queue: 'wager-transactions',
    count: 1,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--queue' || args[i] === '-q') {
      options.queue = args[++i] as CliOptions['queue'];
    } else if (args[i] === '--count' || args[i] === '-c') {
      options.count = parseInt(args[++i], 10);
    } else if (args[i] === '--endpoint') {
      options.endpoint = args[++i];
    } else if (args[i] === '--region') {
      options.region = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
SQS Producer Utility for Integration Tests

Usage:
  bun run test/sqs-producer.ts [options]

Options:
  -q, --queue <name>      Queue name: 'wager-transactions' or 'wagering-events' (default: wager-transactions)
  -c, --count <number>    Number of messages to send (default: 1)
      --endpoint <url>    SQS endpoint URL (default: http://localhost:4566)
      --region <region>   AWS region (default: us-east-1)
  -h, --help              Show this help

Examples:
  # Send 10 wager transaction requests
  bun run test/sqs-producer.ts --queue=wager-transactions --count=10

  # Send 5 outbox events
  bun run test/sqs-producer.ts --queue=wagering-events --count=5
`);
}

async function sendWagerTransactionMessages(
  client: SQSClient,
  queueUrl: string,
  count: number
): Promise<void> {
  const kinds = Object.values(WagerTransactionKind).filter(k => k !== WagerTransactionKind.OPENING);
  
  for (let i = 0; i < count; i++) {
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const amount = (Math.random() * 100 + 1).toFixed(2);
    const providerId = `provider-${Math.floor(Math.random() * 3) + 1}`;
    const externalTransactionId = `tx-${randomUUID().slice(0, 8)}`;
    const idempotencyKey = `${providerId}:${externalTransactionId}`;
    const walletId = `wallet-${Math.floor(Math.random() * 10) + 1}`;
    const roundId = `round-${randomUUID().slice(0, 8)}`;
    const gameId = `game-${Math.floor(Math.random() * 5) + 1}`;
    const referenceExternalTransactionId = Math.random() > 0.5 ? `ref-${randomUUID().slice(0, 8)}` : undefined;

    const message = {
      messageId: randomUUID(),
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId,
        externalTransactionId,
        idempotencyKey,
        playerId: `player-${Math.floor(Math.random() * 100)}`,
        walletId,
        roundId,
        gameId,
        kind,
        money: { amount, currency: 'BRL' },
        referenceExternalTransactionId,
      },
    };

    const command = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
      MessageGroupId: walletId,
      MessageDeduplicationId: `${idempotencyKey}-${i}`,
    });

    await client.send(command);
    console.log(`Sent ${i + 1}/${count}: ${kind} ${amount} BRL (idempotency: ${idempotencyKey})`);
  }
}

async function sendOutboxEventMessages(
  client: SQSClient,
  queueUrl: string,
  count: number
): Promise<void> {
  const eventTypes = [
    'WagerTransactionProcessed',
    'WagerTransactionRejected',
    'WalletBalanceChanged',
    'WagerTransactionPendingReference',
  ];

  for (let i = 0; i < count; i++) {
    const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
    const aggregateId = randomUUID();
    const eventId = randomUUID();
    const correlationId = randomUUID();

    const envelope = {
      eventId,
      eventType,
      aggregateId,
      correlationId,
      causationId: randomUUID(),
      occurredAt: new Date().toISOString(),
      version: 1,
      data: {
        walletId: aggregateId,
        transactionId: randomUUID(),
        direction: Math.random() > 0.5 ? 'CREDIT' : 'DEBIT',
        money: { amount: '25.00', currency: 'BRL' },
        balanceBefore: { amount: '100.00', currency: 'BRL' },
        balanceAfter: { amount: '125.00', currency: 'BRL' },
        walletVersion: 1,
      },
    };

    const command = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(envelope),
      MessageGroupId: aggregateId,
      MessageDeduplicationId: `${eventId}-${i}`,
    });

    await client.send(command);
    console.log(`Sent ${i + 1}/${count}: ${eventType} for ${aggregateId}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs();

  const endpoint = options.endpoint ?? process.env.SQS_ENDPOINT ?? 'http://localhost:4566';
  const region = options.region ?? process.env.AWS_REGION ?? 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? 'test';
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? 'test';

  const client = new SQSClient({
    region,
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const queueUrl = options.queue === 'wagering-events'
    ? process.env.SQS_OUTBOX_QUEUE_URL ?? `http://localhost:4566/000000000000/wagering-events.fifo`
    : process.env.SQS_QUEUE_URL ?? `http://localhost:4566/000000000000/wager-transactions.fifo`;

  console.log(`Sending ${options.count} messages to ${options.queue}...`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Queue URL: ${queueUrl}`);
  console.log('---');

  try {
    if (options.queue === 'wagering-events') {
      await sendOutboxEventMessages(client, queueUrl, options.count);
    } else {
      await sendWagerTransactionMessages(client, queueUrl, options.count);
    }
    console.log('---');
    console.log('All messages sent successfully!');
  } catch (error) {
    console.error('Error sending messages:', error);
    process.exit(1);
  }
}

main();