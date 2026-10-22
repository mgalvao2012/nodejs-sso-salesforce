import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { testEnv } from './helpers/db.js';

describe('loadConfig', () => {
  it('rejects missing DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects SESSION_SECRET shorter than 32 chars', () => {
    expect(() => loadConfig({ ...testEnv, SESSION_SECRET: 'x'.repeat(31) })).toThrow(/SESSION_SECRET/);
  });

  it.each([
    'https://*.vf.force.com',
    'http://x.com',
    'https://x.com/path',
    'x.com',
  ])('rejects invalid trusted origin %s', (origin) => {
    expect(() => loadConfig({ ...testEnv, SF_TRUSTED_ORIGINS: origin })).toThrow(/SF_TRUSTED_ORIGINS/);
  });

  it('parses trusted origins into an array', () => {
    const config = loadConfig({ ...testEnv, SF_TRUSTED_ORIGINS: 'https://a.example.com  https://b.example.com' });
    expect(config.sfTrustedOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('disables secure cookies only in test env', () => {
    expect(loadConfig(testEnv).cookieSecure).toBe(false);
    expect(loadConfig({ ...testEnv, NODE_ENV: 'production' }).cookieSecure).toBe(true);
  });
});

describe('loadConfig org id', () => {
  it('rejects an org id with an invalid checksum', () => {
    expect(() => loadConfig({ ...testEnv, SF_ALLOWED_ORG_ID: '00D000000000001AAA' })).toThrow(/SF_ALLOWED_ORG_ID/);
  });

  it('normalises a 15-char org id to 18 chars', () => {
    expect(loadConfig({ ...testEnv, SF_ALLOWED_ORG_ID: '00D000000000001' }).sfAllowedOrgId).toBe('00D000000000001EAA');
  });
});

describe('loadConfig trust proxy', () => {
  it('defaults to not trusting proxies', () => {
    expect(loadConfig(testEnv).trustProxy).toBe(0);
  });

  it('parses TRUST_PROXY hop count', () => {
    expect(loadConfig({ ...testEnv, TRUST_PROXY: '1' }).trustProxy).toBe(1);
  });
});

describe('loadConfig consumer key', () => {
  it('requires SF_CANVAS_CONSUMER_KEY', () => {
    const { SF_CANVAS_CONSUMER_KEY: _omit, ...env } = testEnv;
    expect(() => loadConfig(env)).toThrow(/SF_CANVAS_CONSUMER_KEY/);
  });
});
