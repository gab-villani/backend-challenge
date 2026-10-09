import { MikroORM } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { Wallet } from './src/wallets/wallet.entity.js';

const orm = await MikroORM.init({
  driver: PostgreSqlDriver,
  host: 'localhost',
  port: 5432,
  dbName: 'wagering',
  user: 'wagering',
  password: 'wagering',
  entities: [Wallet],
  extensions: [Migrator],
  debug: false,
});

console.log('orm:', typeof orm, Object.keys(orm));
console.log('getSchemaGenerator:', typeof orm.getSchemaGenerator);
console.log('schemaGenerator:', typeof orm.schema);

await orm.close();