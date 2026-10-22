// Points <canvasUrl>/<callbackUrl> of Salesforce metadata files at <base>/auth/canvas.
// CLI: node scripts/set-canvas-url.js <https-origin> <file>... (rewrites the files in place)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_ELEMENT = /<(canvasUrl|callbackUrl)>[^<]*<\/\1>/g;

function assertOrigin(base) {
  let url;
  try {
    url = new URL(base);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== 'https:' || url.origin !== base || base.includes('*')) {
    throw new Error(`base must be an https origin without path: ${JSON.stringify(base)}`);
  }
}

export function rewriteCanvasUrls(xml, base) {
  assertOrigin(base);
  if (!xml.match(URL_ELEMENT)) throw new Error('no canvasUrl/callbackUrl element found');
  return xml.replace(URL_ELEMENT, (_m, tag) => `<${tag}>${base}/auth/canvas</${tag}>`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [base, ...files] = process.argv.slice(2);
  if (!base || files.length === 0) {
    process.stderr.write('usage: node scripts/set-canvas-url.js <https-origin> <file>...\n');
    process.exit(2);
  }
  for (const file of files) fs.writeFileSync(file, rewriteCanvasUrls(fs.readFileSync(file, 'utf8'), base));
}
