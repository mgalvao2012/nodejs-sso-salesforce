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

async function setup() {
  const cap = captureLogger(testConfig);
  const app = createApp({ pool, config: testConfig, logger: cap.logger });
  const user = await users.create({ email: 'ana@example.com', name: 'Ana', password: PASSWORD });
  const agent = await loginAs(app, user, PASSWORD);
  const csrf = async () => extractCsrf((await agent.get('/customers/new')).text);
  const createCustomer = async (data) => {
    const token = await csrf();
    return agent.post('/customers').type('form').send({ _csrf: token, ...data });
  };
  return { app, agent, cap, user, csrf, createCustomer };
}

const customerIds = async () => (await pool.query('SELECT id, document FROM customers ORDER BY created_at')).rows;

describe('customers CRUD', () => {
  it('creates a customer and lists it', async () => {
    const { agent, createCustomer, user } = await setup();
    const res = await createCustomer({ name: 'Acme Ltda', document: '12.345.678/0001-95', email: 'acme@example.com' });
    expect(res.status).toBe(302);
    const index = await agent.get('/customers');
    expect(index.status).toBe(200);
    expect(index.text).toContain('Acme Ltda');
    const { rows } = await pool.query('SELECT document, created_by FROM customers');
    expect(rows[0]).toEqual({ document: '12345678000195', created_by: user.id });
  });

  it('normalises CPF punctuation', async () => {
    const { createCustomer } = await setup();
    await createCustomer({ name: 'João', document: '123.456.789-09' });
    expect((await customerIds())[0].document).toBe('12345678909');
  });

  it('rejects a duplicate document with 409', async () => {
    const { createCustomer } = await setup();
    await createCustomer({ name: 'A', document: '12345678909' });
    const res = await createCustomer({ name: 'B', document: '123.456.789-09' });
    expect(res.status).toBe(409);
    expect(res.text).toContain('Document already registered.');
  });

  it('rejects a document with 12 digits with 422', async () => {
    const { createCustomer } = await setup();
    const res = await createCustomer({ name: 'A', document: '123456789012' });
    expect(res.status).toBe(422);
    expect(await customerIds()).toHaveLength(0);
  });

  it('rejects an invalid email with 422', async () => {
    const { createCustomer } = await setup();
    expect((await createCustomer({ name: 'A', document: '12345678909', email: 'nope' })).status).toBe(422);
  });

  it('updates a customer', async () => {
    const { agent, createCustomer, csrf } = await setup();
    await createCustomer({ name: 'A', document: '12345678909' });
    const [{ id }] = await customerIds();
    const token = await csrf();
    const res = await agent.post(`/customers/${id}`).type('form')
      .send({ _csrf: token, _method: 'PUT', name: 'A2', document: '12345678909', phone: '+55 11 99999-0000' });
    expect(res.status).toBe(302);
    const show = await agent.get(`/customers/${id}`);
    expect(show.text).toContain('A2');
    expect(show.text).toContain('+55 11 99999-0000');
  });

  it('deletes a customer', async () => {
    const { agent, createCustomer, csrf, cap } = await setup();
    await createCustomer({ name: 'A', document: '12345678909' });
    const [{ id }] = await customerIds();
    const token = await csrf();
    const res = await agent.post(`/customers/${id}`).type('form').send({ _csrf: token, _method: 'DELETE' });
    expect(res.status).toBe(302);
    expect(await customerIds()).toHaveLength(0);
    expect(cap.lines().some((l) => l.msg === 'customers.deleted' && l.customerId === id)).toBe(true);
  });

  it('rejects delete without CSRF token', async () => {
    const { agent, createCustomer } = await setup();
    await createCustomer({ name: 'A', document: '12345678909' });
    const [{ id }] = await customerIds();
    const res = await agent.post(`/customers/${id}`).type('form').send({ _method: 'DELETE' });
    expect(res.status).toBe(403);
    expect(await customerIds()).toHaveLength(1);
  });

  it('escapes HTML in customer fields', async () => {
    const { agent, createCustomer } = await setup();
    await createCustomer({ name: '<script>alert(1)</script>', document: '12345678909' });
    const index = await agent.get('/customers');
    expect(index.text).toContain('&lt;script&gt;');
    expect(index.text).not.toContain('<script>alert');
  });

  it('treats LIKE wildcards in search as literals', async () => {
    const { agent, createCustomer } = await setup();
    await createCustomer({ name: 'Acme', document: '12345678909' });
    await createCustomer({ name: 'Beta 100%', document: '98765432100' });
    const res = await agent.get('/customers?q=%25');
    expect(res.text).toContain('Beta 100%');
    expect(res.text).not.toContain('Acme');
  });

  it('returns 404 for unknown or malformed ids', async () => {
    const { agent } = await setup();
    expect((await agent.get('/customers/00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await agent.get('/customers/not-a-uuid')).status).toBe(404);
  });
});
