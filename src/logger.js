import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { pinoHttp } from 'pino-http';

export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.password',
  '*.password_hash',
  '*.passwordHash',
  '*.signed_request',
  '*.oauthToken',
  '*.access_token',
  '*.secret',
  '*.consumerSecret',
];

const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;
const IGNORED_PATHS = [/^\/healthz$/, /^\/assets\//];

export function createLogger(config, destination) {
  const options = {
    level: config.logLevel,
    base: { service: 'node-crud-sso' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
  };
  if (!destination && config.nodeEnv === 'development') {
    options.transport = { target: 'pino-pretty' };
  }
  return destination ? pino(options, destination) : pino(options);
}

export function createHttpLogger(logger) {
  return pinoHttp({
    logger,
    genReqId(req, res) {
      const incoming = req.headers['x-request-id'];
      const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    autoLogging: { ignore: (req) => IGNORED_PATHS.some((re) => re.test(req.url.split('?')[0])) },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          path: req.url.split('?')[0],
          headers: req.headers,
          remoteAddress: req.remoteAddress,
        };
      },
    },
  });
}
