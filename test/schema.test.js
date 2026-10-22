import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, resetDb, closePools } from './helpers/db.js';

const pool = getTestPool();
beforeEach(resetDb);
afterAll(closePools);

const insertUser = (overrides = {}) => {
  const u = { email: 'a@example.com', name: 'A', password_hash: 'h', role: 'user', sf_user_id: null, ...overrides };
  return pool.query(
    'INSERT INTO users (email, name, password_hash, role, sf_user_id) VALUES ($1, $2, $3, $4, $5)',
    [u.email, u.name, u.password_hash, u.role, u.sf_user_id],
  );
};

const sqlState = (promise) => promise.then(() => null, (err) => err.code);

describe('schema', () => {
  it('rejects emails that differ only by case', async () => {
    await insertUser({ email: 'Ana@Example.com' });
    expect(await sqlState(insertUser({ email: 'ana@example.com' }))).toBe('23505');
  });

  it('rejects duplicate sf_user_id', async () => {
    await insertUser({ email: 'a@x.com', sf_user_id: '005000000000001AAA' });
    expect(await sqlState(insertUser({ email: 'b@x.com', sf_user_id: '005000000000001AAA' }))).toBe('23505');
  });

  it('allows many users without sf_user_id', async () => {
    await insertUser({ email: 'a@x.com' });
    expect(await sqlState(insertUser({ email: 'b@x.com' }))).toBeNull();
  });

  it('rejects unknown roles', async () => {
    expect(await sqlState(insertUser({ role: 'root' }))).toBe('23514');
  });

  it('defaults lockout columns', async () => {
    await insertUser();
    const { rows } = await pool.query('SELECT failed_login_count, locked_until, active FROM users');
    expect(rows[0]).toEqual({ failed_login_count: 0, locked_until: null, active: true });
  });

  it('denies DDL to the runtime role', async () => {
    expect(await sqlState(pool.query('CREATE TABLE x (id int)'))).toBe('42501');
  });

  it('rejects duplicate canvas nonce hashes', async () => {
    const insert = () =>
      pool.query("INSERT INTO canvas_nonces (hash, expires_at) VALUES ($1, now() + interval '10 minutes')", ['a'.repeat(64)]);
    await insert();
    expect(await sqlState(insert())).toBe('23505');
  });

  it('enforces unique customer document', async () => {
    const insert = () => pool.query("INSERT INTO customers (name, document) VALUES ('C', '12345678909')");
    await insert();
    expect(await sqlState(insert())).toBe('23505');
  });

  it('has the connect-pg-simple session table', async () => {
    const { rows } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'session' ORDER BY column_name",
    );
    expect(rows.map((r) => r.column_name)).toEqual(['expire', 'sess', 'sid']);
  });
});
