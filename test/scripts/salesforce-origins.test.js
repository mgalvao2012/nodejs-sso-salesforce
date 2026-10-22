import { describe, it, expect } from 'vitest';
import { deriveTrustedOrigins } from '../../scripts/salesforce-origins.js';

describe('deriveTrustedOrigins', () => {
  it.each([
    [
      'https://acme.my.salesforce.com',
      ['https://acme.my.salesforce.com', 'https://acme.lightning.force.com', 'https://acme--c.vf.force.com'],
    ],
    [
      'https://acme--uat.sandbox.my.salesforce.com',
      [
        'https://acme--uat.sandbox.my.salesforce.com',
        'https://acme--uat.sandbox.lightning.force.com',
        'https://acme--uat--c.sandbox.vf.force.com',
      ],
    ],
    [
      'https://acme-dev-ed.develop.my.salesforce.com',
      [
        'https://acme-dev-ed.develop.my.salesforce.com',
        'https://acme-dev-ed.develop.lightning.force.com',
        'https://acme-dev-ed--c.develop.vf.force.com',
      ],
    ],
    [
      'https://ability-fun-1234.scratch.my.salesforce.com',
      [
        'https://ability-fun-1234.scratch.my.salesforce.com',
        'https://ability-fun-1234.scratch.lightning.force.com',
        'https://ability-fun-1234--c.scratch.vf.force.com',
      ],
    ],
  ])('derives the Lightning and Visualforce origins of %s', (myDomain, expected) => {
    expect(deriveTrustedOrigins(myDomain)).toEqual(expected);
  });

  it('ignores a trailing slash or path', () => {
    expect(deriveTrustedOrigins('https://acme.my.salesforce.com/')[0]).toBe('https://acme.my.salesforce.com');
  });

  it.each(['https://login.salesforce.com', 'https://acme.example.com', 'http://acme.my.salesforce.com', 'nope'])(
    'rejects %s (not a My Domain URL)',
    (url) => {
      expect(() => deriveTrustedOrigins(url)).toThrow(/My Domain/);
    },
  );
});
