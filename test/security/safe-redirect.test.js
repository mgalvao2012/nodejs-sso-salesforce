import { describe, it, expect } from 'vitest';
import { safeRedirectPath } from '../../src/security/safe-redirect.js';

describe('safeRedirectPath', () => {
  it('keeps a relative path', () => {
    expect(safeRedirectPath('/customers/1')).toBe('/customers/1');
  });

  it('keeps a query string', () => {
    expect(safeRedirectPath('/customers?q=ana')).toBe('/customers?q=ana');
  });

  it.each([
    '//evil.com',
    '/\\evil.com',
    '/\\\\evil.com',
    '/foo\\bar',
    'https://evil.com',
    'javascript:x',
    '',
    undefined,
    null,
    ['/customers'],
    '/a b',
    `/${'a'.repeat(600)}`,
  ])('falls back for %s', (value) => {
    expect(safeRedirectPath(value)).toBe('/customers');
  });

  it('uses the given fallback', () => {
    expect(safeRedirectPath('//x', '/')).toBe('/');
  });
});
