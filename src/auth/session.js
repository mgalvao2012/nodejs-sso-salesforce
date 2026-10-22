import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { generateToken } from '../security/csrf.js';

export const LOCAL_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const CANVAS_SESSION_MAX_AGE_MS = 15 * 60 * 1000;

export function sessionMiddleware({ pool, config, logger }) {
  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    pool,
    tableName: 'session',
    createTableIfMissing: false,
    pruneSessionInterval: config.nodeEnv === 'test' ? false : 15 * 60,
    errorLog: (...args) => logger.error({ detail: args.map(String).join(' ') }, 'session.store_error'),
  });
  return session({
    name: 'sid',
    store,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'none',
      partitioned: true,
      maxAge: LOCAL_SESSION_MAX_AGE_MS,
    },
  });
}

const promisify = (fn) => new Promise((resolve, reject) => fn((err) => (err ? reject(err) : resolve())));

export async function establishSession(req, user, { method, sfUserId } = {}) {
  await promisify((cb) => req.session.regenerate(cb));
  req.session.userId = user.id;
  req.session.authMethod = method;
  req.session.authAt = Date.now();
  if (method === 'canvas') {
    req.session.sfUserId = sfUserId;
    req.session.cookie.maxAge = CANVAS_SESSION_MAX_AGE_MS;
  }
  generateToken(req, true);
  await promisify((cb) => req.session.save(cb));
  req.log.info({ userId: user.id, method, sfUserId }, 'auth.session.established');
}

// Drops the authenticated session but leaves a fresh empty one, so later middleware in the same request still works.
export async function revokeSession(req) {
  await promisify((cb) => req.session.regenerate(cb));
}

export async function destroySession(req) {
  if (!req.session) return;
  await promisify((cb) => req.session.destroy(cb));
}
