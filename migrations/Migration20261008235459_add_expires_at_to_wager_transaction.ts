import { Migration } from '@mikro-orm/migrations';

export class Migration20261008235459_add_expires_at_to_wager_transaction extends Migration {

  override name = 'Migration20261008235459_add_expires_at_to_wager_transaction';

  override up(): void | Promise<void> {
    this.addSql(`alter table "wager_transactions" add "expires_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wager_transactions" drop column "expires_at";`);
  }

}
