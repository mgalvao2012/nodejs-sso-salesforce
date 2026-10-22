import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { consumeCanvasNonce } from '../../src/auth/canvas-nonce.js';
import { getTestPool, resetDb, closePools } from '../helpers/db.js';

const pool = getTestPool();
beforeEach(resetDb);
afterAll(closePools);

describe('consumeCanvasNonce', () => {
  it('accepts a signed request only once', async () => {
    expect(await consumeCanvasNonce(pool, 'sig.payload')).toBe(true);
    expect(await consumeCanvasNonce(pool, 'sig.payload')).toBe(false);
    expect(await consumeCanvasNonce(pool, 'other.payload')).toBe(true);
  });

  it('stores only a sha256 hash', async () => {
    await consumeCanvasNonce(pool, 'sig.payload');
    const { rows } = await pool.query('SELECT hash FROM canvas_nonces');
    expect(rows[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps nonces for 24 hours so replays stay blocked for a whole Salesforce session', async () => {
    await consumeCanvasNonce(pool, 'payload');
    const { rows } = await pool.query("SELECT expires_at > now() + interval '23 hours' AS long_lived FROM canvas_nonces");
    expect(rows[0].long_lived).toBe(true);
  });

  it('purges expired nonces on the next call', async () => {
    await pool.query("INSERT INTO canvas_nonces (hash, expires_at) VALUES ($1, now() - interval '1 minute')", ['e'.repeat(64)]);
    await consumeCanvasNonce(pool, 'fresh');
    const { rows } = await pool.query('SELECT hash FROM canvas_nonces WHERE hash = $1', ['e'.repeat(64)]);
    expect(rows).toHaveLength(0);
  });
});
