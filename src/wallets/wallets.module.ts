import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Wallet } from './wallet.entity.js';
import { WalletsController } from './wallets.controller.js';
import { WalletsService } from './wallets.service.js';

@Module({
  imports: [MikroOrmModule.forFeature([Wallet])],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
