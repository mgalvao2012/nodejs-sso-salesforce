import pg from 'pg';

export function createPool(connectionString, logger) {
  const pool = new pg.Pool({ connectionString });
  pool.on('error', (err) => logger.error({ err }, 'db.pool_error'));
  return pool;
}

export async function withTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
