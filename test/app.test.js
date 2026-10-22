import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getTestPool, testConfig, closePools } from './helpers/db.js';
import { captureLogger } from './helpers/log-capture.js';

afterAll(closePools);

describe('app', () => {
  it('GET /healthz returns ok without logging the request', async () => {
    const cap = captureLogger(testConfig);
    const app = createApp({ pool: getTestPool(), config: testConfig, logger: cap.logger });
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(cap.lines().filter((l) => l.req)).toHaveLength(0);
  });

  it('returns 500 without stack trace on unhandled errors', async () => {
    const cap = captureLogger(testConfig);
    const app = createApp({
      pool: getTestPool(),
      config: testConfig,
      logger: cap.logger,
      extend: (a) => a.get('/auth/boom', () => { throw new Error('kaboom-secret-detail'); }),
    });
    const res = await request(app).get('/auth/boom');
    expect(res.status).toBe(500);
    expect(res.text).not.toMatch(/kaboom-secret-detail|at .*\.js/);
    const errLine = cap.lines().find((l) => l.msg === 'unhandled_error');
    expect(errLine.level).toBe(50);
  });
});
