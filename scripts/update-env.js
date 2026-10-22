// Updates KEY=value lines in a .env file atomically, keeping a 0600 backup.
// CLI: NEW_SF_CANVAS_CONSUMER_KEY=... NEW_SF_CANVAS_CONSUMER_SECRET=... node scripts/update-env.js <path>
// Values come from environment variables so they never appear in argv or shell history.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Tokens, keys, URLs and space-separated URL lists; no quotes, $, newlines or surrounding spaces.
const SAFE_VALUE = /^[A-Za-z0-9._~+\-=/:@](?:[A-Za-z0-9._~+\-=/:@ ]*[A-Za-z0-9._~+\-=/:@])?$/;

export function updateEnvFile(envPath, updates) {
  for (const [key, value] of Object.entries(updates)) {
    if (typeof value !== 'string' || !SAFE_VALUE.test(value)) throw new Error(`Unsafe value for ${key}`);
  }
  const original = fs.readFileSync(envPath, 'utf8');
  const pending = new Map(Object.entries(updates));
  const lines = original.replace(/\n$/, '').split('\n').map((line) => {
    const key = line.match(/^([A-Z0-9_]+)=/)?.[1];
    if (!key || !pending.has(key)) return line;
    const value = pending.get(key);
    pending.delete(key);
    return `${key}=${value}`;
  });
  for (const [key, value] of pending) lines.push(`${key}=${value}`);

  const backup = `${envPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.writeFileSync(backup, original, { mode: 0o600 });
  const tmp = `${envPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${lines.join('\n')}\n`, { mode: 0o600 });
  fs.renameSync(tmp, envPath);
  fs.chmodSync(envPath, 0o600);
  return backup;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const envPath = process.argv[2];
  const updates = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith('NEW_') && value) updates[name.slice(4)] = value;
  }
  if (!envPath || Object.keys(updates).length === 0) {
    process.stderr.write('usage: NEW_<KEY>=<value> node scripts/update-env.js <path-to-.env>\n');
    process.exit(2);
  }
  const backup = updateEnvFile(envPath, updates);
  process.stdout.write(`updated ${Object.keys(updates).join(', ')} in ${envPath} (backup: ${backup})\n`);
}
