import { describe, it, expect } from 'vitest';
import {
  fetchSalesforceTokenInfo,
  SalesforceTokenRejectedError,
  SalesforceUnavailableError,
} from '../../src/auth/sf-token.js';

const MY_DOMAIN = 'https://example.my.salesforce.com';
const base = { myDomainUrl: MY_DOMAIN, accessToken: 'tok', clientId: 'consumer-key', clientSecret: 'consumer-secret' };
const jsonResponse = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

const activeBody = {
  active: true,
  client_id: 'consumer-key',
  sub: 'https://login.salesforce.com/id/00D000000000001EAA/005000000000001AAA',
  username: 'ana@example.com',
  exp: 1900000000,
};

describe('fetchSalesforceTokenInfo', () => {
  it('introspects the token with the app credentials and maps the response', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, activeBody);
    };
    const info = await fetchSalesforceTokenInfo({ ...base, fetchImpl });
    expect(info).toEqual({ clientId: 'consumer-key', orgId: '00D000000000001EAA', userId: '005000000000001AAA' });
    expect(calls[0].url).toBe(`${MY_DOMAIN}/services/oauth2/introspect`);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.redirect).toBe('error');
    const body = new URLSearchParams(calls[0].init.body);
    expect(Object.fromEntries(body)).toEqual({
      token: 'tok',
      token_type_hint: 'access_token',
      client_id: 'consumer-key',
      client_secret: 'consumer-secret',
    });
  });

  it('rejects an inactive token', async () => {
    const fetchImpl = async () => jsonResponse(200, { active: false });
    await expect(fetchSalesforceTokenInfo({ ...base, fetchImpl })).rejects.toBeInstanceOf(SalesforceTokenRejectedError);
  });

  it('rejects a missing token without calling Salesforce', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return jsonResponse(200, activeBody); };
    await expect(fetchSalesforceTokenInfo({ ...base, accessToken: undefined, fetchImpl }))
      .rejects.toBeInstanceOf(SalesforceTokenRejectedError);
    expect(called).toBe(false);
  });

  it.each([401, 302, 500])('maps HTTP %s (bad app credentials or outage) to SalesforceUnavailableError', async (status) => {
    const fetchImpl = async () => jsonResponse(status, {});
    await expect(fetchSalesforceTokenInfo({ ...base, fetchImpl })).rejects.toBeInstanceOf(SalesforceUnavailableError);
  });

  it('exposes the HTTP status and OAuth error code (never the description) as detail', async () => {
    const fetchImpl = async () => jsonResponse(401, { error: 'invalid_client', error_description: 'secret-ish text' });
    const err = await fetchSalesforceTokenInfo({ ...base, fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(SalesforceUnavailableError);
    expect(err.detail).toBe('status 401 invalid_client');
  });

  it('keeps a generic detail for network errors', async () => {
    const fetchImpl = async () => { throw new TypeError('fetch failed'); };
    const err = await fetchSalesforceTokenInfo({ ...base, fetchImpl }).catch((e) => e);
    expect(err.detail).toBe('network TypeError');
  });

  it('maps network errors to SalesforceUnavailableError', async () => {
    const fetchImpl = async () => { throw new TypeError('fetch failed'); };
    await expect(fetchSalesforceTokenInfo({ ...base, fetchImpl })).rejects.toBeInstanceOf(SalesforceUnavailableError);
  });

  it('times out a hanging request', async () => {
    const fetchImpl = (_url, { signal }) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    await expect(fetchSalesforceTokenInfo({ ...base, fetchImpl, timeoutMs: 50 }))
      .rejects.toBeInstanceOf(SalesforceUnavailableError);
  });

  it('treats an active response without a parsable sub as unavailable', async () => {
    const fetchImpl = async () => jsonResponse(200, { ...activeBody, sub: 'weird' });
    await expect(fetchSalesforceTokenInfo({ ...base, fetchImpl })).rejects.toBeInstanceOf(SalesforceUnavailableError);
  });
});
