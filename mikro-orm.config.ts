import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { Wallet } from './src/wallets/wallet.entity.js';

const port = Number.parseInt(process.env.DATABASE_PORT ?? '5432', 10);

export default defineConfig({
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: Number.isNaN(port) ? 5432 : port,
  dbName: process.env.DATABASE_NAME ?? 'wagering',
  user: process.env.DATABASE_USER ?? 'wagering',
  password: process.env.DATABASE_PASSWORD ?? 'wagering',
  entities: [Wallet],
  extensions: [Migrator],
  migrations: {
    path: './migrations',
    pathTs: './migrations',
    glob: '!(*.d).{js,ts}',
  },
});
