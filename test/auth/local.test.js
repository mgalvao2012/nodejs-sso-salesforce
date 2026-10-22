import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
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
const EMAIL = 'ana.secret@example.com';

function makeApp() {
  const cap = captureLogger(testConfig);
  const app = createApp({
    pool,
    config: testConfig,
    logger: cap.logger,
    extendProtected: (a) => a.get('/customers', (req, res) => res.send(`hello ${req.user.name}`)),
  });
  return { app, cap };
}

const createUser = (overrides = {}) => users.create({ email: EMAIL, name: 'Ana', password: PASSWORD, ...overrides });

async function attempt(agent, { email = EMAIL, password = PASSWORD, next } = {}) {
  const page = await agent.get('/auth/login');
  const body = { email, password, _csrf: extractCsrf(page.text) };
  if (next !== undefined) body.next = next;
  return agent.post('/auth/login').type('form').send(body);
}

describe('local login', () => {
  it('logs in with valid credentials', async () => {
    const { app } = makeApp();
    await createUser();
    const agent = request.agent(app);
    const res = await attempt(agent);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/customers');
    expect((await agent.get('/customers')).text).toBe('hello Ana');
  });

  it('accepts the email in a different case', async () => {
    const { app } = makeApp();
    await createUser();
    expect((await attempt(request.agent(app), { email: EMAIL.toUpperCase() })).status).toBe(302);
  });

  it('rejects a wrong password with the generic message', async () => {
    const { app, cap } = makeApp();
    await createUser();
    const res = await attempt(request.agent(app), { password: 'wrong password!!' });
    expect(res.status).toBe(401);
    expect(res.text).toContain('Invalid email or password');
    expect(cap.lines().find((l) => l.msg === 'auth.local.failed')).toMatchObject({ reason: 'bad_password' });
  });

  it('rejects an unknown user with the generic message', async () => {
    const { app, cap } = makeApp();
    const res = await attempt(request.agent(app), { email: 'nobody@example.com' });
    expect(res.status).toBe(401);
    expect(res.text).toContain('Invalid email or password');
    expect(cap.lines().find((l) => l.msg === 'auth.local.failed')).toMatchObject({ reason: 'unknown_user' });
  });

  it('rejects an inactive user with the generic message', async () => {
    const { app } = makeApp();
    await createUser({ active: false });
    const res = await attempt(request.agent(app));
    expect(res.status).toBe(401);
    expect(res.text).toContain('Invalid email or password');
  });

  it('locks the account after 5 failures, even for the right password', async () => {
    const { app, cap } = makeApp();
    const user = await createUser();
    const agent = request.agent(app);
    for (let i = 0; i < 5; i++) await attempt(agent, { password: 'wrong password!!' });
    expect(cap.lines().some((l) => l.msg === 'auth.local.locked' && l.userId === user.id)).toBe(true);

    const res = await attempt(agent);
    expect(res.status).toBe(401);
    expect(res.text).toContain('Invalid email or password');
    expect(cap.lines().filter((l) => l.msg === 'auth.local.failed').at(-1)).toMatchObject({ reason: 'locked' });

    await users.unlock(user.id);
    expect((await attempt(agent)).status).toBe(302);
  });

  it('resets the failure counter on success', async () => {
    const { app } = makeApp();
    const user = await createUser();
    const agent = request.agent(app);
    for (let i = 0; i < 3; i++) await attempt(agent, { password: 'wrong password!!' });
    await attempt(agent);
    expect((await users.findById(user.id)).failedLoginCount).toBe(0);
  });

  it('ignores unsafe next values', async () => {
    const { app } = makeApp();
    await createUser();
    const res = await attempt(request.agent(app), { next: '/\\evil.com' });
    expect(res.headers.location).toBe('/customers');
  });

  it('honours a safe next value', async () => {
    const { app } = makeApp();
    await createUser();
    const res = await attempt(request.agent(app), { next: '/customers?q=1' });
    expect(res.headers.location).toBe('/customers?q=1');
  });

  it('rotates the session id and CSRF token on login', async () => {
    const { app } = makeApp();
    await createUser();
    const agent = request.agent(app);
    const page = await agent.get('/auth/login');
    const before = page.headers['set-cookie'].find((c) => c.startsWith('sid=')).split(';')[0];
    const oldToken = extractCsrf(page.text);
    const res = await agent.post('/auth/login').type('form').send({ email: EMAIL, password: PASSWORD, _csrf: oldToken });
    const after = res.headers['set-cookie'].find((c) => c.startsWith('sid=')).split(';')[0];
    expect(after).not.toBe(before);
    const reuse = await agent.post('/auth/logout').type('form').send({ _csrf: oldToken });
    expect(reuse.status).toBe(403);
  });

  it('rejects login POST without CSRF token', async () => {
    const { app } = makeApp();
    await createUser();
    const res = await request(app).post('/auth/login').type('form').send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('shows the exact notice text', async () => {
    const res = await request(makeApp().app).get('/auth/login?notice=not_provisioned');
    expect(res.text).toContain(
      'Your Salesforce user is not linked to this application. Sign in with email and password, or ask an administrator to link your account.',
    );
  });

  it('ignores unknown notice values', async () => {
    const res = await request(makeApp().app).get('/auth/login?notice=%3Cscript%3E');
    expect(res.text).not.toContain('<script>');
    expect(res.text).not.toContain('class="notice"');
  });

  it('hides the header when embedded', async () => {
    const res = await request(makeApp().app).get('/auth/login?embedded=1');
    expect(res.text).not.toContain('class="top"');
  });

  it('logs out', async () => {
    const { app, cap } = makeApp();
    const user = await createUser();
    const agent = await loginAs(app, user, PASSWORD);
    const page = await agent.get('/');
    const res = await agent.post('/auth/logout').type('form').send({ _csrf: extractCsrf(page.text) });
    expect(res.status).toBe(302);
    expect(cap.lines().some((l) => l.msg === 'auth.logout')).toBe(true);
    expect((await agent.get('/customers')).status).toBe(302);
  });

  it('rate limits login attempts per IP', async () => {
    const { app, cap } = makeApp();
    const agent = request.agent(app);
    let last;
    for (let i = 0; i < 11; i++) last = await attempt(agent, { email: `x${i}@example.com` });
    expect(last.status).toBe(429);
    expect(cap.lines().some((l) => l.msg === 'auth.local.rate_limited')).toBe(true);
  });

  it('does not let X-Forwarded-For bypass the rate limit without a trusted proxy', async () => {
    const { app } = makeApp();
    const agent = request.agent(app);
    let last;
    for (let i = 0; i < 11; i++) {
      const page = await agent.get('/auth/login');
      last = await agent.post('/auth/login').set('X-Forwarded-For', `10.0.0.${i}`).type('form')
        .send({ email: `x${i}@example.com`, password: 'whatever', _csrf: extractCsrf(page.text) });
    }
    expect(last.status).toBe(429);
  });

  it('never logs the submitted password or email', async () => {
    const { app, cap } = makeApp();
    await createUser();
    const agent = request.agent(app);
    await attempt(agent, { password: 'wrong password!!' });
    await attempt(agent);
    expect(cap.raw()).not.toContain('wrong password!!');
    expect(cap.raw()).not.toContain(PASSWORD);
    expect(cap.raw()).not.toContain(EMAIL);
  });
});
