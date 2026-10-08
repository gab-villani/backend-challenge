import { Migration } from '@mikro-orm/migrations';

export class Migration20261008020000 extends Migration {

  override name = 'Migration20261008020000';

  override up(): void | Promise<void> {
    this.addSql(`
      create table "wager_transactions" (
        "id" uuid not null,
        "wallet_id" uuid not null,
        "provider_id" varchar(255) not null,
        "external_transaction_id" varchar(255) not null,
        "idempotency_key" varchar(255) not null,
        "kind" varchar(10) not null,
        "amount" numeric(18, 2) not null,
        "currency" varchar(3) not null,
        "player_id" varchar(255) not null,
        "round_id" varchar(255) not null,
        "game_id" varchar(255) not null,
        "reference_transaction_id" uuid null,
        "status" varchar(20) not null default 'PENDING',
        "payload_hash" varchar(64) null,
        "failure_code" varchar(50) null,
        "failure_reason" text null,
        "created_at" timestamptz not null,
        "processed_at" timestamptz null,
        primary key ("id")
      );
    `);
    
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key");`);
    this.addSql(`create index "wager_transactions_wallet_id_idx" on "wager_transactions" ("wallet_id");`);
    this.addSql(`create index "wager_transactions_provider_ext_idx" on "wager_transactions" ("provider_id", "external_transaction_id");`);
    this.addSql(`create index "wager_transactions_status_idx" on "wager_transactions" ("status");`);
    this.addSql(`create index "wager_transactions_reference_idx" on "wager_transactions" ("reference_transaction_id");`);
    this.addSql(`create index "wager_transactions_player_round_idx" on "wager_transactions" ("player_id", "round_id");`);

    this.addSql(`
      create table "wallet_ledger_entries" (
        "id" uuid not null,
        "wallet_id" uuid not null,
        "transaction_id" uuid not null,
        "direction" varchar(6) not null,
        "money_amount" numeric(18, 2) not null,
        "money_currency" varchar(3) not null,
        "balance_before_amount" numeric(18, 2) not null,
        "balance_before_currency" varchar(3) not null,
        "balance_after_amount" numeric(18, 2) not null,
        "balance_after_currency" varchar(3) not null,
        "created_at" timestamptz not null default now(),
        primary key ("id")
      );
    `);

    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_transaction_id_unique" unique ("transaction_id");`);
    this.addSql(`create index "wallet_ledger_entries_wallet_created_idx" on "wallet_ledger_entries" ("wallet_id", "created_at");`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_wallet_id_fkey" foreign key ("wallet_id") references "wallets" ("id") on delete cascade;`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_transaction_id_fkey" foreign key ("transaction_id") references "wager_transactions" ("id") on delete cascade;`);

    this.addSql(`
      create table "inbox_messages" (
        "id" uuid not null,
        "message_id" varchar(255) not null,
        "consumer_name" varchar(255) not null,
        "payload_hash" varchar(64) not null,
        "received_at" timestamptz not null,
        "processed_at" timestamptz null,
        primary key ("id")
      );
    `);

    this.addSql(`alter table "inbox_messages" add constraint "inbox_messages_consumer_message_unique" unique ("consumer_name", "message_id");`);
    this.addSql(`create index "inbox_messages_processed_idx" on "inbox_messages" ("processed_at");`);

    this.addSql(`
      create table "outbox_messages" (
        "id" uuid not null,
        "aggregate_id" uuid not null,
        "event_type" varchar(100) not null,
        "payload" jsonb not null,
        "occurred_at" timestamptz not null,
        "attempts" int not null default 0,
        "next_attempt_at" timestamptz null,
        "published_at" timestamptz null,
        primary key ("id")
      );
    `);

    this.addSql(`create index "outbox_messages_due_idx" on "outbox_messages" ("next_attempt_at", "published_at") where "published_at" is null;`);
    this.addSql(`create index "outbox_messages_aggregate_idx" on "outbox_messages" ("aggregate_id");`);

    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_wallet_id_fkey" foreign key ("wallet_id") references "wallets" ("id") on delete restrict;`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_reference_fkey" foreign key ("reference_transaction_id") references "wager_transactions" ("id") on delete restrict;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "outbox_messages" cascade;`);
    this.addSql(`drop table if exists "inbox_messages" cascade;`);
    this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);
    this.addSql(`drop table if exists "wager_transactions" cascade;`);
  }

}