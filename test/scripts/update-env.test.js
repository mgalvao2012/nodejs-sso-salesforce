import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { updateEnvFile } from '../../scripts/update-env.js';

let dir;
let envPath;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-test-'));
  envPath = path.join(dir, '.env');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('updateEnvFile', () => {
  it('replaces existing keys and keeps every other line', () => {
    fs.writeFileSync(envPath, '# comment\nA=1\nSF_CANVAS_CONSUMER_KEY=old\nB=2\n');
    updateEnvFile(envPath, { SF_CANVAS_CONSUMER_KEY: 'new' });
    expect(fs.readFileSync(envPath, 'utf8')).toBe('# comment\nA=1\nSF_CANVAS_CONSUMER_KEY=new\nB=2\n');
  });

  it('appends keys that are missing', () => {
    fs.writeFileSync(envPath, 'A=1\n');
    updateEnvFile(envPath, { SF_CANVAS_CONSUMER_SECRET: 's3cr3t' });
    expect(fs.readFileSync(envPath, 'utf8')).toBe('A=1\nSF_CANVAS_CONSUMER_SECRET=s3cr3t\n');
  });

  it('writes a 0600 backup of the previous file and returns its path', () => {
    fs.writeFileSync(envPath, 'SF_CANVAS_CONSUMER_KEY=old\n');
    const backup = updateEnvFile(envPath, { SF_CANVAS_CONSUMER_KEY: 'new' });
    expect(fs.readFileSync(backup, 'utf8')).toBe('SF_CANVAS_CONSUMER_KEY=old\n');
    expect(fs.statSync(backup).mode & 0o777).toBe(0o600);
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
  });

  it('does not treat a commented-out key as the key', () => {
    fs.writeFileSync(envPath, '# SF_CANVAS_CONSUMER_KEY=commented\nSF_CANVAS_CONSUMER_KEY=old\n');
    updateEnvFile(envPath, { SF_CANVAS_CONSUMER_KEY: 'new' });
    expect(fs.readFileSync(envPath, 'utf8')).toBe('# SF_CANVAS_CONSUMER_KEY=commented\nSF_CANVAS_CONSUMER_KEY=new\n');
  });

  it('accepts a space-separated list of https origins', () => {
    fs.writeFileSync(envPath, 'SF_TRUSTED_ORIGINS=\n');
    updateEnvFile(envPath, { SF_TRUSTED_ORIGINS: 'https://a.my.salesforce.com https://a--c.vf.force.com' });
    expect(fs.readFileSync(envPath, 'utf8')).toBe('SF_TRUSTED_ORIGINS=https://a.my.salesforce.com https://a--c.vf.force.com\n');
  });

  it.each(['', ' leading', 'trailing ', 'line\nbreak', 'quote"d', 'dollar$x', undefined])('rejects unsafe value %j without touching the file', (value) => {
    fs.writeFileSync(envPath, 'SF_CANVAS_CONSUMER_KEY=old\n');
    expect(() => updateEnvFile(envPath, { SF_CANVAS_CONSUMER_KEY: value })).toThrow();
    expect(fs.readFileSync(envPath, 'utf8')).toBe('SF_CANVAS_CONSUMER_KEY=old\n');
  });
});
