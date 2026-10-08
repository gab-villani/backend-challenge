import { IsString, IsNotEmpty, Length, Matches, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

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

export class CreateWalletDto {
  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'Currency must be 3 uppercase letters (ISO 4217)' })
  currency!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance?: MoneyDto;
}

export class WalletResponseDto {
  id!: string;
  playerId!: string;
  currency!: string;
  balance!: {
    amount: string;
    currency: string;
  };
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}
