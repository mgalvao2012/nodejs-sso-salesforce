const SAFE_PATH = /^\/(?![/\\])[^\s\\]*$/;

export function safeRedirectPath(next, fallback = '/customers') {
  if (typeof next !== 'string' || next.length > 512 || !SAFE_PATH.test(next)) return fallback;
  return next;
}
