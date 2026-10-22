import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { usersRepo } from '../../src/users/users.repo.js';
import { getTestPool, resetDb, closePools, testConfig } from '../helpers/db.js';
import { extractCsrf, loginAs } from '../helpers/agent.js';
import { captureLogger } from '../helpers/log-capture.js';

const pool = getTestPool();
const users = usersRepo(pool);
beforeEach(resetDb);
afterAll(closePools);

const PASSWORD = 'correct horse battery';

async function setup({ role = 'admin' } = {}) {
  const cap = captureLogger(testConfig);
  const app = createApp({ pool, config: testConfig, logger: cap.logger });
  const me = await users.create({ email: 'admin@example.com', name: 'Admin', password: PASSWORD, role });
  const agent = await loginAs(app, me, PASSWORD);
  const csrf = async () => extractCsrf((await agent.get('/customers')).text);
  const post = async (path, data) => {
    const token = await csrf();
    return agent.post(path).type('form').send({ _csrf: token, ...data });
  };
  return { app, agent, cap, me, post };
}

const newUser = { email: 'bob@example.com', name: 'Bob', role: 'user', active: 'on', password: 'another long password' };

describe('users CRUD', () => {
  it('forbids non-admins', async () => {
    const { agent } = await setup({ role: 'user' });
    expect((await agent.get('/users')).status).toBe(403);
  });

  it('creates a user', async () => {
    const { agent, post } = await setup();
    const res = await post('/users', newUser);
    expect(res.status).toBe(302);
    expect((await agent.get('/users')).text).toContain('bob@example.com');
  });

  it('requires a 12+ char password on create', async () => {
    const { post } = await setup();
    expect((await post('/users', { ...newUser, password: 'short' })).status).toBe(422);
    expect((await post('/users', { ...newUser, password: '' })).status).toBe(422);
  });

  it('rejects a duplicate email in different case', async () => {
    const { post } = await setup();
    const res = await post('/users', { ...newUser, email: 'ADMIN@example.com' });
    expect(res.status).toBe(409);
    expect(res.text).toContain('Email already registered.');
  });

  it('normalises a 15-char Salesforce User Id', async () => {
    const { post } = await setup();
    await post('/users', { ...newUser, sfUserId: '005000000000001' });
    expect((await users.findByEmailWithHash('bob@example.com')).sfUserId).toBe('005000000000001AAA');
  });

  it('rejects a Salesforce Id that is not a user id', async () => {
    const { post } = await setup();
    expect((await post('/users', { ...newUser, sfUserId: '001000000000001' })).status).toBe(422);
  });

  it('rejects a Salesforce User Id linked to another user', async () => {
    const { post, me } = await setup();
    await users.update(me.id, { sfUserId: '005000000000001AAA' });
    const res = await post('/users', { ...newUser, sfUserId: '005000000000001AAA' });
    expect(res.status).toBe(409);
    expect(res.text).toContain('Salesforce User Id is already linked to another user.');
  });

  it('clears the link when the field is empty and logs the change', async () => {
    const { post, cap } = await setup();
    const bob = await users.create({ ...newUser, active: true, sfUserId: '005000000000001AAA' });
    const res = await post(`/users/${bob.id}`, { _method: 'PUT', email: bob.email, name: 'Bob', role: 'user', active: 'on', sfUserId: '' });
    expect(res.status).toBe(302);
    expect((await users.findById(bob.id)).sfUserId).toBeNull();
    expect(cap.lines().find((l) => l.msg === 'users.sf_link_changed')).toMatchObject({
      targetUserId: bob.id,
      from: '005000000000001AAA',
      to: null,
    });
  });

  it('prevents an admin from deactivating themselves', async () => {
    const { post, me } = await setup();
    await users.create({ ...newUser, email: 'other-admin@example.com', role: 'admin', active: true });
    const res = await post(`/users/${me.id}`, { _method: 'PUT', email: me.email, name: me.name, role: 'admin' });
    expect(res.status).toBe(409);
    expect((await users.findById(me.id)).active).toBe(true);
  });

  it('prevents an admin from deleting themselves', async () => {
    const { post, me } = await setup();
    expect((await post(`/users/${me.id}`, { _method: 'DELETE' })).status).toBe(409);
  });

  it('keeps at least one active admin when two admins demote each other concurrently', async () => {
    const { agent, me } = await setup();
    const other = await users.create({ ...newUser, email: 'second@example.com', role: 'admin', active: true });
    const app2 = createApp({ pool, config: testConfig, logger: captureLogger(testConfig).logger });
    const agent2 = await loginAs(app2, other, 'another long password');
    const csrf1 = extractCsrf((await agent.get('/users')).text);
    const csrf2 = extractCsrf((await agent2.get('/users')).text);
    const demote = (ag, csrf, target) => ag.post(`/users/${target.id}`).type('form')
      .send({ _csrf: csrf, _method: 'PUT', email: target.email, name: target.name, role: 'user', active: 'on' });
    const statuses = (await Promise.all([demote(agent, csrf1, other), demote(agent2, csrf2, me)])).map((r) => r.status);
    expect(statuses.filter((s) => s === 302)).toHaveLength(1);
    expect(await users.countActiveAdmins()).toBe(1);
  });

  it('records password changes in the audit log without the value', async () => {
    const { post, cap } = await setup();
    const bob = await users.create({ ...newUser, active: true });
    await post(`/users/${bob.id}`, { _method: 'PUT', email: bob.email, name: 'Bob', role: 'user', active: 'on', password: 'brand new password 1' });
    const line = cap.lines().find((l) => l.msg === 'users.updated');
    expect(line.changes).toContain('password');
    expect(cap.raw()).not.toContain('brand new password 1');
  });

  it('unlocks a locked user', async () => {
    const { post } = await setup();
    const bob = await users.create({ ...newUser, active: true });
    for (let i = 0; i < 5; i++) await users.recordLoginFailure(bob.id);
    const res = await post(`/users/${bob.id}/unlock`, {});
    expect(res.status).toBe(302);
    expect((await users.findById(bob.id)).lockedUntil).toBeNull();
  });
});
