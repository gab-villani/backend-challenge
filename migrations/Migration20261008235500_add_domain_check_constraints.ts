import { Migration } from '@mikro-orm/migrations';

export class Migration20261008235500AddDomainCheckConstraints extends Migration {

  override name = 'Migration20261008235500AddDomainCheckConstraints';

  override up(): void | Promise<void> {
    this.addSql(`
      alter table "wager_transactions"
      add constraint "wager_transactions_kind_check"
      check ("kind" in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'));
    `);

    this.addSql(`
      alter table "wager_transactions"
      add constraint "wager_transactions_status_check"
      check ("status" in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED'));
    `);

    this.addSql(`
      alter table "wallet_ledger_entries"
      add constraint "wallet_ledger_entries_direction_check"
      check ("direction" in ('DEBIT', 'CREDIT'));
    `);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wager_transactions" drop constraint if exists "wager_transactions_kind_check";`);
    this.addSql(`alter table "wager_transactions" drop constraint if exists "wager_transactions_status_check";`);
    this.addSql(`alter table "wallet_ledger_entries" drop constraint if exists "wallet_ledger_entries_direction_check";`);
  }

}
