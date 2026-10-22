import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { hashPassword, verifyPassword } from '../security/password.js';
import { safeRedirectPath } from '../security/safe-redirect.js';
import { establishSession, destroySession } from './session.js';

export const NOTICES = {
  sso_not_permitted: 'Your Salesforce user is not allowed to sign in automatically. Sign in with email and password.',
  not_provisioned:
    'Your Salesforce user is not linked to this application. Sign in with email and password, or ask an administrator to link your account.',
  inactive: 'This user is deactivated. Contact an administrator.',
  session_expired: 'Your session has expired. Reopen the tab in Salesforce or sign in with email and password.',
};

const INVALID_CREDENTIALS = 'Invalid email or password';

// Verified when the email is unknown so response time does not reveal which accounts exist.
const dummyHash = await hashPassword('dummy-password-for-timing');

const field = (value) => (typeof value === 'string' ? value : '');

function renderLogin(req, res, { status = 200, error = null } = {}) {
  const source = req.method === 'POST' ? req.body : req.query;
  res.status(status).render('login', {
    title: 'Sign in',
    error,
    notice: NOTICES[field(req.query.notice)] ?? null,
    next: safeRedirectPath(source?.next, ''),
    email: req.method === 'POST' ? field(req.body.email) : '',
    isEmbedded: field(source?.embedded) === '1',
  });
}

async function authenticate(users, email, password) {
  const user = email ? await users.findByEmailWithHash(email) : null;
  if (!user) {
    await verifyPassword(dummyHash, password);
    return { reason: 'unknown_user' };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) return { reason: 'locked', user };
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) return { reason: 'bad_password', user };
  if (!user.active) return { reason: 'inactive', user };
  return { user };
}

export function localAuthRouter({ users, config }) {
  const router = express.Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => {
      req.log.warn('auth.local.rate_limited');
      res.status(429).render('error', { status: 429, message: 'Too many attempts. Please wait a few minutes.' });
    },
  });

  router.get('/auth/login', (req, res) => {
    if (req.user) return res.redirect(302, safeRedirectPath(req.query.next));
    return renderLogin(req, res);
  });

  router.post('/auth/login', loginLimiter, async (req, res) => {
    const email = field(req.body.email).trim();
    const password = field(req.body.password);
    const { user, reason } = await authenticate(users, email, password);

    if (reason) {
      req.log.warn({ reason, userId: user?.id }, 'auth.local.failed');
      if (reason === 'bad_password') {
        const { lockedUntil } = await users.recordLoginFailure(user.id);
        if (lockedUntil) req.log.warn({ userId: user.id, lockedUntil }, 'auth.local.locked');
      }
      return renderLogin(req, res, { status: 401, error: INVALID_CREDENTIALS });
    }

    await users.resetLoginFailures(user.id);
    await establishSession(req, user, { method: 'local' });
    return res.redirect(302, safeRedirectPath(req.body.next));
  });

  router.post('/auth/logout', async (req, res) => {
    const wasCanvas = req.authMethod === 'canvas';
    req.log.info('auth.logout');
    await destroySession(req);
    res.clearCookie('sid', { httpOnly: true, secure: config.cookieSecure, sameSite: 'none', partitioned: true });
    res.redirect(302, wasCanvas ? '/auth/login?embedded=1' : '/');
  });

  return router;
}
