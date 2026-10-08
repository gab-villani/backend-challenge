import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Wallet } from '../wallets/wallet.entity.js';
import { WagerTransaction } from '../transactions/wager-transaction.entity.js';
import { WalletLedgerEntry } from '../ledger/wallet-ledger-entry.entity.js';
import { InboxMessage } from '../messaging/inbox-message.entity.js';
import { OutboxMessage } from '../messaging/outbox-message.entity.js';
import { WageringService } from './wagering.service.js';
import { WageringController, ProviderTransactionController, WalletReconciliationController } from './wagering.controller.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      Wallet,
      WagerTransaction,
      WalletLedgerEntry,
      InboxMessage,
      OutboxMessage,
    ]),
  ],
  controllers: [
    WageringController,
    ProviderTransactionController,
    WalletReconciliationController,
  ],
  providers: [WageringService],
  exports: [WageringService],
})
export class WageringModule {}