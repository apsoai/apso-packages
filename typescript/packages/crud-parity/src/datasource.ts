/**
 * typeorm-pglite keeps a process-wide singleton PGlite instance, so true
 * instance-per-app isolation is impossible in one process. Instead each app
 * gets its own Postgres SCHEMA inside the shared instance: identical tables,
 * independent serial sequences, full data isolation.
 */
import { DataSource } from 'typeorm';
import { PGliteDriver, getPGliteInstance } from 'typeorm-pglite';
import { ALL_ENTITIES } from './entities';
import { seed } from './seed';

export async function createSeededDataSource(schema: string): Promise<DataSource> {
  const pg = await getPGliteInstance();
  await pg.exec(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);

  const ds = new DataSource({
    type: 'postgres',
    driver: new PGliteDriver().driver,
    schema,
    entities: ALL_ENTITIES,
    synchronize: true,
    logging: false,
  } as any);
  await ds.initialize();
  await seed(ds, schema);
  return ds;
}
