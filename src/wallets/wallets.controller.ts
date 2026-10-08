import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import { WalletsService } from './wallets.service.js';
import { CreateWalletDto, WalletResponseDto } from './dto/wallet.dto.js';
import { Wallet } from './wallet.entity.js';

@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: CreateWalletDto,
  ): Promise<WalletResponseDto> {
    const wallet = await this.walletsService.create(dto.playerId, dto.currency);
    return this.toResponse(wallet);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<WalletResponseDto> {
    const wallet = await this.walletsService.findById(id);
    return this.toResponse(wallet);
  }

  @Get()
  async findAll(): Promise<WalletResponseDto[]> {
    const wallets = await this.walletsService.findAll();
    return wallets.map((w) => this.toResponse(w));
  }

  private toResponse(wallet: Wallet): WalletResponseDto {
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: wallet.getBalance().toJSON(),
      version: wallet.version,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }
}
