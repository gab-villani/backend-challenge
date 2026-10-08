import { Injectable, LoggerService, Scope } from '@nestjs/common';
import pino, { Logger, Level } from 'pino';
import { randomUUID } from 'node:crypto';

@Injectable({ scope: Scope.TRANSIENT })
export class StructuredLoggerService implements LoggerService {
  private readonly logger: Logger;
  private correlationId: string | null = null;
  private messageId: string | null = null;
  private transactionId: string | null = null;
  private walletId: string | null = null;
  private providerId: string | null = null;

  constructor() {
    this.logger = pino({
      level: process.env.LOG_LEVEL || 'info',
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      base: {
        service: 'wagering-processor',
        environment: process.env.NODE_ENV || 'development',
      },
    });
  }

  setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  setMessageId(id: string): void {
    this.messageId = id;
  }

  setTransactionId(id: string): void {
    this.transactionId = id;
  }

  setWalletId(id: string): void {
    this.walletId = id;
  }

  setProviderId(id: string): void {
    this.providerId = id;
  }

  clearContext(): void {
    this.correlationId = null;
    this.messageId = null;
    this.transactionId = null;
    this.walletId = null;
    this.providerId = null;
  }

  private getContext(): Record<string, string | null> {
    return {
      correlationId: this.correlationId,
      messageId: this.messageId,
      transactionId: this.transactionId,
      walletId: this.walletId,
      providerId: this.providerId,
    };
  }

  log(message: string, context?: Record<string, unknown>): void {
    this.logger.info({ ...this.getContext(), ...context }, message);
  }

  error(message: string, trace?: string, context?: Record<string, unknown>): void {
    this.logger.error({ ...this.getContext(), ...context, trace }, message);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.logger.warn({ ...this.getContext(), ...context }, message);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.logger.debug({ ...this.getContext(), ...context }, message);
  }

  verbose(message: string, context?: Record<string, unknown>): void {
    this.logger.trace({ ...this.getContext(), ...context }, message);
  }

  child(bindings: Record<string, unknown>): StructuredLoggerService {
    const childLogger = this.logger.child({ ...this.getContext(), ...bindings });
    const child = Object.create(StructuredLoggerService.prototype);
    Object.assign(child, this);
    (child as any).logger = childLogger;
    return child;
  }
}

export const generateCorrelationId = (): string => randomUUID();
export const generateMessageId = (): string => randomUUID();