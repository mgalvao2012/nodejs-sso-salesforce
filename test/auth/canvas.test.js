import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { usersRepo } from '../../src/users/users.repo.js';
import { verifySignedRequest } from '../../src/auth/canvas.routes.js';
import { SalesforceTokenRejectedError, SalesforceUnavailableError } from '../../src/auth/sf-token.js';
import { getTestPool, resetDb, closePools, testConfig } from '../helpers/db.js';
import { signCanvasRequest, canvasPayload } from '../helpers/signed-request.js';
import { captureLogger } from '../helpers/log-capture.js';

const pool = getTestPool();
const users = usersRepo(pool);
beforeEach(resetDb);
afterAll(closePools);

const SECRET = testConfig.sfCanvasConsumerSecret;
const ORIGIN = 'https://example--c.vf.force.com';
const SF_USER_ID = '005000000000001AAA';
const ORG_ID = testConfig.sfAllowedOrgId;
const TOKEN = 'live-oauth-token-value';

const okTokenInfo = (overrides = {}) => ({
  clientId: testConfig.sfCanvasConsumerKey,
  userId: SF_USER_ID,
  orgId: ORG_ID,
  ...overrides,
});

function makeApp({ tokenInfo = async () => okTokenInfo() } = {}) {
  const cap = captureLogger(testConfig);
  const calls = [];
  const sfTokenInfo = async (args) => {
    calls.push(args);
    return tokenInfo(args);
  };
  const app = createApp({ pool, config: testConfig, logger: cap.logger, sfTokenInfo });
  return { app, cap, calls };
}

const linkedUser = (overrides = {}) =>
  users.create({ email: 'ana@example.com', name: 'Ana', password: 'correct horse battery', sfUserId: SF_USER_ID, ...overrides });

const post = (target, signedRequest, { origin = ORIGIN, referer } = {}) => {
  const req = target.post('/auth/canvas').type('form');
  if (origin) req.set('Origin', origin);
  if (referer) req.set('Referer', referer);
  return req.send({ signed_request: signedRequest });
};

const signed = (opts) => signCanvasRequest(canvasPayload(opts), SECRET);

const sessionCount = async () => (await pool.query('SELECT count(*)::int AS n FROM session')).rows[0].n;

describe('verifySignedRequest', () => {
  it('returns the decoded payload for a valid signature', () => {
    expect(verifySignedRequest(signed(), SECRET).context.user.userId).toBe(SF_USER_ID);
  });

  it.each([
    ['wrong secret', () => signCanvasRequest(canvasPayload(), 'other-secret')],
    ['no dot', () => 'abcdef'],
    ['three parts', () => `${signed()}.extra`],
    ['non-JSON payload', () => {
      const encoded = Buffer.from('not json').toString('base64');
      const sig = signCanvasRequest(canvasPayload(), SECRET).split('.')[0];
      return `${sig}.${encoded}`;
    }],
    ['algorithm NONE', () => signed({ algorithm: 'NONE' })],
    ['non-string', () => ['a', 'b']],
  ])('rejects %s', (_name, make) => {
    expect(() => verifySignedRequest(make(), SECRET)).toThrow();
  });

  it('rejects a non-canonical base64 signature', () => {
    const [sig, payload] = signed().split('.');
    expect(() => verifySignedRequest(`${sig.replace(/=+$/, '')}.${payload}`, SECRET)).toThrow();
    expect(() => verifySignedRequest(`${sig}==.${payload}`, SECRET)).toThrow();
  });

  it('ignores issuedAt, which Salesforce sends as a fixed legacy value', () => {
    // Real value observed on a live org (= 2021-01-24, unrelated to the request time).
    expect(() => verifySignedRequest(signed({ issuedAt: 1611462072 }), SECRET)).not.toThrow();
  });
});

describe('POST /auth/canvas', () => {
  it('authenticates a linked user with the SSO permission', async () => {
    const { app, calls } = makeApp();
    await linkedUser();
    const agent = request.agent(app);
    const res = await post(agent, signed());
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/customers');
    expect(calls[0]).toEqual({
      myDomainUrl: testConfig.sfMyDomainUrl,
      accessToken: TOKEN,
      clientId: testConfig.sfCanvasConsumerKey,
      clientSecret: testConfig.sfCanvasConsumerSecret,
    });
    const page = await agent.get('/customers');
    expect(page.status).toBe(200);
    expect(page.text).not.toContain('class="top"');
  });

  it('rejects a replayed signed request', async () => {
    const { app } = makeApp();
    await linkedUser();
    const sr = signed();
    expect((await post(request(app), sr)).status).toBe(303);
    const replay = await post(request(app), sr);
    expect(replay.status).toBe(401);
    expect(await sessionCount()).toBe(1);
  });

  it.each([
    ['added padding', (sig) => `${sig}=`],
    ['stripped padding', (sig) => sig.replace(/=+$/, '')],
    ['trailing whitespace', (sig) => `${sig} `],
    ['base64url alphabet', (sig) => sig.replace(/\+/g, '-').replace(/\//g, '_')],
  ])('rejects a replay with a re-encoded signature (%s)', async (_name, mutate) => {
    const { app } = makeApp();
    await linkedUser();
    let sr;
    do { sr = signed({ email: `ana+${Math.random()}@example.com` }); } while (!/[+/]/.test(sr.split('.')[0]));
    expect((await post(request(app), sr)).status).toBe(303);
    const [sig, payload] = sr.split('.');
    const variant = `${mutate(sig)}.${payload}`;
    expect(variant).not.toBe(sr);
    expect((await post(request(app), variant)).status).toBe(401);
    expect(await sessionCount()).toBe(1);
  });

  it('rejects a forged payload whose token Salesforce rejects', async () => {
    const { app, cap } = makeApp({ tokenInfo: async () => { throw new SalesforceTokenRejectedError(); } });
    await linkedUser();
    const res = await post(request(app), signed());
    expect(res.status).toBe(401);
    expect(await sessionCount()).toBe(0);
    expect(cap.lines().find((l) => l.msg === 'auth.canvas.rejected')).toMatchObject({ reason: 'token_rejected' });
  });

  it('rejects a token that belongs to another user', async () => {
    const { app, cap } = makeApp({ tokenInfo: async () => okTokenInfo({ userId: '005000000000002AAA' }) });
    await linkedUser();
    expect((await post(request(app), signed())).status).toBe(401);
    expect(cap.lines().find((l) => l.msg === 'auth.canvas.rejected')).toMatchObject({ reason: 'identity_mismatch' });
  });

  it('rejects a token from another org', async () => {
    const { app } = makeApp({ tokenInfo: async () => okTokenInfo({ orgId: '00D000000000002EAA' }) });
    await linkedUser();
    expect((await post(request(app), signed())).status).toBe(401);
  });

  it('ignores client.instanceUrl from the payload', async () => {
    const { app, calls } = makeApp();
    await linkedUser();
    await post(request(app), signed({ instanceUrl: 'https://evil.com' }));
    expect(calls[0].myDomainUrl).toBe(testConfig.sfMyDomainUrl);
    expect(JSON.stringify(calls[0])).not.toContain('evil.com');
  });

  it('rejects a live token issued to another app', async () => {
    const { app, cap } = makeApp({ tokenInfo: async () => okTokenInfo({ clientId: 'sf-cli-consumer-key' }) });
    await linkedUser();
    const res = await post(request(app), signed());
    expect(res.status).toBe(401);
    expect(await sessionCount()).toBe(0);
    expect(cap.lines().find((l) => l.msg === 'auth.canvas.rejected')).toMatchObject({ reason: 'wrong_client' });
  });

  it('stores the Salesforce user id in the canvas session', async () => {
    const { app } = makeApp();
    await linkedUser();
    await post(request(app), signed());
    const { rows } = await pool.query('SELECT sess FROM session');
    expect(rows[0].sess).toMatchObject({ authMethod: 'canvas', sfUserId: SF_USER_ID });
  });

  it('does not link by email', async () => {
    const { app } = makeApp();
    await linkedUser({ sfUserId: null }); // same email as the Salesforce user
    const res = await post(request(app), signed());
    expect(res.headers.location).toBe('/auth/login?notice=not_provisioned&embedded=1');
  });

  it('sends inactive users to the login form', async () => {
    const { app } = makeApp();
    await linkedUser({ active: false });
    expect((await post(request(app), signed())).headers.location).toBe('/auth/login?notice=inactive&embedded=1');
  });

  it.each([
    ['missing Origin', { origin: null }],
    ['untrusted Origin', { origin: 'https://evil.com' }],
    ['null Origin', { origin: 'null' }],
  ])('rejects %s with 403', async (_name, opts) => {
    const { app, calls } = makeApp();
    await linkedUser();
    expect((await post(request(app), signed(), opts)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('accepts a trusted Referer when Origin is absent', async () => {
    const { app } = makeApp();
    await linkedUser();
    const res = await post(request(app), signed(), { origin: null, referer: `${ORIGIN}/apex/NodeCrudCanvas` });
    expect(res.status).toBe(303);
  });

  it.each([
    ['wrong secret', () => signCanvasRequest(canvasPayload(), 'other-secret')],
    ['no dot', () => 'garbage'],
    ['algorithm NONE', () => signed({ algorithm: 'NONE' })],
    ['another org in payload', () => signed({ orgId: '00D000000000002EAA' })],
  ])('rejects %s with 401 and no introspection call', async (_name, make) => {
    const { app, calls } = makeApp();
    await linkedUser();
    expect((await post(request(app), make())).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('rejects a missing signed_request with 401', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/auth/canvas').set('Origin', ORIGIN).type('form').send({});
    expect(res.status).toBe(401);
  });

  it('re-authenticates when the tab is reopened after the canvas session expired', async () => {
    const { app } = makeApp();
    const user = await linkedUser();
    const { sessionAs } = await import('../helpers/agent.js');
    const agent = await sessionAs(app, pool, user, { method: 'canvas', authAt: Date.now() - 16 * 60 * 1000 });
    const res = await post(agent, signed());
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/customers');
    expect((await agent.get('/customers')).status).toBe(200);
  });

  it('returns 502 when Salesforce is unavailable', async () => {
    const { app, cap } = makeApp({
      tokenInfo: async () => { throw Object.assign(new SalesforceUnavailableError(), { detail: 'status 401 invalid_client' }); },
    });
    await linkedUser();
    expect((await post(request(app), signed())).status).toBe(502);
    expect(cap.lines().find((l) => l.msg === 'auth.canvas.rejected')).toMatchObject({
      reason: 'token_introspection_unavailable',
      detail: 'status 401 invalid_client',
      level: 50,
    });
  });

  it('rejects bodies over 64kb with 413', async () => {
    const { app } = makeApp();
    const res = await post(request(app), 'x'.repeat(70 * 1024));
    expect(res.status).toBe(413);
  });

  it('never logs the signed request or the oauth token', async () => {
    const { app, cap } = makeApp({ tokenInfo: async () => okTokenInfo({ userId: '005000000000002AAA' }) });
    await linkedUser();
    const sr = signed();
    await post(request(app), sr);
    await post(request(app), signCanvasRequest(canvasPayload(), 'other-secret'));
    expect(cap.raw()).not.toContain(sr.split('.')[0]);
    expect(cap.raw()).not.toContain(TOKEN);
  });
});
