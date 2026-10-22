import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getTestPool, testConfig, closePools } from './helpers/db.js';
import { captureLogger } from './helpers/log-capture.js';

afterAll(closePools);

function setup() {
  const cap = captureLogger(testConfig);
  const app = createApp({ pool: getTestPool(), config: testConfig, logger: cap.logger });
  return { cap, app };
}

const requestLine = (cap) => cap.lines().find((l) => l.req);

describe('http logger', () => {
  it('redacts the cookie header', async () => {
    const { cap, app } = setup();
    await request(app).get('/auth/nope').set('Cookie', 'sid=abc');
    expect(requestLine(cap).req.headers.cookie).toBe('[Redacted]');
    expect(cap.raw()).not.toContain('sid=abc');
  });

  it('logs 404 at warn level', async () => {
    const { cap, app } = setup();
    await request(app).get('/auth/nope');
    const line = requestLine(cap);
    expect(line.res.statusCode).toBe(404);
    expect(line.level).toBe(40);
  });

  it('echoes a valid x-request-id', async () => {
    const { cap, app } = setup();
    const res = await request(app).get('/auth/nope').set('x-request-id', 't-1');
    expect(res.headers['x-request-id']).toBe('t-1');
    expect(requestLine(cap).req.id).toBe('t-1');
  });

  it('replaces an oversized x-request-id with a uuid', async () => {
    const { app } = setup();
    const res = await request(app).get('/auth/nope').set('x-request-id', 'a'.repeat(200));
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not log the query string', async () => {
    const { cap, app } = setup();
    await request(app).get('/auth/nope?token=leak-me');
    expect(cap.raw()).not.toContain('leak-me');
  });
});
