import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import methodOverride from 'method-override';
import { createLogger, createHttpLogger } from './logger.js';
import { securityHeaders } from './security/headers.js';
import { csrfProtection, exposeCsrfToken } from './security/csrf.js';
import { sessionMiddleware } from './auth/session.js';
import { loadCurrentUser, requireAuth } from './auth/require-auth.js';
import { usersRepo } from './users/users.repo.js';
import { localAuthRouter } from './auth/local.routes.js';
import { canvasAuthRouter } from './auth/canvas.routes.js';
import { fetchSalesforceTokenInfo } from './auth/sf-token.js';
import { customersRouter } from './customers/customers.routes.js';
import { usersRouter } from './users/users.routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({
  pool,
  config,
  logger = createLogger(config),
  sfTokenInfo = fetchSalesforceTokenInfo,
  extend,
  extendProtected,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Hop count of trusted reverse proxies; 0 when the app terminates TLS itself.
  app.set('trust proxy', config.trustProxy ?? 0);
  app.set('view engine', 'ejs');
  app.set('views', path.join(here, 'views'));

  app.use(securityHeaders(config));
  app.use(createHttpLogger(logger));
  app.use('/assets', express.static(path.join(here, 'public'), { maxAge: '1h' }));

  app.get('/healthz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'error' });
    }
  });

  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(sessionMiddleware({ pool, config, logger }));
  const users = usersRepo(pool);
  app.use(loadCurrentUser(users));
  app.use(requireAuth);
  app.use(exposeCsrfToken);
  app.use(csrfProtection);
  app.use(methodOverride((req) => (req.method === 'POST' && typeof req.body?._method === 'string' ? req.body._method : undefined)));

  app.get('/', (_req, res) => res.render('home'));
  app.use(localAuthRouter({ users, config }));
  app.use(canvasAuthRouter({ pool, config, users, sfTokenInfo }));

  extend?.(app);
  extendProtected?.(app);
  app.use(customersRouter({ pool }));
  app.use(usersRouter({ pool }));

  app.use((_req, res) => {
    res.status(404).render('error', { status: 404, message: 'Page not found.' });
  });

  app.use((err, req, res, _next) => {
    if (err.code === 'EBADCSRFTOKEN') {
      req.log.warn('csrf.invalid_token');
      return res.status(403).render('error', { status: 403, message: 'Session expired or invalid form. Reload the page.' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).render('error', { status: 413, message: 'Request too large.' });
    }
    req.log.error({ err }, 'unhandled_error');
    return res.status(500).type('text').send('Internal server error');
  });

  return app;
}
