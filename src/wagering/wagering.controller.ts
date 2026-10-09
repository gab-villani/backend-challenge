import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  Query,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Res,
  UnprocessableEntityException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { WageringService } from './wagering.service.js';
import {
  SubmitTransactionDto,
  TransactionResponseDto,
  ReconciliationResponseDto,
  LedgerEntryResponseDto,
} from './dto/wagering.dto.js';
import { Money } from '../domain/money.js';
import { WalletLedgerEntry } from '../ledger/wallet-ledger-entry.entity.js';
import { StructuredLoggerService } from '../observability/logger.service.js';
import { WagerTransaction } from '../transactions/wager-transaction.entity.js';

@Controller('wagering/transactions')
export class WageringController {
  constructor(
    private readonly wageringService: WageringService,
    private readonly logger: StructuredLoggerService,
  ) {}

  public static isValidIdempotencyKey(key: string): boolean {
    const parts = key.split(':');
    if (parts.length !== 2) return false;
    const [providerId, externalTransactionId] = parts;
    if (!providerId || !externalTransactionId) return false;
    const validChars = /^[a-zA-Z0-9_-]+$/;
    return validChars.test(providerId) && validChars.test(externalTransactionId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async submitTransaction(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: SubmitTransactionDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransactionResponseDto> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    if (!WageringController.isValidIdempotencyKey(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key must be in format "providerId:externalTransactionId" (alphanumeric, hyphens, underscores only)');
    }

    const expectedKey = `${dto.providerId}:${dto.externalTransactionId}`;
    if (idempotencyKey !== expectedKey) {
      throw new BadRequestException('Idempotency-Key must match providerId:externalTransactionId');
    }

    const money = Money.fromString(dto.money.amount, dto.money.currency);

    try {
      const result = await this.wageringService.processTransaction({
        providerId: dto.providerId,
        externalTransactionId: dto.externalTransactionId,
        idempotencyKey,
        playerId: dto.playerId,
        walletId: dto.walletId,
        roundId: dto.roundId,
        gameId: dto.gameId,
        kind: dto.kind,
        money,
        referenceExternalTransactionId: dto.referenceExternalTransactionId,
      });

      const response = {
        transactionId: result.transaction.id,
        status: result.transaction.status,
        balance: result.balance.toJSON(),
        idempotentReplay: result.idempotentReplay,
      };

      if (result.transaction.status === 'PENDING_REFERENCE') {
        res.status(HttpStatus.ACCEPTED);
      }

      return response;
    } catch (error) {
      this.logger.error('Transaction processing failed', error instanceof Error ? error.stack : String(error), {
        idempotencyKey,
        walletId: dto.walletId,
        providerId: dto.providerId,
        kind: dto.kind,
      });

      if (error instanceof Error) {
        // 422 Unprocessable Entity - Business rule violations / validation errors
        if (error.message === 'IDEMPOTENCY_CONFLICT: Same idempotency key with different payload') {
          throw new ConflictException('Idempotency key conflict: same key with different payload');
        }
        if (error.message === 'WALLET_NOT_FOUND') {
          throw new NotFoundException('Wallet not found');
        }
        if (error.message === 'CURRENCY_MISMATCH') {
          throw new UnprocessableEntityException({
            code: 'CURRENCY_MISMATCH',
            message: 'Currency mismatch between wallet and transaction',
          });
        }
        if (error.message === 'Insufficient balance for transaction') {
          throw new UnprocessableEntityException({
            code: 'INSUFFICIENT_BALANCE',
            message: 'Insufficient balance',
          });
        }
        if (error.message === 'Insufficient balance for reversal') {
          throw new UnprocessableEntityException({
            code: 'REVERSAL_INSUFFICIENT_BALANCE',
            message: 'Insufficient balance for reversal operation',
          });
        }
        if (error.message === 'INVALID_REFERENCE' || error.message === 'REFERENCE_REQUIRED') {
          throw new UnprocessableEntityException({
            code: 'INVALID_REFERENCE',
            message: 'Invalid or missing reference transaction',
          });
        }
        if (error.message === 'REFERENCE_INCORRECT_AMOUNT') {
          throw new UnprocessableEntityException({
            code: 'REFERENCE_INCORRECT_AMOUNT',
            message: 'Reference amount does not match transaction amount',
          });
        }
        if (error.message === 'REFERENCE_INCORRECT_PLAYER') {
          throw new UnprocessableEntityException({
            code: 'REFERENCE_INCORRECT_PLAYER',
            message: 'Reference player does not match',
          });
        }
        if (error.message === 'REFERENCE_INCORRECT_WALLET') {
          throw new UnprocessableEntityException({
            code: 'REFERENCE_INCORRECT_WALLET',
            message: 'Reference wallet does not match',
          });
        }
        if (error.message === 'REFERENCE_INCORRECT_CURRENCY') {
          throw new UnprocessableEntityException({
            code: 'REFERENCE_INCORRECT_CURRENCY',
            message: 'Reference currency does not match',
          });
        }
        if (error.message === 'REFERENCE_INCORRECT_ROUND') {
          throw new UnprocessableEntityException({
            code: 'REFERENCE_INCORRECT_ROUND',
            message: 'Reference round does not match',
          });
        }
        if (error.message === 'REFERENCE_INCORRECT_PROVIDER') {
          throw new UnprocessableEntityException({
            code: 'REFERENCE_INCORRECT_PROVIDER',
            message: 'Reference provider does not match',
          });
        }
        if (error.message === 'REFERENCE_INCORRECT_KIND') {
          throw new UnprocessableEntityException({
            code: 'REFERENCE_INCORRECT_KIND',
            message: 'Reference kind is not valid for this operation',
          });
        }
        if (error.message === 'REFERENCE_NOT_TERMINAL') {
          throw new UnprocessableEntityException({
            code: 'REFERENCE_NOT_TERMINAL',
            message: 'Reference transaction is not in a terminal state',
          });
        }
        if (error.message === 'REFERENCE_ALREADY_REVERSED') {
          throw new UnprocessableEntityException({
            code: 'REFERENCE_ALREADY_REVERSED',
            message: 'Reference transaction has already been reversed',
          });
        }
        if (error.message === 'CANNOT_ROLLBACK_LOSS') {
          throw new UnprocessableEntityException({
            code: 'CANNOT_ROLLBACK_LOSS',
            message: 'Cannot rollback a LOSS transaction',
          });
        }
        // 503 Service Unavailable - Transient infrastructure failures
        if (error.message.includes('could not obtain lock') || 
            error.message.includes('deadlock detected') || 
            error.message.includes('lock timeout') ||
            error.message.includes('LockNotAvailable') ||
            error.message.includes('SerializationFailure') ||
            error.message.includes('ECONNREFUSED') ||
            error.message.includes('timeout')) {
          throw new ServiceUnavailableException({
            code: 'TRANSIENT_ERROR',
            message: 'Service temporarily unavailable, please retry',
          });
        }
      }
      throw error;
    }
  }

  @Get(':transactionId')
  async getTransaction(@Param('transactionId') transactionId: string) {
    const transaction = await this.wageringService.getTransactionById(transactionId);
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }
    return this.toTransactionResponse(transaction);
  }

  private toTransactionResponse(transaction: WagerTransaction) {
    return {
      id: transaction.id,
      walletId: transaction.walletId,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      idempotencyKey: transaction.idempotencyKey,
      kind: transaction.kind,
      amount: transaction.getAmount().toJSON(),
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      referenceTransactionId: transaction.referenceTransactionId,
      referenceExternalTransactionId: transaction.referenceExternalTransactionId,
      status: transaction.status,
      failureCode: transaction.failureCode,
      failureReason: transaction.failureReason,
      createdAt: transaction.createdAt,
      processedAt: transaction.processedAt,
    };
  }
}

@Controller('providers/:providerId/wagering/transactions')
export class ProviderTransactionController {
  constructor(private readonly wageringService: WageringService) {}

  @Get(':externalTransactionId')
  async getByProviderAndExternalId(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    const transaction = await this.wageringService.getTransactionByProviderAndExternalId(
      providerId,
      externalTransactionId,
    );
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }
    return this.toTransactionResponse(transaction);
  }

  private toTransactionResponse(transaction: WagerTransaction) {
    return {
      id: transaction.id,
      walletId: transaction.walletId,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      idempotencyKey: transaction.idempotencyKey,
      kind: transaction.kind,
      amount: transaction.getAmount().toJSON(),
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      referenceTransactionId: transaction.referenceTransactionId,
      referenceExternalTransactionId: transaction.referenceExternalTransactionId,
      status: transaction.status,
      failureCode: transaction.failureCode,
      failureReason: transaction.failureReason,
      createdAt: transaction.createdAt,
      processedAt: transaction.processedAt,
    };
  }
}

@Controller('wallets/:walletId')
export class WalletReconciliationController {
  constructor(private readonly wageringService: WageringService) {}

  @Post('reconciliation')
  async reconcile(@Param('walletId') walletId: string): Promise<ReconciliationResponseDto> {
    const result = await this.wageringService.reconcileWallet(walletId);
    return {
      walletId,
      storedBalance: result.storedBalance.toJSON(),
      calculatedBalance: result.calculatedBalance.toJSON(),
      difference: result.difference.toJSON(),
      consistent: result.consistent,
      checkedEntries: result.checkedEntries,
    };
  }

  @Get('ledger')
  async getLedger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<{ entries: LedgerEntryResponseDto[]; nextCursor?: string }> {
    const parsedLimit = Math.min(parseInt(limit || '50', 10), 100);
    const result = await this.wageringService.getWalletLedger(walletId, cursor, parsedLimit);
    return {
      entries: result.entries.map((entry: WalletLedgerEntry) => ({
        id: entry.id,
        walletId: entry.wallet?.id || '',
        transactionId: entry.transaction?.id || '',
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
    };
  }
}