import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { SQSClient } from '@aws-sdk/client-sqs';
import { Wallet } from './wallets/wallet.entity.js';
import { WagerTransaction } from './transactions/wager-transaction.entity.js';
import { WalletLedgerEntry } from './ledger/wallet-ledger-entry.entity.js';
import { InboxMessage } from './messaging/inbox-message.entity.js';
import { OutboxMessage } from './messaging/outbox-message.entity.js';
import { WalletsModule } from './wallets/wallets.module.js';
import { WageringModule } from './wagering/wagering.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { SchedulerModule } from './scheduler/scheduler.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MikroOrmModule.forRootAsync({
      driver: PostgreSqlDriver,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        host: configService.get<string>('DATABASE_HOST', 'localhost'),
        port: Number.parseInt(
          configService.get<string>('DATABASE_PORT', '5432'),
          10,
        ),
        dbName: configService.get<string>('DATABASE_NAME', 'wagering'),
        user: configService.get<string>('DATABASE_USER', 'wagering'),
        password: configService.get<string>('DATABASE_PASSWORD', 'wagering'),
        entities: [Wallet, WagerTransaction, WalletLedgerEntry, InboxMessage, OutboxMessage],
        extensions: [Migrator],
        migrations: {
          path: './migrations',
          pathTs: './migrations',
          glob: '!(*.d).{js,ts}',
        },
      }),
    }),
    WalletsModule,
    WageringModule,
    MessagingModule,
    ObservabilityModule,
    SchedulerModule,
    AuthModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    {
      provide: 'SQS_CLIENT',
      useFactory: (configService: ConfigService) => {
        return new SQSClient({
          region: configService.get<string>('AWS_REGION', 'us-east-1'),
          endpoint: configService.get<string>('SQS_ENDPOINT', 'http://localhost:4566'),
          credentials: {
            accessKeyId: configService.get<string>('AWS_ACCESS_KEY_ID', 'test'),
            secretAccessKey: configService.get<string>('AWS_SECRET_ACCESS_KEY', 'test'),
          },
        });
      },
      inject: [ConfigService],
    },
  ],
})
export class AppModule {}
