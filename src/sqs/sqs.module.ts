import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SQSClient } from '@aws-sdk/client-sqs';

@Global()
@Module({
  providers: [
    {
      provide: SQSClient,
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
  exports: [SQSClient],
})
export class SqsModule {}
