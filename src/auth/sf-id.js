export class InvalidSalesforceIdError extends Error {
  constructor() {
    super('Invalid Salesforce Id');
    this.name = 'InvalidSalesforceIdError';
  }
}

const SUFFIX_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

function checksumSuffix(id15) {
  let suffix = '';
  for (let chunk = 0; chunk < 3; chunk++) {
    let bits = 0;
    for (let i = 0; i < 5; i++) {
      const ch = id15[chunk * 5 + i];
      if (ch >= 'A' && ch <= 'Z') bits |= 1 << i;
    }
    suffix += SUFFIX_ALPHABET[bits];
  }
  return suffix;
}

export function toId18(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(id)) {
    throw new InvalidSalesforceIdError();
  }
  const id15 = id.slice(0, 15);
  const expected = id15 + checksumSuffix(id15);
  if (id.length === 18 && id.slice(15).toUpperCase() !== expected.slice(15)) {
    throw new InvalidSalesforceIdError();
  }
  return expected;
}
