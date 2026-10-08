import {
  Entity,
  PrimaryKey,
  Property,
  Index,
} from '@mikro-orm/decorators/legacy';
import { IntegrationEvent } from '../domain/integration-event.js';

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date | null;
  publishedAt?: Date | null;
}

@Entity({ tableName: 'outbox_messages' })
@Index({ properties: ['nextAttemptAt', 'publishedAt'] })
@Index({ properties: ['aggregateId'] })
export class OutboxMessage {
  @PrimaryKey({ type: 'uuid' })
  readonly id: string;

  @Property({ type: 'string', fieldName: 'aggregate_id' })
  readonly aggregateId: string;

  @Property({ type: 'string', fieldName: 'event_type', length: 100 })
  readonly eventType: string;

  @Property({ type: 'json', fieldName: 'payload' })
  readonly payload: Readonly<Record<string, unknown>>;

  @Property({ type: 'Date', fieldName: 'occurred_at' })
  readonly occurredAt: Date;

  @Property({ type: 'number', fieldName: 'attempts', default: 0 })
  attempts: number = 0;

  @Property({ type: 'Date', fieldName: 'next_attempt_at', nullable: true })
  nextAttemptAt: Date | null = null;

  @Property({ type: 'Date', fieldName: 'published_at', nullable: true })
  publishedAt: Date | null = null;

  private constructor(
    id: string,
    aggregateId: string,
    eventType: string,
    payload: Readonly<Record<string, unknown>>,
    occurredAt: Date,
  ) {
    this.id = id;
    this.aggregateId = aggregateId;
    this.eventType = eventType;
    this.payload = payload;
    this.occurredAt = occurredAt;
    this.nextAttemptAt = occurredAt;
  }

  static enqueue<T>(event: IntegrationEvent<T>): OutboxMessage {
    return new OutboxMessage(
      crypto.randomUUID(),
      event.aggregateId,
      event.eventType,
      event.toJSON().data as Record<string, unknown>,
      event.occurredAt,
    );
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    const msg = Object.create(OutboxMessage.prototype);
    msg.id = state.id;
    msg.aggregateId = state.aggregateId;
    msg.eventType = state.eventType;
    msg.payload = state.payload;
    msg.occurredAt = state.occurredAt;
    msg.attempts = state.attempts;
    msg.nextAttemptAt = state.nextAttemptAt ?? null;
    msg.publishedAt = state.publishedAt ?? null;
    Object.freeze(msg);
    return msg;
  }

  isPending(): boolean {
    return this.publishedAt === null;
  }

  isDue(now: Date): boolean {
    return this.isPending() && this.nextAttemptAt !== null && this.nextAttemptAt <= now;
  }

  markPublished(at: Date): void {
    if (this.publishedAt) {
      throw new Error('Outbox message already published');
    }
    this.publishedAt = at;
  }

  scheduleRetry(now: Date): void {
    if (this.publishedAt) {
      throw new Error('Cannot schedule retry for published message');
    }
    this.attempts += 1;
    const baseDelayMs = 1000;
    const maxDelayMs = 60000;
    const delay = Math.min(baseDelayMs * Math.pow(2, this.attempts - 1), maxDelayMs);
    const jitter = Math.random() * 0.3 * delay;
    this.nextAttemptAt = new Date(now.getTime() + delay + jitter);
  }

  getEventEnvelope(): {
    eventId: string;
    eventType: string;
    aggregateId: string;
    correlationId: string;
    causationId?: string;
    occurredAt: string;
    version: number;
    data: Record<string, unknown>;
  } {
    return {
      eventId: this.id,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.payload.correlationId as string,
      causationId: this.payload.causationId as string | undefined,
      occurredAt: this.occurredAt.toISOString(),
      version: this.payload.version as number,
      data: this.payload.data as Record<string, unknown>,
    };
  }
}