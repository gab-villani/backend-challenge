import { IsString, IsEnum, IsISO8601, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { LedgerDirection } from '../../domain/enums.js';

export class MoneyDto {
  @IsString()
  amount!: string;

  @IsString()
  currency!: string;
}

export class WalletLedgerEntryResponseDto {
  @IsString()
  id!: string;

  @IsString()
  walletId!: string;

  @IsString()
  transactionId!: string;

  @IsEnum(LedgerDirection)
  direction!: LedgerDirection;

  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @ValidateNested()
  @Type(() => MoneyDto)
  balanceBefore!: MoneyDto;

  @ValidateNested()
  @Type(() => MoneyDto)
  balanceAfter!: MoneyDto;

  @IsISO8601()
  createdAt!: string;
}