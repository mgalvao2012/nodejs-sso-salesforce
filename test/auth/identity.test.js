import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resolveSalesforceUser, IdentityRejectedError } from '../../src/auth/identity.js';
import { usersRepo } from '../../src/users/users.repo.js';
import { getTestPool, resetDb, closePools, testConfig } from '../helpers/db.js';

const pool = getTestPool();
const users = usersRepo(pool);
beforeEach(resetDb);
afterAll(closePools);

const ORG_ID = testConfig.sfAllowedOrgId; // 00D000000000001EAA
const SF_USER_ID = '005000000000001AAA';

const create = (overrides = {}) =>
  users.create({ email: 'ana@example.com', name: 'Ana', password: 'correct horse battery', ...overrides });

const rejection = (promise) =>
  promise.then(
    () => null,
    (err) => {
      expect(err).toBeInstanceOf(IdentityRejectedError);
      return err.reason;
    },
  );

describe('resolveSalesforceUser', () => {
  it('returns the linked user, accepting a 15-char user id', async () => {
    const user = await create({ sfUserId: SF_USER_ID });
    const resolved = await resolveSalesforceUser(users, testConfig, { orgId: ORG_ID, userId: '005000000000001' });
    expect(resolved.id).toBe(user.id);
  });

  it('accepts a 15-char org id', async () => {
    await create({ sfUserId: SF_USER_ID });
    const resolved = await resolveSalesforceUser(users, testConfig, { orgId: '00D000000000001', userId: SF_USER_ID });
    expect(resolved).not.toBeNull();
  });

  it('rejects another org', async () => {
    await create({ sfUserId: SF_USER_ID });
    expect(await rejection(resolveSalesforceUser(users, testConfig, { orgId: '00D000000000002EAA', userId: SF_USER_ID })))
      .toBe('org_not_allowed');
  });

  it('never links by email', async () => {
    const user = await create(); // same email as the Salesforce user, but no sf_user_id
    expect(await rejection(resolveSalesforceUser(users, testConfig, { orgId: ORG_ID, userId: SF_USER_ID, email: 'ana@example.com' })))
      .toBe('not_provisioned');
    expect((await users.findById(user.id)).sfUserId).toBeNull();
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
    expect(rows[0].n).toBe(1);
  });

  it('rejects inactive users', async () => {
    await create({ sfUserId: SF_USER_ID, active: false });
    expect(await rejection(resolveSalesforceUser(users, testConfig, { orgId: ORG_ID, userId: SF_USER_ID }))).toBe('inactive');
  });

  it('rejects locked users', async () => {
    const user = await create({ sfUserId: SF_USER_ID });
    for (let i = 0; i < 5; i++) await users.recordLoginFailure(user.id);
    expect(await rejection(resolveSalesforceUser(users, testConfig, { orgId: ORG_ID, userId: SF_USER_ID }))).toBe('inactive');
  });

  it.each([undefined, '', 'garbage', '0050000000000010'])('maps malformed user id %s to not_provisioned', async (userId) => {
    expect(await rejection(resolveSalesforceUser(users, testConfig, { orgId: ORG_ID, userId }))).toBe('not_provisioned');
  });

  it.each([undefined, 'garbage'])('maps malformed org id %s to org_not_allowed', async (orgId) => {
    expect(await rejection(resolveSalesforceUser(users, testConfig, { orgId, userId: SF_USER_ID }))).toBe('org_not_allowed');
  });
});
