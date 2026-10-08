import { IsString, IsNotEmpty, Length, Matches } from 'class-validator';

export class CreateWalletDto {
  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'Currency must be 3 uppercase letters (ISO 4217)' })
  currency!: string;
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
