# Security model

## Canvas SSO checks

`POST /auth/canvas` creates a session only when every check passes, in this order. The first failure ends the request.

| # | Check | Protects against | Failure |
|---|---|---|---|
| 1 | `Origin` (or `Referer`) is in `SF_TRUSTED_ORIGINS` | Login CSRF from other sites | 403 `untrusted_origin` |
| 2 | Canonical base64 HMAC-SHA256 of the payload with the consumer secret, `algorithm = HMACSHA256` | Forged or tampered requests | 401 `invalid_signature` |
| 3 | `context.organization.organizationId` equals `SF_ALLOWED_ORG_ID` | Requests from other orgs | 401 `org_not_allowed` |
| 4 | SHA-256 of the signed payload not seen in the last 24 h | Replay of a captured request | 401 `replay` |
| 5 | Token introspection on `SF_MY_DOMAIN_URL` returns `active` | Expired or forged tokens | 401 `token_rejected` / 502 `token_introspection_unavailable` |
| 6 | Introspected `client_id` equals the consumer key | Tokens issued to other apps (SF CLI, integrations) used with a leaked secret | 401 `wrong_client` |
| 7 | Introspected user and org match the payload | Mixing a valid token with another identity | 401 `identity_mismatch` |
| 8 | A local user is linked by `sf_user_id` and is active and not locked | Unprovisioned or disabled users | 303 to the login form with a notice |

The checks never trust `client.instanceUrl` or `client.targetOrigin` from the payload. `issuedAt` is ignored, because Salesforce sends a fixed value; freshness comes from checks 4 and 5. Who may use SSO at all is enforced by Salesforce: the External Client App is admin-approved and pre-authorized only for `NodeCrud_Access`.

## Sessions and cookies

- **Storage and cookie:** sessions are stored in PostgreSQL. The cookie `sid` is `HttpOnly; Secure; SameSite=None; Partitioned`, which is required inside the Lightning iframe when third-party cookies are blocked.
- **Lifetime:** local sessions last 8 h (rolling). Canvas sessions last an absolute 15 min and are bound to the `sfUserId` that signed in.
- **On sign-in:** the session id and the CSRF token are regenerated (session fixation). Every POST needs a CSRF token, except `/auth/canvas`, which is protected by checks 1 to 7.
- **Revocation:** a session is revoked on the next request when the user is deactivated, locked, deleted or unlinked.

## Local accounts

- **Passwords:** argon2id, minimum 12 characters for new passwords.
- **Generic error:** the same message for an unknown user, a wrong password, an inactive account and a locked account. When the email is unknown, a dummy hash is still verified.
- **Brute force:** after 5 consecutive failures the account is locked for 15 min. There's also a limit of 10 attempts per 15 min per IP, and the IP is taken from `X-Forwarded-For` only when `TRUST_PROXY` is set.
- **Admins:** an admin cannot deactivate, demote or delete themselves, and the last active admin cannot be removed. Both rules are enforced in a transaction with row locks.

## HTTP hardening

- **Headers:** Helmet with CSP `frame-ancestors 'self' <SF_TRUSTED_ORIGINS>`. There are no wildcards and the config rejects them. HSTS is on and `X-Frame-Options` is off, because CSP replaces it.
- **Views:** EJS templates only use escaped output. `npm run lint` fails on `<%-` outside `include`.
- **Redirects and input:** `next` redirects only accept relative paths. Requests over 64 kb are rejected. SQL is always parameterized, and LIKE wildcards in search are escaped.
- **Database:** the app connects with a role that has DML only.

## Secrets

- **Where they live:** only in environment variables (`.env`, git-ignored, mode 0600).
- **Scripts:** they never print secrets, put them on argv or commit them; you only see fingerprints. The access token used by the scripts goes in a private header file.
- **Logs:** redaction covers cookies, auth headers, passwords, hashes, `signed_request`, `oauthToken` and secrets.

## Monitoring

- **Canvas alerts:** alert on `auth.canvas.rejected` with `reason` in `replay`, `wrong_client`, `identity_mismatch`, `token_rejected`, `invalid_signature`, `untrusted_origin`. These point to tampering or to a leaked signed request or secret.
- **Salesforce policy:** watch the Setup Audit Trail for changes to `NodeCrudEca` (permitted users, permission sets). The Salesforce side of the authorization depends on that policy, and the metadata in `salesforce/` is the source of truth.
- **Consumer secret:** rotate it right away if it may have been exposed ([operations.md](operations.md#rotating-the-consumer-key-and-secret)).

## Residual risks

- **A request captured before the browser sends it:** a malicious extension or an XSS on the Salesforce page could grab the `signed_request` and use it first. The window is limited by single use, the live-token check and the 15-minute Canvas sessions.
- **Local lockout as a lever against SSO:** anyone who knows a user's email can lock that user for 15 min, and the lock also blocks their SSO.
- **Quick tunnels:** they expose the development app publicly while they run.
