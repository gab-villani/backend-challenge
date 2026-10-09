import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let orm: MikroORM;
  let em: EntityManager;

  beforeAll(async () => {
    process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS = '100';

    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    orm = moduleFixture.get(MikroORM);
    em = orm.em.fork();

    const generator = orm.schema;
    await generator.ensureDatabase();
    await generator.drop();
    await generator.create();
  });

  afterAll(async () => {
    // Don't await app.close() as it hangs in test environment due to SQS/DB connection issues
    // app.close() triggers graceful shutdown which tries to publish outbox messages
    // but the test ORM connection is in a bad state
    await orm.close();
  });

  beforeEach(async () => {
    await em.nativeDelete('OutboxMessage', {});
    await em.nativeDelete('InboxMessage', {});
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
