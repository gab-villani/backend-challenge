import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { AppModule } from '../src/app.module.js';
import { Wallet } from '../src/wallets/wallet.entity.js';

async function debug() {
  console.log('1. Creating TestingModule...');
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  console.log('2. Creating Nest app...');
  const app = moduleFixture.createNestApplication();
  await app.init();

  console.log('3. Getting ORM...');
  const orm = moduleFixture.get(MikroORM);
  console.log('4. ORM gotten, creating fork EM...');
  const em = orm.em.fork();

  console.log('5. Checking Wallet entity...');
  console.log('Wallet:', Wallet);
  console.log('Wallet prototype:', Object.getPrototypeOf(Wallet.prototype));
  
  const wallet = Wallet.open('test-player', 'BRL');
  console.log('6. Wallet created:', wallet);
  console.log('7. Wallet is extensible:', Object.isExtensible(wallet));
  
  try {
    console.log('8. Trying to persist wallet...');
    await em.persistAndFlush(wallet);
    console.log('9. Wallet persisted successfully!');
  } catch (error) {
    console.error('10. Error persisting wallet:', error);
  }

  await orm.close();
  console.log('11. ORM closed');
}

debug().catch(console.error);