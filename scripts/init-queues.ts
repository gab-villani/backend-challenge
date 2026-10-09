import { SQSClient, CreateQueueCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';

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

interface QueueConfig {
  name: string;
  fifo: boolean;
  dlqName?: string;
  maxReceiveCount?: number;
}

const queues: QueueConfig[] = [
  { name: 'wager-transactions-dlq.fifo', fifo: true },
  { name: 'wagering-events-dlq.fifo', fifo: true },
  { 
    name: 'wager-transactions.fifo', 
    fifo: true, 
    dlqName: 'wager-transactions-dlq.fifo',
    maxReceiveCount: 5 
  },
  { 
    name: 'wagering-events.fifo', 
    fifo: true, 
    dlqName: 'wagering-events-dlq.fifo',
    maxReceiveCount: 5 
  },
];

async function getQueueArn(queueName: string): Promise<string> {
  const cmd = new GetQueueAttributesCommand({
    QueueUrl: `${endpoint}/000000000000/${queueName}`,
    AttributeNames: ['QueueArn'],
  });
  const response = await client.send(cmd);
  return response.Attributes?.QueueArn ?? '';
}

async function ensureQueue(config: QueueConfig): Promise<void> {
  const attributes: Record<string, string> = {};
  
  if (config.fifo) {
    attributes.FifoQueue = 'true';
    attributes.ContentBasedDeduplication = 'true';
  }

  if (config.dlqName && config.maxReceiveCount) {
    await ensureQueue({ name: config.dlqName, fifo: true });
    
    const dlqArn = await getQueueArn(config.dlqName);
    if (!dlqArn) {
      throw new Error(`Failed to get ARN for DLQ: ${config.dlqName}`);
    }

    attributes.RedrivePolicy = JSON.stringify({
      deadLetterTargetArn: dlqArn,
      maxReceiveCount: config.maxReceiveCount,
    });
    
    console.log(`[init-queues] ${config.name} -> RedrivePolicy -> ${config.dlqName} (maxReceiveCount: ${config.maxReceiveCount})`);
  }

  try {
    await client.send(
      new CreateQueueCommand({ QueueName: config.name, Attributes: attributes }),
    );
    console.log(`[init-queues] ensured queue: ${config.name}`);
  } catch (err: any) {
    if (/QueueAlreadyExists|QueueNameExists/.test(err?.message ?? '')) {
      console.log(`[init-queues] queue already exists: ${config.name}`);
      // Se a fila já existe, tentar atualizar a RedrivePolicy
      if (config.dlqName && config.maxReceiveCount) {
        try {
          const dlqArn = await getQueueArn(config.dlqName);
          if (dlqArn) {
            const { SetQueueAttributesCommand } = await import('@aws-sdk/client-sqs');
            await client.send(new SetQueueAttributesCommand({
              QueueUrl: `${endpoint}/000000000000/${config.name}`,
              Attributes: {
                RedrivePolicy: JSON.stringify({
                  deadLetterTargetArn: dlqArn,
                  maxReceiveCount: config.maxReceiveCount,
                }),
              },
            }));
            console.log(`[init-queues] updated RedrivePolicy for: ${config.name}`);
          }
        } catch (updateErr) {
          console.warn(`[init-queues] could not update RedrivePolicy for ${config.name}:`, updateErr);
        }
      }
    } else {
      console.error(`[init-queues] failed to create ${config.name}:`, err?.message ?? err);
    }
  }
}

async function main(): Promise<void> {
  for (const q of queues) {
    await ensureQueue(q);
  }
  console.log('[init-queues] all queues ready');
}

main().catch((err) => {
  console.error('[init-queues] fatal error:', err);
  process.exit(1);
});