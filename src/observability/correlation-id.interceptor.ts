import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { StructuredLoggerService, generateCorrelationId } from './logger.service.js';

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  constructor(private readonly logger: StructuredLoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const correlationId = (request.headers['x-correlation-id'] as string) || generateCorrelationId();
    
    this.logger.setCorrelationId(correlationId);
    request.correlationId = correlationId;

    return next.handle().pipe(
      tap(() => {
        this.logger.clearContext();
      }),
    );
  }
}