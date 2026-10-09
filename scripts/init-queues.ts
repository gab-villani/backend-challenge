import { SQSClient, CreateQueueCommand } from '@aws-sdk/client-sqs';

const endpoint = process.env.SQS_ENDPOINT ?? 'http://localhost:4566';
const region = process.env.AWS_REGION ?? 'us-east-1';

const client = new SQSClient({
  region,
  endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
  },
});

const queues: { name: string; fifo: boolean }[] = [
  { name: 'wager-transactions-dlq.fifo', fifo: true },
  { name: 'wagering-events-dlq.fifo', fifo: true },
  { name: 'wager-transactions.fifo', fifo: true },
  { name: 'wagering-events.fifo', fifo: true },
];

async function ensureQueue(name: string, fifo: boolean): Promise<void> {
  const attributes: Record<string, string> = {};
  if (fifo) {
    attributes.FifoQueue = 'true';
    attributes.ContentBasedDeduplication = 'true';
  }
  try {
    await client.send(
      new CreateQueueCommand({ QueueName: name, Attributes: attributes }),
    );
    console.log(`[init-queues] ensured queue: ${name}`);
  } catch (err: any) {
    if (/QueueAlreadyExists|QueueNameExists/.test(err?.message ?? '')) {
      console.log(`[init-queues] queue already exists: ${name}`);
    } else {
      console.error(`[init-queues] failed to create ${name}:`, err?.message ?? err);
    }
  }
}

async function main(): Promise<void> {
  for (const q of queues) {
    await ensureQueue(q.name, q.fifo);
  }
  console.log('[init-queues] all queues ready');
}

main().catch((err) => {
  console.error('[init-queues] fatal error:', err);
  process.exit(1);
});
