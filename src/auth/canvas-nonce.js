import { createHash } from 'node:crypto';

// Kept for the longest Salesforce session timeout: payloads may carry no issuedAt, so expiry
// of the nonce row must not reopen a replay window while the embedded OAuth token is still valid.
export const NONCE_TTL_MS = 24 * 60 * 60 * 1000;

// Records a signed Canvas payload as used. Returns false when it was already consumed (replay).
export async function consumeCanvasNonce(pool, signedPayload, ttlMs = NONCE_TTL_MS) {
  const hash = createHash('sha256').update(signedPayload).digest('hex');
  await pool.query('DELETE FROM canvas_nonces WHERE expires_at < now()');
  const { rowCount } = await pool.query(
    `INSERT INTO canvas_nonces (hash, expires_at) VALUES ($1, now() + make_interval(secs => $2))
     ON CONFLICT (hash) DO NOTHING`,
    [hash, ttlMs / 1000],
  );
  return rowCount === 1;
}
