# node-crud-sso

Node.js (Express 5, EJS) + PostgreSQL CRUD app with local login and Salesforce Canvas SSO through the External Client App `NodeCrudEca`. Documentation: `README.md` and `docs/`. Salesforce metadata: `salesforce/` (target org = `sf config get target-org` in that folder). Always `--dry-run` deploys first.

- Tests: `docker compose up -d db-test && ./node_modules/.bin/vitest run` (migrations run in vitest globalSetup).
- Lint: `./node_modules/.bin/eslint src && node scripts/check-views.js`.
- Scripts that touch the org (`dev-tunnel.sh`, `rotate-eca-credentials.sh`, `init-env.sh`) are run by the developer: the deploy-gate hook blocks agent-run production deploys, and `.env*` files are not readable by the agent.

## Gotchas

### Node / Express
- **express-session restores cookie attributes from the stored session**: a session row written without `secure`/`partitioned` keeps them off even if the config changes. Test cookie attributes with a session created by `establishSession`.
- **Never `delete req.session` mid-request** (`session.destroy`): later middleware (csrf-sync `generateToken`, `establishSession`) crashes with a 500. Use `req.session.regenerate` to revoke.
- **Express copies `res.locals` into render options**, so a getter on `res.locals` fires on every render. Expose lazy values (the CSRF token) as functions.
- **`Buffer.from(x, 'base64')` is lenient** (padding, whitespace, base64url). Anything keyed on the raw string (e.g. replay nonces) can be bypassed by re-encoding. Require canonical encoding and key nonces on the HMAC-covered payload.
- **supertest**: create the request (`agent.post(...)`) only after awaiting any other request it depends on (e.g. fetching a CSRF token); otherwise you get `Cannot read properties of null (reading 'address')`.
- **Bash regex bounds above 255 never match on macOS**: `{8,256}` fails to compile (RE_DUP_MAX) and returns false for every value. Check the length separately.

### Salesforce Canvas / External Client Apps
- **The 15→18 char Id suffix is case-sensitive**: `00D000000000001` → `00D000000000001EAA`, not `…AAA`. `loadConfig` validates the checksum of `SF_ALLOWED_ORG_ID`.
- **Chrome Local Network Access blocks Canvas → `localhost`** ("The connection is blocked because it was initiated by a public page…"). Salesforce owns the iframe, so `allow="local-network-access"` can't be added. Use a public HTTPS URL and `TRUST_PROXY=1`.
- **The Canvas signed request `issuedAt` is useless for freshness**: Salesforce sends a fixed value (`1611462072`). The POST `Origin` is the My Domain host, not `--c.vf.force.com`.
- **The Canvas payload's OAuth token is only bound to this app via introspection** (`/services/oauth2/introspect`, `client_id` = consumer key). `userinfo` accepts tokens from any app.
- **The ECA key and secret must be a matching pair in `.env`**: a wrong secret gives `invalid_signature`; a wrong key gives `token_introspection_unavailable` (`status 401 invalid_client`).
- **ECA Canvas (`ExtlClntAppCanvasSettings`, API 66.0+)**: `canvasOptions` HideHeader/HideShare are rejected unless the `Publisher` location is included. `ExtlClntAppOauthConfigurablePolicies.commaSeparatedPermissionSet` expects permission set **API names**, although the docs say Ids.
- **ECA credentials cannot be rotated through the Metadata API**: `shouldRotateConsumerKey`/`shouldRotateConsumerSecret=true` or a `<consumerSecret>` deploy succeeds (`changed=true`) but nothing changes, and secrets are never returned by retrieve. Use the OAuth credentials REST API (`scripts/rotate-eca-credentials.sh`):
  - The flow is `/apps/oauth/usage` → `/apps/oauth/credentials/<id>` → POST `stagedCredentialsUrl` → PATCH staged credential `{"command":"rotate"}` → `GET <consumer url>?part=keyandsecret`.
  - The PATCH response does not carry the new values. Call it once, and never pipe these responses to a terminal.
  - Completed rotations stay listed as `state: "rotated"` for 30 days: identify the new staged entry by diffing ids.
- **Deploying the tracked `NodeCrudEca_canvas` / `NodeCrudEca_glbloauth` overwrites the URL deployed by `dev-tunnel.sh`.** For one-off changes, start from a fresh retrieve.
- **Quick deploy is not available for validations that ran 0 Apex tests** (`CannotQuickDeployError`). Use a regular `sf project deploy start`.
