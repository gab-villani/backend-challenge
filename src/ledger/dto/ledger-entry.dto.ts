import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEnum, IsISO8601, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { LedgerDirection } from '../../domain/enums';

export class MoneyDto {
  @ApiProperty({ example: '25.00' })
  @IsString()
  amount: string;

  @ApiProperty({ example: 'BRL' })
  @IsString()
  currency: string;
}

export class WalletLedgerEntryResponseDto {
  @ApiProperty({ example: '0192f291-27dd-7d3f-8071-5f8685deef37' })
  @IsString()
  id: string;

  @ApiProperty({ example: '0192f291-27dd-7d3f-8071-5f8685deef37' })
  @IsString()
  walletId: string;

  @ApiProperty({ example: '0192f298-345e-7e38-af88-e43f851a819d' })
  @IsString()
  transactionId: string;

  @ApiProperty({ enum: LedgerDirection, example: LedgerDirection.Debit })
  @IsEnum(LedgerDirection)
  direction: LedgerDirection;

  @ApiProperty({ type: MoneyDto })
  @ValidateNested()
  @Type(() => MoneyDto)
  money: MoneyDto;

  @ApiProperty({ type: MoneyDto })
  @ValidateNested()
  @Type(() => MoneyDto)
  balanceBefore: MoneyDto;

  @ApiProperty({ type: MoneyDto })
  @ValidateNested()
  @Type(() => MoneyDto)
  balanceAfter: MoneyDto;

  @ApiProperty({ example: '2026-10-08T12:00:00.000Z' })
  @IsISO8601()
  createdAt: string;
}