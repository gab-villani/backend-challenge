import { IsString, IsNotEmpty, IsEnum, ValidateNested, IsOptional, Length, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { WagerTransactionKind, LedgerDirection } from '../../domain/enums.js';

export class MoneyDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'Amount must be a decimal string with at most 2 decimal places' })
  amount!: string;

  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'Currency must be 3 uppercase letters (ISO 4217)' })
  currency!: string;
}

export class SubmitTransactionDto {
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  externalTransactionId!: string;

  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @IsString()
  @IsNotEmpty()
  walletId!: string;

  @IsString()
  @IsNotEmpty()
  roundId!: string;

  @IsString()
  @IsNotEmpty()
  gameId!: string;

  @IsEnum(WagerTransactionKind)
  kind!: WagerTransactionKind;

  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @IsOptional()
  @IsString()
  referenceExternalTransactionId?: string;
}

export class TransactionResponseDto {
  transactionId!: string;
  status!: string;
  balance!: {
    amount: string;
    currency: string;
  };
  idempotentReplay!: boolean;
}

export class ReconciliationResponseDto {
  walletId!: string;
  storedBalance!: {
    amount: string;
    currency: string;
  };
  calculatedBalance!: {
    amount: string;
    currency: string;
  };
  difference!: {
    amount: string;
    currency: string;
  };
  consistent!: boolean;
  checkedEntries!: number;
}

export class LedgerEntryResponseDto {
  id!: string;
  walletId!: string;
  transactionId!: string;
  direction!: LedgerDirection;
  money!: { amount: string; currency: string };
  balanceBefore!: { amount: string; currency: string };
  balanceAfter!: { amount: string; currency: string };
  createdAt!: string;
}