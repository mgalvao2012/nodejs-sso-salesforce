import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/security/password.js';

describe('password hashing', () => {
  it('verifies the original password', async () => {
    expect(await verifyPassword(await hashPassword('s3cret!'), 's3cret!')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    expect(await verifyPassword(await hashPassword('s3cret!'), 'wrong')).toBe(false);
  });

  it('uses argon2id', async () => {
    expect(await hashPassword('s3cret!')).toMatch(/^\$argon2id\$/);
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});
