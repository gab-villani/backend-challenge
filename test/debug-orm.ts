import { MikroORM, EntityManager } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { Wallet } from '../src/wallets/wallet.entity.js';
import { WagerTransaction } from '../src/transactions/wager-transaction.entity.js';
import { WalletLedgerEntry } from '../src/ledger/wallet-ledger-entry.entity.js';
import { InboxMessage } from '../src/messaging/inbox-message.entity.js';
import { OutboxMessage } from '../src/messaging/outbox-message.entity.js';
import { Money } from '../src/domain/money.js';

async function debug() {
  console.log('Initializing ORM...');
  const orm = await MikroORM.init<PostgreSqlDriver>({
    driver: PostgreSqlDriver,
    host: 'localhost',
    port: 5432,
    dbName: 'wagering',
    user: 'wagering',
    password: 'wagering',
    entities: [Wallet, WagerTransaction, WalletLedgerEntry, InboxMessage, OutboxMessage],
    extensions: [Migrator],
    migrations: {
      path: './migrations',
      pathTs: './migrations',
      glob: '!(*.d).{js,ts}',
    },
    debug: true,
  });

  console.log('ORM initialized');
  console.log('Wallet entity:', Wallet);
  console.log('Wallet prototype:', Object.getPrototypeOf(Wallet.prototype));
  
  const em = orm.em.fork();
  console.log('EM created');

  // Test creating a wallet
  console.log('Creating wallet...');
  const wallet = Wallet.open('test-player', 'BRL');
  console.log('Wallet created:', wallet);
  console.log('Wallet is extensible:', Object.isExtensible(wallet));
  console.log('Wallet prototype:', Object.getPrototypeOf(wallet));

  try {
    await em.persistAndFlush(wallet);
    console.log('Wallet persisted successfully!');
  } catch (error) {
    console.error('Error persisting wallet:', error);
  }

  await orm.close();
}

debug().catch(console.error);