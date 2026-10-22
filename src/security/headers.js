import helmet from 'helmet';

export function securityHeaders(config) {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        'frame-ancestors': ["'self'", ...config.sfTrustedOrigins],
      },
    },
    frameguard: false,
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
  });
}
