import { csrfSync } from 'csrf-sync';

// The Canvas endpoint is authenticated by its HMAC signature, Origin check and token introspection.
const CSRF_EXEMPT_PATHS = new Set(['/auth/canvas']);

const { csrfSynchronisedProtection, generateToken } = csrfSync({
  getTokenFromRequest: (req) => req.body?._csrf ?? req.headers['x-csrf-token'],
});

export { generateToken };

export function csrfProtection(req, res, next) {
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();
  return csrfSynchronisedProtection(req, res, next);
}

// Exposed as a function so the token (and the session holding it) is only created by views that render a form.
export function exposeCsrfToken(req, res, next) {
  res.locals.csrfToken = () => generateToken(req);
  next();
}
