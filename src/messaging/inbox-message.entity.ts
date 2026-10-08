import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
  Index,
} from '@mikro-orm/decorators/legacy';

export interface InboxMessageState {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt?: Date | null;
}

@Entity({ tableName: 'inbox_messages' })
@Unique({ properties: ['consumerName', 'messageId'] })
@Index({ properties: ['processedAt'] })
export class InboxMessage {
  @PrimaryKey({ type: 'uuid' })
  readonly id: string;

  @Property({ type: 'string', fieldName: 'message_id' })
  readonly messageId: string;

  @Property({ type: 'string', fieldName: 'consumer_name' })
  readonly consumerName: string;

  @Property({ type: 'string', fieldName: 'payload_hash', length: 64 })
  readonly payloadHash: string;

  @Property({ type: 'Date', fieldName: 'received_at' })
  readonly receivedAt: Date;

  @Property({ type: 'Date', fieldName: 'processed_at', nullable: true })
  processedAt: Date | null = null;

  private constructor(
    id: string,
    messageId: string,
    consumerName: string,
    payloadHash: string,
    receivedAt: Date,
  ) {
    this.id = id;
    this.messageId = messageId;
    this.consumerName = consumerName;
    this.payloadHash = payloadHash;
    this.receivedAt = receivedAt;
  }

  static receive(messageId: string, consumerName: string, payloadHash: string): InboxMessage {
    return new InboxMessage(
      crypto.randomUUID(),
      messageId,
      consumerName,
      payloadHash,
      new Date(),
    );
  }

  static rehydrate(state: InboxMessageState): InboxMessage {
    const msg = Object.create(InboxMessage.prototype);
    msg.id = state.messageId;
    msg.messageId = state.messageId;
    msg.consumerName = state.consumerName;
    msg.payloadHash = state.payloadHash;
    msg.receivedAt = state.receivedAt;
    msg.processedAt = state.processedAt ?? null;
    Object.freeze(msg);
    return msg;
  }

  isProcessed(): boolean {
    return this.processedAt !== null;
  }

  markProcessed(at: Date): void {
    if (this.processedAt) {
      throw new Error('Inbox message already processed');
    }
    this.processedAt = at;
  }
}