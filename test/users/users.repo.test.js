import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { usersRepo } from '../../src/users/users.repo.js';
import { DuplicateError } from '../../src/errors.js';
import { verifyPassword } from '../../src/security/password.js';
import { getTestPool, resetDb, closePools } from '../helpers/db.js';

const repo = usersRepo(getTestPool());
beforeEach(resetDb);
afterAll(closePools);

const base = { email: 'ana@example.com', name: 'Ana', password: 'correct horse battery', role: 'user' };

describe('usersRepo', () => {
  it('creates a user without exposing the hash', async () => {
    const user = await repo.create(base);
    expect(user).toMatchObject({ email: 'ana@example.com', name: 'Ana', role: 'user', active: true, sfUserId: null });
    expect(user).not.toHaveProperty('passwordHash');
    expect(await repo.findById(user.id)).not.toHaveProperty('passwordHash');
  });

  it('raises DuplicateError on email with different case', async () => {
    await repo.create(base);
    await expect(repo.create({ ...base, email: 'ANA@example.com' })).rejects.toMatchObject({
      constructor: DuplicateError,
      field: 'email',
    });
  });

  it('normalises a 15-char sfUserId to 18 chars', async () => {
    const user = await repo.create({ ...base, sfUserId: '005000000000001' });
    expect(user.sfUserId).toBe('005000000000001AAA');
    expect((await repo.findBySfUserId('005000000000001AAA')).id).toBe(user.id);
  });

  it('raises DuplicateError on sf_user_id', async () => {
    await repo.create({ ...base, sfUserId: '005000000000001AAA' });
    await expect(
      repo.create({ ...base, email: 'b@example.com', sfUserId: '005000000000001' }),
    ).rejects.toMatchObject({ field: 'sf_user_id' });
  });

  it('clears sfUserId when given an empty string', async () => {
    const user = await repo.create({ ...base, sfUserId: '005000000000001AAA' });
    expect((await repo.update(user.id, { sfUserId: '' })).sfUserId).toBeNull();
  });

  it('changes the password hash on update', async () => {
    const user = await repo.create(base);
    await repo.update(user.id, { password: 'another long password' });
    const withHash = await repo.findByEmailWithHash('ana@example.com');
    expect(await verifyPassword(withHash.passwordHash, 'another long password')).toBe(true);
  });

  it('locks the account on the 5th consecutive failure', async () => {
    const user = await repo.create(base);
    for (let i = 0; i < 4; i++) expect((await repo.recordLoginFailure(user.id)).lockedUntil).toBeNull();
    const { lockedUntil } = await repo.recordLoginFailure(user.id);
    const minutes = (lockedUntil.getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
    expect((await repo.findById(user.id)).failedLoginCount).toBe(0);
  });

  it('unlock clears locked_until and the counter', async () => {
    const user = await repo.create(base);
    for (let i = 0; i < 5; i++) await repo.recordLoginFailure(user.id);
    await repo.recordLoginFailure(user.id);
    await repo.unlock(user.id);
    expect(await repo.findById(user.id)).toMatchObject({ lockedUntil: null, failedLoginCount: 0 });
  });

  it('counts active admins', async () => {
    await repo.create({ ...base, role: 'admin' });
    await repo.create({ ...base, email: 'b@example.com', role: 'admin', active: false });
    expect(await repo.countActiveAdmins()).toBe(1);
  });

  it('removes a user', async () => {
    const user = await repo.create(base);
    expect(await repo.remove(user.id)).toBe(true);
    expect(await repo.findById(user.id)).toBeNull();
  });
});
