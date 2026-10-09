import { Migration } from '@mikro-orm/migrations';

export class Migration20261009123904 extends Migration {

  override name = 'Migration20261009123904_AddPartialUniqueConstraintForReversal';

  override up(): void | Promise<void> {
    // Partial unique index: impede duas reversões PROCESSED do mesmo tipo para a mesma transação de referência
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "wager_transactions_reversal_unique"
      ON "wager_transactions" ("reference_transaction_id", "kind")
      WHERE "status" = 'PROCESSED' AND "kind" IN ('REFUND', 'ROLLBACK');
    `);
  }

  override down(): void | Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "wager_transactions_reversal_unique";`);
  }

}