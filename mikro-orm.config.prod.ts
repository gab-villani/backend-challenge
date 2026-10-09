import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { Wallet } from './dist/wallets/wallet.entity.js';
import { WagerTransaction } from './dist/transactions/wager-transaction.entity.js';
import { WalletLedgerEntry } from './dist/ledger/wallet-ledger-entry.entity.js';
import { InboxMessage } from './dist/messaging/inbox-message.entity.js';
import { OutboxMessage } from './dist/messaging/outbox-message.entity.js';

const port = Number.parseInt(process.env.DATABASE_PORT ?? '5432', 10);

export default defineConfig({
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: Number.isNaN(port) ? 5432 : port,
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
});
