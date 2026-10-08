import { Entity, PrimaryKey } from '@mikro-orm/decorators/legacy';

@Entity({ abstract: true })
export abstract class BaseEntity {
  @PrimaryKey()
  id!: string;
}
