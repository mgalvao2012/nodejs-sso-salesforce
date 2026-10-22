import { randomUUID } from 'node:crypto';
import request from 'supertest';
import signature from 'cookie-signature';
import { testConfig } from './db.js';

// Creates a session row directly in the store and returns an agent carrying its cookie.
export async function sessionAs(app, pool, user, { method = 'local', authAt = Date.now(), sfUserId, config = testConfig } = {}) {
  const sid = randomUUID();
  const maxAge = 8 * 60 * 60 * 1000;
  const expires = new Date(Date.now() + maxAge);
  const sess = {
    cookie: { originalMaxAge: maxAge, expires: expires.toISOString(), httpOnly: true, path: '/', sameSite: 'none' },
    userId: user.id,
    authMethod: method,
    authAt,
    ...(sfUserId ? { sfUserId } : {}),
  };
  await pool.query('INSERT INTO session (sid, sess, expire) VALUES ($1, $2, $3)', [sid, sess, expires]);
  const cookie = `sid=${encodeURIComponent(`s:${signature.sign(sid, config.sessionSecret)}`)}`;
  return request.agent(app).set('Cookie', cookie);
}

export function extractCsrf(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) throw new Error('CSRF token not found in page');
  return match[1];
}

// Performs a real login through the form (GET for the CSRF token, then POST).
export async function loginAs(app, user, password) {
  const agent = request.agent(app);
  const page = await agent.get('/auth/login');
  const res = await agent
    .post('/auth/login')
    .type('form')
    .send({ email: user.email, password, _csrf: extractCsrf(page.text) });
  if (res.status !== 302) throw new Error(`login failed with status ${res.status}`);
  return agent;
}
