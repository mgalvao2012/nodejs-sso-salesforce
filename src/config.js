import { z } from 'zod';
import { toId18 } from './auth/sf-id.js';

const trustedOrigin = z.string().refine((value) => {
  if (value.includes('*')) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  } catch {
    return false;
  }
}, 'must be an exact https origin without wildcard or path');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  SF_CANVAS_CONSUMER_KEY: z.string().min(1),
  SF_CANVAS_CONSUMER_SECRET: z.string().min(1),
  SF_MY_DOMAIN_URL: trustedOrigin,
  SF_ALLOWED_ORG_ID: z
    .string()
    .regex(/^00D[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?$/)
    .refine((v) => {
      try {
        toId18(v);
        return true;
      } catch {
        return false;
      }
    }, 'invalid Salesforce Id checksum')
    .transform(toId18),
  SF_TRUSTED_ORIGINS: z
    .string()
    .transform((s) => s.split(/\s+/).filter(Boolean))
    .pipe(z.array(trustedOrigin).min(1)),
  TLS_CERT_FILE: z.string().optional(),
  TLS_KEY_FILE: z.string().optional(),
});

export function loadConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  const e = result.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    databaseUrl: e.DATABASE_URL,
    sessionSecret: e.SESSION_SECRET,
    sfCanvasConsumerKey: e.SF_CANVAS_CONSUMER_KEY,
    sfCanvasConsumerSecret: e.SF_CANVAS_CONSUMER_SECRET,
    sfMyDomainUrl: e.SF_MY_DOMAIN_URL,
    sfAllowedOrgId: e.SF_ALLOWED_ORG_ID,
    sfTrustedOrigins: e.SF_TRUSTED_ORIGINS,
    tlsCertFile: e.TLS_CERT_FILE,
    tlsKeyFile: e.TLS_KEY_FILE,
    cookieSecure: e.NODE_ENV !== 'test',
  };
}
