import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { usersRepo } from '../../src/users/users.repo.js';
import { getTestPool, resetDb, closePools, testConfig } from '../helpers/db.js';
import { sessionAs } from '../helpers/agent.js';
import { establishSession } from '../../src/auth/session.js';
import { captureLogger } from '../helpers/log-capture.js';

const pool = getTestPool();
const SF_USER_ID = '005000000000001AAA';
const users = usersRepo(pool);
beforeEach(resetDb);
afterAll(closePools);

const protectedRoute = (a) => a.get('/customers', (req, res) => res.send(`hello ${req.user.name}`));

function makeApp(config = testConfig) {
  const cap = captureLogger(config);
  const app = createApp({ pool, config, logger: cap.logger, extendProtected: protectedRoute });
  return { app, cap };
}

const createUser = (overrides = {}) =>
  users.create({ email: 'ana@example.com', name: 'Ana', password: 'correct horse battery', ...overrides });

describe('public area and auth guard', () => {
  it('serves the homepage without a session', async () => {
    const res = await request(makeApp().app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('renders the homepage in English with the app name', async () => {
    const res = await request(makeApp().app).get('/');
    expect(res.text).toContain('<html lang="en">');
    expect(res.text).toContain('CRUD App');
  });

  it('redirects anonymous GETs to login with next', async () => {
    const res = await request(makeApp().app).get('/customers');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login?next=%2Fcustomers');
  });

  it('redirects anonymous GETs to unknown paths to login (no route enumeration)', async () => {
    const res = await request(makeApp().app).get('/secret-admin');
    expect(res.status).toBe(302);
  });

  it('returns 401 for anonymous non-GET requests', async () => {
    const res = await request(makeApp().app).post('/customers').type('form').send({ name: 'x' });
    expect(res.status).toBe(401);
  });

  it('lets an authenticated user through', async () => {
    const { app } = makeApp();
    const agent = await sessionAs(app, pool, await createUser());
    const res = await agent.get('/customers');
    expect(res.status).toBe(200);
    expect(res.text).toBe('hello Ana');
  });

  it('sets frame-ancestors to the exact trusted origins', async () => {
    const res = await request(makeApp().app).get('/');
    const directive = res.headers['content-security-policy'].split(';').map((d) => d.trim())
      .find((d) => d.startsWith('frame-ancestors'));
    expect(directive).toBe("frame-ancestors 'self' https://example.my.salesforce.com https://example--c.vf.force.com");
    expect(res.headers['content-security-policy']).not.toContain('*');
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toMatch(/max-age=31536000/);
  });

  it('issues a Secure, HttpOnly, SameSite=None, Partitioned session cookie', async () => {
    const config = { ...testConfig, cookieSecure: true, trustProxy: 1 };
    const user = await createUser();
    const app = createApp({
      pool,
      config,
      logger: captureLogger(config).logger,
      extend: (a) => a.get('/auth/test-login', async (req, res) => {
        await establishSession(req, user, { method: 'local' });
        res.send('ok');
      }),
    });
    const res = await request(app).get('/auth/test-login').set('X-Forwarded-Proto', 'https');
    const sid = res.headers['set-cookie'].find((c) => c.startsWith('sid='));
    expect(sid).toMatch(/; Secure/);
    expect(sid).toMatch(/; HttpOnly/);
    expect(sid).toMatch(/; SameSite=None/);
    expect(sid).toMatch(/; Partitioned/);
  });

  it('does not trust X-Forwarded-Proto unless a proxy is configured', async () => {
    const config = { ...testConfig, cookieSecure: true };
    const user = await createUser();
    const app = createApp({
      pool,
      config,
      logger: captureLogger(config).logger,
      extend: (a) => a.get('/auth/test-login', async (req, res) => {
        await establishSession(req, user, { method: 'local' });
        res.send('ok');
      }),
    });
    const res = await request(app).get('/auth/test-login').set('X-Forwarded-Proto', 'https');
    expect(res.headers['set-cookie']).toBeUndefined();
  }, 10000);

  it('regenerates the session id and stores auth data on establishSession', async () => {
    const user = await createUser();
    const app = createApp({
      pool,
      config: testConfig,
      logger: captureLogger(testConfig).logger,
      extend: (a) => a.get('/auth/test-login', async (req, res) => {
        await establishSession(req, user, { method: 'canvas', sfUserId: '005000000000001AAA' });
        res.send('ok');
      }),
    });
    await request(app).get('/auth/test-login');
    const { rows } = await pool.query('SELECT sess FROM session');
    expect(rows).toHaveLength(1);
    expect(rows[0].sess).toMatchObject({ userId: user.id, authMethod: 'canvas', sfUserId: '005000000000001AAA' });
    expect(rows[0].sess.cookie.originalMaxAge).toBe(15 * 60 * 1000);
    expect(typeof rows[0].sess.csrfToken).toBe('string');
  });

  it('revokes the session of a deactivated user', async () => {
    const { app, cap } = makeApp();
    const user = await createUser();
    const agent = await sessionAs(app, pool, user);
    await users.update(user.id, { active: false });
    const res = await agent.get('/customers');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/auth\/login/);
    expect(cap.lines().find((l) => l.msg === 'auth.session.revoked')).toMatchObject({ reason: 'inactive' });
    const { rows } = await pool.query('SELECT sid, sess FROM session');
    expect(rows.filter((r) => r.sess.userId)).toHaveLength(0);
  });

  it('revokes the session of a locked user', async () => {
    const { app } = makeApp();
    const user = await createUser();
    const agent = await sessionAs(app, pool, user);
    await pool.query("UPDATE users SET locked_until = now() + interval '10 minutes' WHERE id = $1", [user.id]);
    expect((await agent.get('/customers')).status).toBe(302);
  });

  it('expires canvas sessions 15 minutes after authentication', async () => {
    const { app, cap } = makeApp();
    const agent = await sessionAs(app, pool, await createUser(), {
      method: 'canvas',
      authAt: Date.now() - 16 * 60 * 1000,
    });
    const res = await agent.get('/customers');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login?notice=session_expired&embedded=1');
    expect(cap.lines().some((l) => l.msg === 'auth.session.canvas_expired')).toBe(true);
  });

  it('serves the login page to a client whose session was just revoked', async () => {
    const { app } = makeApp();
    const user = await createUser();
    const agent = await sessionAs(app, pool, user);
    await users.update(user.id, { active: false });
    const res = await agent.get('/auth/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="_csrf"');
  });

  it('serves the login page after a canvas session expired', async () => {
    const { app } = makeApp();
    const agent = await sessionAs(app, pool, await createUser(), { method: 'canvas', authAt: Date.now() - 16 * 60 * 1000 });
    expect((await agent.get('/auth/login?notice=session_expired&embedded=1')).status).toBe(200);
  });

  it('keeps fresh canvas sessions', async () => {
    const { app } = makeApp();
    const user = await createUser({ sfUserId: SF_USER_ID });
    const agent = await sessionAs(app, pool, user, { method: 'canvas', authAt: Date.now() - 14 * 60 * 1000, sfUserId: SF_USER_ID });
    expect((await agent.get('/customers')).status).toBe(200);
  });

  it('revokes a canvas session when the Salesforce link is cleared', async () => {
    const { app, cap } = makeApp();
    const user = await createUser({ sfUserId: SF_USER_ID });
    const agent = await sessionAs(app, pool, user, { method: 'canvas', sfUserId: SF_USER_ID });
    await users.update(user.id, { sfUserId: '' });
    expect((await agent.get('/customers')).status).toBe(302);
    expect(cap.lines().find((l) => l.msg === 'auth.session.revoked')).toMatchObject({ reason: 'sf_link_changed' });
  });

  it('revokes a canvas session when the Salesforce link moves to another Salesforce user', async () => {
    const { app } = makeApp();
    const user = await createUser({ sfUserId: SF_USER_ID });
    const agent = await sessionAs(app, pool, user, { method: 'canvas', sfUserId: SF_USER_ID });
    await users.update(user.id, { sfUserId: '005000000000002AAA' });
    expect((await agent.get('/customers')).status).toBe(302);
  });

  it('rejects POST without CSRF token from an authenticated user', async () => {
    const app = createApp({
      pool,
      config: testConfig,
      logger: captureLogger(testConfig).logger,
      extendProtected: (a) => a.post('/customers', (_req, res) => res.send('created')),
    });
    const agent = await sessionAs(app, pool, await createUser());
    const res = await agent.post('/customers').type('form').send({ name: 'x' });
    expect(res.status).toBe(403);
  });
});
