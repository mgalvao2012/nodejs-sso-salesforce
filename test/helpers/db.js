import pg from 'pg';
import { loadConfig } from '../../src/config.js';

export const testEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  SESSION_SECRET: 'test-session-secret-0123456789abcdef',
  SF_CANVAS_CONSUMER_KEY: 'test-consumer-key',
  SF_CANVAS_CONSUMER_SECRET: 'test-canvas-secret',
  SF_MY_DOMAIN_URL: 'https://example.my.salesforce.com',
  SF_ALLOWED_ORG_ID: '00D000000000001EAA',
  SF_TRUSTED_ORIGINS: 'https://example.my.salesforce.com https://example--c.vf.force.com',
};

export const testConfig = loadConfig(testEnv);

let runtimePool;
let migratorPool;

export function getTestPool() {
  runtimePool ??= new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5 });
  return runtimePool;
}

export function getMigratorPool() {
  migratorPool ??= new pg.Pool({ connectionString: process.env.TEST_DATABASE_MIGRATION_URL, max: 2 });
  return migratorPool;
}

export async function resetDb() {
  const pool = getMigratorPool();
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
  await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

export async function closePools() {
  await runtimePool?.end();
  await migratorPool?.end();
  runtimePool = undefined;
  migratorPool = undefined;
}
