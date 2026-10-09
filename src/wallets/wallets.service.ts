import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { Wallet } from './wallet.entity.js';
import { WagerTransaction } from '../transactions/wager-transaction.entity.js';
import { WalletLedgerEntry } from '../ledger/wallet-ledger-entry.entity.js';
import { Money } from '../domain/money.js';
import { WagerTransactionKind, LedgerDirection } from '../domain/enums.js';
import { randomUUID } from 'node:crypto';

@Injectable()
export class WalletsService {
  constructor(private readonly em: EntityManager) {}

  async create(playerId: string, currency: string, initialBalance?: Money): Promise<Wallet> {
    const existing = await this.em.findOne(Wallet, { 
      playerId: playerId, 
      currency: currency 
    });

    if (existing) {
      throw new ConflictException(
        `Wallet already exists for player ${playerId} with currency ${currency}`,
      );
    }

    return this.em.transactional(async (em) => {
      const wallet = Wallet.open(playerId, currency);
      em.persist(wallet);

      if (initialBalance && initialBalance.isPositive()) {
        const openingTx = WagerTransaction.create(
          wallet.id,
          'system',
          `opening-${wallet.id}`,
          `system:opening-${wallet.id}`,
          WagerTransactionKind.OPENING,
          initialBalance,
          playerId,
          'opening',
          'opening',
          null,
          null,
          randomUUID(),
          { isSystemTransaction: true },
        );
        openingTx.markProcessed();
        em.persist(openingTx);

        const zeroBalance = Money.zero(currency);
        const ledgerEntry = WalletLedgerEntry.create({
          wallet,
          transaction: openingTx,
          direction: LedgerDirection.CREDIT,
          money: initialBalance,
          balanceBefore: zeroBalance,
          balanceAfter: initialBalance,
        });
        em.persist(ledgerEntry);

        wallet.credit(initialBalance);
      }

      return wallet;
    });
  }

  async findById(id: string): Promise<Wallet> {
    const wallet = await this.em.findOne(Wallet, { id: id });

    if (!wallet) {
      throw new NotFoundException(`Wallet ${id} not found`);
    }

    return wallet;
  }

  async findAll(): Promise<Wallet[]> {
    return this.em.find(Wallet, {});
  }
}
