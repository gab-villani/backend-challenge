import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { Wallet } from './wallet.entity.js';

@Injectable()
export class WalletsService {
  constructor(private readonly em: EntityManager) {}

  async create(playerId: string, currency: string): Promise<Wallet> {
    const existing = await this.em.findOne(Wallet, { 
      playerId: playerId, 
      currency: currency 
    });

    if (existing) {
      throw new ConflictException(
        `Wallet already exists for player ${playerId} with currency ${currency}`,
      );
    }

    const wallet = Wallet.open(playerId, currency);
    this.em.persist(wallet);
    await this.em.flush();

    return wallet;
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
