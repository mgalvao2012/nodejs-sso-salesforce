import { revokeSession, CANVAS_SESSION_MAX_AGE_MS } from './session.js';

const PUBLIC_PATHS = [/^\/$/, /^\/healthz$/, /^\/auth(\/|$)/, /^\/assets\//];

export const isPublicPath = (path) => PUBLIC_PATHS.some((re) => re.test(path));

function revocationReason(user, session) {
  if (!user) return 'not_found';
  if (!user.active) return 'inactive';
  if (user.lockedUntil && user.lockedUntil > new Date()) return 'locked';
  // A canvas session is only valid while the user is still linked to the Salesforce user that signed in.
  if (session.authMethod === 'canvas' && user.sfUserId !== session.sfUserId) return 'sf_link_changed';
  return null;
}

export function loadCurrentUser(users) {
  return async (req, res, next) => {
    const { userId, authMethod, authAt } = req.session ?? {};
    if (!userId) return next();

    if (authMethod === 'canvas' && Date.now() - authAt > CANVAS_SESSION_MAX_AGE_MS) {
      req.log.info({ userId }, 'auth.session.canvas_expired');
      await revokeSession(req);
      req.canvasSessionExpired = true;
      return next();
    }

    const user = await users.findById(userId);
    const reason = revocationReason(user, req.session);
    if (reason) {
      req.log.warn({ userId, reason }, 'auth.session.revoked');
      await revokeSession(req);
      return next();
    }

    req.user = user;
    req.authMethod = authMethod;
    res.locals.currentUser = user;
    res.locals.authMethod = authMethod;
    req.log = req.log.child({ userId });
    return next();
  };
}

export function requireAuth(req, res, next) {
  if (req.user || isPublicPath(req.path)) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(401).render('error', { status: 401, message: 'Authentication required.' });
  if (req.canvasSessionExpired) return res.redirect(302, '/auth/login?notice=session_expired&embedded=1');
  return res.redirect(302, `/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
}

export function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  return res.status(403).render('error', { status: 403, message: 'Administrators only.' });
}
