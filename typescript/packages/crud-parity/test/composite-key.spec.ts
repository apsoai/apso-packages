/**
 * Keys the caller chooses: a composite primary key, and a single key column
 * the database does not generate.
 *
 * - A controller whose `params` mark several entries `primary` addresses one
 *   row at /:first/:second, in the order the params are declared.
 * - Under @CrudAuth persist, a create keeps the key columns the caller sends
 *   and only ever adds a row. It answers 409 for a key that exists, in the
 *   caller's tenant or in another one, and leaves that row as it was.
 *
 * Runs real HTTP requests against @apso/crud on pglite.
 */
import 'reflect-metadata';
import { Controller, INestApplication, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { Column, DataSource, DeleteDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, Repository } from 'typeorm';
import { PGliteDriver, getPGliteInstance } from 'typeorm-pglite';
import { Crud, CrudAuth } from '@apso/crud';
import { TypeOrmCrudService } from '@apso/crud-typeorm';

jest.setTimeout(180000);

@Entity('rate_limit')
class RateLimit {
  @PrimaryColumn('text') bucket!: string;
  @PrimaryColumn({ type: 'timestamptz', name: 'window_start' }) windowStart!: Date;
  @Column('int') hits!: number;
}

/** Tenant-scoped, and the tenant column is part of the key. */
@Entity('page')
class Page {
  @PrimaryColumn('int') workspaceId!: number;
  @PrimaryColumn('text') slug!: string;
  @Column('text') title!: string;
}

/** Tenant-scoped, with one key column the caller sends. */
@Entity('doc')
class Doc {
  @PrimaryColumn('text') slug!: string;
  @Column('int') workspaceId!: number;
  @Column('text') title!: string;
}

/** Tenant-scoped, with a key the database generates. */
@Entity('note')
class Note {
  @PrimaryGeneratedColumn() id!: number;
  @Column('int') workspaceId!: number;
  @Column('text') text!: string;
}

/** Not scoped: a lookup table any tenant may reference. */
@Entity('kind')
class Kind {
  @PrimaryGeneratedColumn() id!: number;
  @Column('text') name!: string;
}

/** Tenant-scoped, and one key column is the foreign key of a relation. */
@Entity('tagging')
class Tagging {
  @PrimaryColumn('text') slug!: string;
  @PrimaryColumn('int') kindId!: number;
  @ManyToOne(() => Kind) @JoinColumn({ name: 'kindId' }) kind?: Kind;
  @Column('int') workspaceId!: number;
  @Column('text') note!: string;
}

/** Tenant-scoped, soft-deleted, with a key the caller sends. */
@Entity('draft')
class Draft {
  @PrimaryColumn('text') slug!: string;
  @Column('int') workspaceId!: number;
  @Column('text') title!: string;
  @DeleteDateColumn({ type: 'timestamptz', nullable: true }) deletedAt?: Date | null;
}

const ENTITIES = [RateLimit, Page, Doc, Note, Kind, Tagging, Draft];
const tenant = (req: any) => ({ workspaceId: Number(req.headers['x-ws']) });
const SCOPED = { filter: tenant, persist: tenant };

@Injectable()
class RateLimitService extends TypeOrmCrudService<RateLimit> {
  constructor(@InjectRepository(RateLimit) repo: Repository<RateLimit>) {
    super(repo);
  }
}
@Crud({
  model: { type: RateLimit },
  params: {
    bucket: { field: 'bucket', type: 'string', primary: true },
    windowStart: { field: 'windowStart', type: 'string', primary: true },
  },
})
@Controller('rate-limits')
class RateLimitController {
  constructor(public service: RateLimitService) {}
}

@Injectable()
class PageService extends TypeOrmCrudService<Page> {
  constructor(@InjectRepository(Page) repo: Repository<Page>) {
    super(repo);
  }
}
@Crud({
  model: { type: Page },
  params: {
    workspaceId: { field: 'workspaceId', type: 'string', primary: true },
    slug: { field: 'slug', type: 'string', primary: true },
  },
})
@CrudAuth(SCOPED)
@Controller('pages')
class PageController {
  constructor(public service: PageService) {}
}

@Injectable()
class DocService extends TypeOrmCrudService<Doc> {
  constructor(@InjectRepository(Doc) repo: Repository<Doc>) {
    super(repo);
  }
}
@Crud({ model: { type: Doc }, params: { id: { field: 'slug', type: 'string', primary: true } } })
@CrudAuth(SCOPED)
@Controller('docs')
class DocController {
  constructor(public service: DocService) {}
}

@Injectable()
class NoteService extends TypeOrmCrudService<Note> {
  constructor(@InjectRepository(Note) repo: Repository<Note>) {
    super(repo);
  }
}
@Crud({ model: { type: Note } })
@CrudAuth(SCOPED)
@Controller('notes')
class NoteController {
  constructor(public service: NoteService) {}
}

@Injectable()
class TaggingService extends TypeOrmCrudService<Tagging> {
  constructor(@InjectRepository(Tagging) repo: Repository<Tagging>) {
    super(repo);
  }
}
@Crud({
  model: { type: Tagging },
  params: {
    slug: { field: 'slug', type: 'string', primary: true },
    kindId: { field: 'kindId', type: 'string', primary: true },
  },
})
@CrudAuth(SCOPED)
@Controller('taggings')
class TaggingController {
  constructor(public service: TaggingService) {}
}

@Injectable()
class DraftService extends TypeOrmCrudService<Draft> {
  constructor(@InjectRepository(Draft) repo: Repository<Draft>) {
    super(repo);
  }
}
@Crud({ model: { type: Draft }, params: { id: { field: 'slug', type: 'string', primary: true } } })
@CrudAuth(SCOPED)
@Controller('drafts')
class DraftController {
  constructor(public service: DraftService) {}
}

let app: INestApplication;
let ds: DataSource;
const http = () => request(app.getHttpServer());
const as = (ws: number) => ({ 'x-ws': String(ws) });
const WINDOW = '2026-01-01T00:00:00.000Z';
const row = (bucket: string) => `/rate-limits/${bucket}/${encodeURIComponent(WINDOW)}`;

beforeAll(async () => {
  const pg = await getPGliteInstance();
  await pg.exec('CREATE SCHEMA IF NOT EXISTS "composite_key"');
  ds = new DataSource({
    type: 'postgres',
    driver: new PGliteDriver().driver,
    schema: 'composite_key',
    entities: ENTITIES,
    synchronize: true,
    logging: false,
  } as any);
  await ds.initialize();

  @Module({
    imports: [
      TypeOrmModule.forRootAsync({ useFactory: () => ({}) as any, dataSourceFactory: async () => ds }),
      TypeOrmModule.forFeature(ENTITIES),
    ],
    controllers: [RateLimitController, PageController, DocController, NoteController, TaggingController, DraftController],
    providers: [RateLimitService, PageService, DocService, NoteService, TaggingService, DraftService],
  })
  class AppModule {}
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close();
  if (ds?.isInitialized) await ds.destroy();
});

describe('one-row routes for a composite key', () => {
  it('reads, updates, replaces and deletes the row both key segments name', async () => {
    for (const bucket of ['a', 'b']) {
      const created = await http().post('/rate-limits').send({ bucket, windowStart: WINDOW, hits: 1 });
      expect(created.status).toBe(201);
    }

    const read = await http().get(row('a'));
    expect([read.status, read.body]).toEqual([200, { bucket: 'a', windowStart: WINDOW, hits: 1 }]);

    // A body cannot move the row to another key.
    const patched = await http().patch(row('a')).send({ hits: 2, bucket: 'b' });
    expect([patched.status, patched.body]).toMatchObject([200, { bucket: 'a', hits: 2 }]);

    const replaced = await http().put(row('a')).send({ hits: 3 });
    expect([replaced.status, replaced.body]).toMatchObject([200, { bucket: 'a', hits: 3 }]);

    expect((await http().delete(row('a'))).status).toBe(200);
    expect((await http().get(row('a'))).status).toBe(404);
    // The other row with the same second segment is untouched.
    expect((await http().get(row('b'))).body).toMatchObject({ bucket: 'b', hits: 1 });
  });

  it('answers 404 when either segment names no row, and has no one-segment route', async () => {
    expect((await http().get(`/rate-limits/b/${encodeURIComponent('2026-01-02T00:00:00.000Z')}`)).status).toBe(404);
    expect((await http().get(`/rate-limits/zzz/${encodeURIComponent(WINDOW)}`)).status).toBe(404);
    expect((await http().get('/rate-limits/b')).status).toBe(404);
    expect((await http().patch('/rate-limits/b').send({ hits: 9 })).status).toBe(404);
  });

  it('reads one row in the PostgREST dialect too', async () => {
    // A select always returns the key columns.
    const read = await http().get(`${row('b')}?select=hits`).set('X-Crud-Dialect', 'postgrest');
    expect([read.status, read.body]).toEqual([200, { bucket: 'b', windowStart: WINDOW, hits: 1 }]);
  });

  it('documents one path parameter per key column', () => {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const path = doc.paths['/rate-limits/{bucket}/{windowStart}'];
    expect(Object.keys(path).sort()).toEqual(['delete', 'get', 'patch', 'put']);
    const names = (path.get!.parameters as any[]).filter((p) => p.in === 'path').map((p) => p.name);
    expect(names).toEqual(['bucket', 'windowStart']);
    // A single key keeps /:id.
    expect(doc.paths['/notes/{id}']).toBeDefined();
  });
});

describe('a create that names its own key, under auth persist', () => {
  it('keeps the tenant column of a composite key and the column the caller sends', async () => {
    const first = await http().post('/pages').set(as(1)).send({ slug: 'home', title: 'one' });
    expect([first.status, first.body]).toEqual([201, { workspaceId: 1, slug: 'home', title: 'one' }]);

    // The same slug in another tenant is another key.
    const other = await http().post('/pages').set(as(2)).send({ slug: 'home', title: 'two' });
    expect([other.status, other.body]).toEqual([201, { workspaceId: 2, slug: 'home', title: 'two' }]);

    expect((await http().get('/pages/1/home').set(as(1))).body).toMatchObject({ title: 'one' });
    // Another tenant's row is not found, whatever the path says.
    expect((await http().get('/pages/1/home').set(as(2))).status).toBe(404);
  });

  it('answers 409 for a key that exists and leaves the row as it was', async () => {
    const again = await http().post('/pages').set(as(1)).send({ slug: 'home', title: 'again' });
    expect(again.status).toBe(409);
    // A tenant column in the body is replaced by the caller's, so this is (2, home).
    const forged = await http().post('/pages').set(as(2)).send({ workspaceId: 1, slug: 'home', title: 'forged' });
    expect(forged.status).toBe(409);

    expect(await ds.getRepository(Page).find({ order: { workspaceId: 'ASC' } })).toEqual([
      { workspaceId: 1, slug: 'home', title: 'one' },
      { workspaceId: 2, slug: 'home', title: 'two' },
    ]);
  });

  it("does not write over another tenant's row that has the key", async () => {
    expect((await http().post('/docs').set(as(1)).send({ slug: 'plan', title: 'mine' })).status).toBe(201);

    const taken = await http().post('/docs').set(as(2)).send({ slug: 'plan', title: 'theirs' });
    expect(taken.status).toBe(409);
    expect(await ds.getRepository(Doc).findOneBy({ slug: 'plan' })).toEqual({ slug: 'plan', workspaceId: 1, title: 'mine' });
  });

  it('refuses a bulk create that repeats a key, and saves none of its rows', async () => {
    const bulk = [
      { slug: 'x', title: 'first' },
      { slug: 'x', title: 'second' },
    ];
    expect((await http().post('/docs/bulk').set(as(1)).send({ bulk })).status).toBe(409);
    const mixed = [
      { slug: 'y', title: 'new' },
      { slug: 'plan', title: 'taken' },
    ];
    expect((await http().post('/docs/bulk').set(as(2)).send({ bulk: mixed })).status).toBe(409);
    expect(await ds.getRepository(Doc).count()).toBe(1);

    const ok = await http().post('/docs/bulk').set(as(2)).send({ bulk: [{ slug: 'y', title: 'new' }, { slug: 'z', title: 'new' }] });
    expect(ok.status).toBe(201);
    expect(ok.body.map((d: Doc) => [d.slug, d.workspaceId])).toEqual([['y', 2], ['z', 2]]);
  });

  it('still drops a key the database generates', async () => {
    const mine = await http().post('/notes').set(as(1)).send({ text: 'mine' });
    const stolen = await http().post('/notes').set(as(2)).send({ id: mine.body.id, text: 'stolen' });

    expect(stolen.status).toBe(201);
    expect(stolen.body.id).not.toBe(mine.body.id);
    expect(await ds.getRepository(Note).findOneBy({ id: mine.body.id })).toMatchObject({ workspaceId: 1, text: 'mine' });
  });

  describe('with a key column that is the foreign key of a relation', () => {
    const stored = () => ds.getRepository(Tagging).find({ order: { kindId: 'ASC' } });
    let one: number;
    let two: number;

    beforeAll(async () => {
      [one, two] = (await ds.getRepository(Kind).save([{ name: 'one' }, { name: 'two' }])).map((k) => k.id);
      expect((await http().post('/taggings').set(as(1)).send({ slug: 't', kindId: one, note: 'mine' })).status).toBe(201);
      expect((await http().post('/taggings').set(as(2)).send({ slug: 't', kindId: two, note: 'theirs' })).status).toBe(201);
    });

    // save() reads the relation before the column, so a relation object names a row too.
    it('reads a relation object as the key column on a create', async () => {
      const single = await http().post('/taggings').set(as(2)).send({ slug: 't', kind: { id: one }, note: 'stolen' });
      const both = await http().post('/taggings').set(as(2)).send({ slug: 't', kindId: 999, kind: { id: one }, note: 'stolen' });
      const bulk = await http().post('/taggings/bulk').set(as(2)).send({ bulk: [{ slug: 't', kind: { id: one }, note: 'stolen' }] });

      expect([single.status, both.status, bulk.status]).toEqual([409, 409, 409]);
      expect(await stored()).toEqual([
        { slug: 't', kindId: one, workspaceId: 1, note: 'mine' },
        { slug: 't', kindId: two, workspaceId: 2, note: 'theirs' },
      ]);
    });

    it('creates the row the relation object names when the key is free', async () => {
      const created = await http().post('/taggings').set(as(2)).send({ slug: 'free', kind: { id: one }, note: 'new' });
      expect([created.status, created.body]).toMatchObject([201, { slug: 'free', kindId: one, workspaceId: 2 }]);
      await ds.getRepository(Tagging).delete({ slug: 'free' });
    });

    it('drops a relation object for a key column on PATCH and PUT', async () => {
      const patched = await http().patch(`/taggings/t/${two}`).set(as(2)).send({ kind: { id: one }, note: 'via-patch' });
      expect([patched.status, patched.body]).toMatchObject([200, { kindId: two, note: 'via-patch' }]);
      const replaced = await http().put(`/taggings/t/${two}`).set(as(2)).send({ kind: { id: one }, note: 'via-put' });
      expect([replaced.status, replaced.body]).toMatchObject([200, { kindId: two, note: 'via-put' }]);

      expect(await stored()).toEqual([
        { slug: 't', kindId: one, workspaceId: 1, note: 'mine' },
        { slug: 't', kindId: two, workspaceId: 2, note: 'via-put' },
      ]);
    });
  });

  it('answers 409 for a key a soft-deleted row has', async () => {
    const drafts = ds.getRepository(Draft);
    await drafts.save({ slug: 'plan', workspaceId: 1, title: 'mine' });
    await drafts.softDelete({ slug: 'plan' });

    const taken = await http().post('/drafts').set(as(2)).send({ slug: 'plan', title: 'theirs' });
    expect(taken.status).toBe(409);
    expect(await drafts.findOne({ where: { slug: 'plan' }, withDeleted: true })).toMatchObject({ workspaceId: 1, title: 'mine' });
  });

  it('looks the key up and saves in one REPEATABLE READ transaction', async () => {
    const queries: string[] = [];
    const logger = ds.logger;
    (ds as any).logger = {
      logQuery: (query: string) => queries.push(query),
      logQueryError: () => undefined,
      logQuerySlow: () => undefined,
      logSchemaBuild: () => undefined,
      logMigration: () => undefined,
      log: () => undefined,
    };
    try {
      await http().post('/docs').set(as(1)).send({ slug: 'logged', title: 't' });
    } finally {
      (ds as any).logger = logger;
    }

    const step = (pattern: RegExp) => queries.findIndex((q) => pattern.test(q));
    const steps = [
      step(/^START TRANSACTION/i),
      step(/REPEATABLE READ/i),
      step(/^SELECT[\s\S]*"slug" = /i),
      step(/^INSERT/i),
      step(/^COMMIT/i),
    ];
    expect(steps.every((i) => i >= 0)).toBe(true);
    expect(steps).toEqual(steps.slice().sort((a, b) => a - b));
    expect(queries.filter((q) => /^START TRANSACTION/i.test(q))).toHaveLength(1);
  });
});
