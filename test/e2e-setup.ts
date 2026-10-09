import { MikroORM, EntityManager } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { Wallet } from '../src/wallets/wallet.entity.js';
import { WagerTransaction } from '../src/transactions/wager-transaction.entity.js';
import { WalletLedgerEntry } from '../src/ledger/wallet-ledger-entry.entity.js';
import { InboxMessage } from '../src/messaging/inbox-message.entity.js';
import { OutboxMessage } from '../src/messaging/outbox-message.entity.js';

let globalOrm: MikroORM<PostgreSqlDriver>;

export async function setupGlobalDatabase(): Promise<void> {
  globalOrm = await MikroORM.init<PostgreSqlDriver>({
    driver: PostgreSqlDriver,
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number.parseInt(process.env.DATABASE_PORT ?? '5432', 10),
    dbName: process.env.DATABASE_NAME ?? 'wagering',
    user: process.env.DATABASE_USER ?? 'wagering',
    password: process.env.DATABASE_PASSWORD ?? 'wagering',
    entities: [Wallet, WagerTransaction, WalletLedgerEntry, InboxMessage, OutboxMessage],
    extensions: [Migrator],
    migrations: {
      path: './migrations',
      pathTs: './migrations',
      glob: '!(*.d).{js,ts}',
    },
    debug: false,
  });

  const generator = globalOrm.schema;
  await generator.ensureDatabase();
  await generator.drop();
  await generator.create();
}

export async function teardownGlobalDatabase(): Promise<void> {
  if (globalOrm) {
    await globalOrm.close(true);
  }
}

export function getGlobalOrm(): MikroORM<PostgreSqlDriver> {
  return globalOrm;
}

export function createTestEm(): EntityManager {
  return globalOrm.em.fork();
}