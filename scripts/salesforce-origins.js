// Derives the exact origins Salesforce uses to embed the Canvas app from the org's My Domain URL:
// My Domain, Lightning and Visualforce hosts (production, sandbox, Developer Edition, scratch).
// CLI: node scripts/salesforce-origins.js <my-domain-url>  -> space-separated origins
import { fileURLToPath } from 'node:url';

const MY_DOMAIN_HOST = /^([a-z0-9-]+)((?:\.[a-z]+)?)\.my\.salesforce\.com$/i;

export function deriveTrustedOrigins(myDomainUrl) {
  let url;
  try {
    url = new URL(myDomainUrl);
  } catch {
    url = null;
  }
  const match = url?.protocol === 'https:' ? url.hostname.match(MY_DOMAIN_HOST) : null;
  if (!match) throw new Error(`not a My Domain URL (https://<name>[.<kind>].my.salesforce.com): ${myDomainUrl}`);
  const [, name, kind] = match;
  return [
    `https://${name}${kind}.my.salesforce.com`,
    `https://${name}${kind}.lightning.force.com`,
    `https://${name}--c${kind}.vf.force.com`,
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${deriveTrustedOrigins(process.argv[2]).join(' ')}\n`);
}
