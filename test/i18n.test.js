import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The UI is English-only: accented characters in src/ are leftovers of untranslated text.
const ACCENTED = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? files(full) : /\.(js|ejs)$/.test(e.name) ? [full] : [];
  });
}

describe('English-only UI', () => {
  it('has no accented characters in src/', () => {
    const offenders = files('src').flatMap((f) =>
      fs.readFileSync(f, 'utf8').split('\n').flatMap((line, i) => (ACCENTED.test(line) ? [`${f}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});
