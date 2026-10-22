// Usage: node src/cli/create-admin.js --email admin@example.com --name "Admin"
// The password is read from stdin (piped, or typed without echo on a TTY).
import { parseArgs } from 'node:util';
import readline from 'node:readline';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { createPool } from '../db.js';
import { usersRepo } from '../users/users.repo.js';

async function readPassword() {
  if (!process.stdin.isTTY) {
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    return data.replace(/\r?\n$/, '');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  rl._writeToOutput = (s) => {
    if (s.startsWith('Password')) process.stderr.write(s);
  };
  const answer = await new Promise((resolve) => rl.question('Password: ', resolve));
  rl.close();
  process.stderr.write('\n');
  return answer;
}

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
const config = loadConfig();
const logger = createLogger(config);

if (!values.email || !values.name) {
  logger.error('usage: create-admin --email <email> --name <name>');
  process.exit(2);
}

const password = await readPassword();
if (password.length < 12) {
  logger.error('password must have at least 12 characters');
  process.exit(2);
}

const pool = createPool(config.databaseUrl, logger);
try {
  const user = await usersRepo(pool).create({ email: values.email, name: values.name, password, role: 'admin' });
  logger.info({ userId: user.id }, 'cli.admin_created');
} catch (err) {
  logger.error({ err: { name: err.name, field: err.field } }, 'cli.admin_create_failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
