import { Test, TestingModule } from '@nestjs/testing';
import { MikroORM } from '@mikro-orm/core';
import { AppModule } from '../src/app.module.js';
import { WalletsService } from '../src/wallets/wallets.service.js';
import { Money } from '../src/domain/money.js';

async function debug() {
  console.log('1. Creating TestingModule...');
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  console.log('2. Getting WalletsService...');
  const walletsService = moduleFixture.get(WalletsService);
  
  console.log('3. Creating wallet via service...');
  try {
    const wallet = await walletsService.create('test-player', 'BRL', Money.fromString('100.00', 'BRL'));
    console.log('4. Wallet created:', wallet);
    console.log('5. Wallet is extensible:', Object.isExtensible(wallet));
    console.log('6. Wallet balance:', wallet.getBalance().toJSON());
  } catch (error) {
    console.error('Error creating wallet:', error);
  }

  const orm = moduleFixture.get(MikroORM);
  await orm.close();
  console.log('7. ORM closed');
}

debug().catch(console.error);