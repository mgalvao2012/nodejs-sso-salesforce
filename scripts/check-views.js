// Fails when a view uses unescaped output (<%-) for anything other than include().
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src/views');
const offenders = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.ejs')) {
      fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
        if (/<%-(?!\s*include\()/.test(line)) offenders.push(`${full}:${i + 1}`);
      });
    }
  }
}

walk(root);
if (offenders.length) {
  process.stderr.write(`Unescaped EJS output found:\n${offenders.join('\n')}\n`);
  process.exit(1);
}
