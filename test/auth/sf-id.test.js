import { describe, it, expect } from 'vitest';
import { toId18, InvalidSalesforceIdError } from '../../src/auth/sf-id.js';

describe('toId18', () => {
  it('appends the checksum suffix to a 15-char id', () => {
    expect(toId18('005000000000001')).toBe('005000000000001AAA');
  });

  it('computes case-sensitive suffix bits', () => {
    // Uppercase at positions 0..4 of the first chunk → bits 0b11111 = 31 → '5'
    expect(toId18('ABCDE0000000000')).toBe('ABCDE00000000005AA');
  });

  it('accepts a valid 18-char id unchanged', () => {
    expect(toId18('005000000000001AAA')).toBe('005000000000001AAA');
  });

  it('rejects an 18-char id with a wrong suffix', () => {
    expect(() => toId18('005000000000001AAB')).toThrow(InvalidSalesforceIdError);
  });

  it.each(['0050000000000010', '', '00500000000000!', 42, null])('rejects %s', (value) => {
    expect(() => toId18(value)).toThrow(InvalidSalesforceIdError);
  });
});
