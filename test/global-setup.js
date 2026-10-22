import { runner } from 'node-pg-migrate';
import { TEST_DATABASE_MIGRATION_URL } from './test-env.js';

export default async function setup() {
  await runner({
    databaseUrl: TEST_DATABASE_MIGRATION_URL,
    dir: 'migrations',
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => {},
  });
}
