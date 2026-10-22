import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { toId18 } from './sf-id.js';
import { consumeCanvasNonce } from './canvas-nonce.js';
import { resolveSalesforceUser, IdentityRejectedError } from './identity.js';
import { SalesforceTokenRejectedError, SalesforceUnavailableError } from './sf-token.js';
import { establishSession } from './session.js';


export class InvalidSignedRequestError extends Error {
  constructor(reason) {
    super(`Invalid signed request: ${reason}`);
    this.name = 'InvalidSignedRequestError';
    this.reason = reason;
  }
}

export function verifySignedRequest(signedRequest, secret) {
  if (typeof signedRequest !== 'string') throw new InvalidSignedRequestError('missing');
  const parts = signedRequest.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new InvalidSignedRequestError('malformed');
  const [signatureB64, payloadB64] = parts;

  const expected = createHmac('sha256', secret).update(payloadB64).digest();
  const actual = Buffer.from(signatureB64, 'base64');
  // Buffer.from is lenient (padding, whitespace, base64url); only the canonical encoding is accepted.
  if (actual.toString('base64') !== signatureB64) throw new InvalidSignedRequestError('bad_signature');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new InvalidSignedRequestError('bad_signature');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
  } catch {
    throw new InvalidSignedRequestError('bad_payload');
  }
  if (payload?.algorithm !== 'HMACSHA256') throw new InvalidSignedRequestError('bad_algorithm');
  // issuedAt is not checked: Salesforce sends a fixed value (1611462072 = 2021-01-24) unrelated to the request time.
  // Freshness comes from the single-use nonce and the token introspection (active + issued to this app).
  return payload;
}

const tryId18 = (value) => {
  try {
    return toId18(value);
  } catch {
    return null;
  }
};

function requestOrigin(req) {
  const origin = req.get('origin');
  if (origin && origin !== 'null') return origin;
  const referer = req.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

class CanvasRejection extends Error {
  constructor(status, reason, { level = 'warn', redirect, detail } = {}) {
    super(reason);
    this.status = status;
    this.reason = reason;
    this.level = level;
    this.redirect = redirect;
    this.detail = detail;
  }
}

const toLogin = (notice) => `/auth/login?notice=${notice}&embedded=1`;

export function canvasAuthRouter({ pool, config, users, sfTokenInfo }) {
  const router = express.Router();
  const trustedOrigins = new Set(config.sfTrustedOrigins);

  async function authenticate(req) {
    if (!trustedOrigins.has(requestOrigin(req))) throw new CanvasRejection(403, 'untrusted_origin');

    let payload;
    try {
      payload = verifySignedRequest(req.body?.signed_request, config.sfCanvasConsumerSecret);
    } catch {
      throw new CanvasRejection(401, 'invalid_signature');
    }

    const ctx = { sfOrgId: payload.context?.organization?.organizationId, sfUserId: payload.context?.user?.userId };
    req.canvasLogContext = ctx;
    if (tryId18(ctx.sfOrgId) !== config.sfAllowedOrgId) throw new CanvasRejection(401, 'org_not_allowed');

    // Keyed on the HMAC-covered payload, so re-encoding the signature cannot produce a fresh nonce.
    const signedPayload = req.body.signed_request.split('.')[1];
    if (!(await consumeCanvasNonce(pool, signedPayload))) throw new CanvasRejection(401, 'replay');

    let info;
    try {
      info = await sfTokenInfo({
        myDomainUrl: config.sfMyDomainUrl,
        accessToken: payload.client?.oauthToken,
        clientId: config.sfCanvasConsumerKey,
        clientSecret: config.sfCanvasConsumerSecret,
      });
    } catch (err) {
      if (err instanceof SalesforceTokenRejectedError) throw new CanvasRejection(401, 'token_rejected');
      if (err instanceof SalesforceUnavailableError) {
        throw new CanvasRejection(502, 'token_introspection_unavailable', { level: 'error', detail: err.detail });
      }
      throw err;
    }

    // Tokens issued to other apps of the same user (SF CLI, integrations) must not open a session.
    if (info.clientId !== config.sfCanvasConsumerKey) throw new CanvasRejection(401, 'wrong_client');

    const userId18 = tryId18(info.userId);
    if (!userId18 || userId18 !== tryId18(ctx.sfUserId) || tryId18(info.orgId) !== config.sfAllowedOrgId) {
      throw new CanvasRejection(401, 'identity_mismatch');
    }

    // Who may use SSO is enforced by Salesforce (admin-approved External Client App + NodeCrud_Access permission set)
    // and by the explicit sf_user_id link below.
    try {
      return { user: await resolveSalesforceUser(users, config, { orgId: info.orgId, userId: userId18 }), sfUserId: userId18 };
    } catch (err) {
      if (!(err instanceof IdentityRejectedError)) throw err;
      if (err.reason === 'org_not_allowed') throw new CanvasRejection(401, err.reason);
      throw new CanvasRejection(303, err.reason, { redirect: toLogin(err.reason) });
    }
  }

  router.post('/auth/canvas', async (req, res) => {
    try {
      const { user, sfUserId } = await authenticate(req);
      await establishSession(req, user, { method: 'canvas', sfUserId });
      return res.redirect(303, '/customers');
    } catch (err) {
      if (!(err instanceof CanvasRejection)) throw err;
      req.log[err.level]({ reason: err.reason, detail: err.detail, ...req.canvasLogContext }, 'auth.canvas.rejected');
      if (err.redirect) return res.redirect(303, err.redirect);
      const message =
        err.status === 502
          ? 'Salesforce is unavailable, please try again.'
          : 'Could not sign in through Salesforce.';
      return res.status(err.status).render('error', { status: err.status, message, isEmbedded: true });
    }
  });

  return router;
}
