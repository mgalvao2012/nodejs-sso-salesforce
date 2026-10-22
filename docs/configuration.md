# Configuration

The app reads its configuration from environment variables. Locally they come from `.env`, which is git-ignored and mode 0600, created by `npm run init-env`. `src/config.js` validates them at startup, and the app refuses to start if any of them is invalid.

| Variable | Required | Example / default | Notes |
|---|---|---|---|
| `NODE_ENV` | no | `production` | `development` enables pretty logs. `test` disables secure cookies. |
| `PORT` | no | `3000` | |
| `LOG_LEVEL` | no | `info` | Pino level. Use `silent` in tests. |
| `TRUST_PROXY` | no | `0` | Number of reverse proxies in front of the app. Use `1` behind a tunnel or hosting proxy, and `0` when the app terminates TLS. |
| `DATABASE_URL` | yes | `postgres://app_runtime:runtime@localhost:55432/app_dev` | Runtime role: DML only. |
| `DATABASE_MIGRATION_URL` | for migrations | `postgres://app_migrator:migrator@localhost:55432/app_dev` | Schema owner. Used only by `npm run migrate`. |
| `SESSION_SECRET` | yes | generated | At least 32 characters. |
| `SF_CANVAS_CONSUMER_KEY` | yes | from the org | `NodeCrudEca` consumer key. Must match the secret. |
| `SF_CANVAS_CONSUMER_SECRET` | yes | from the org | `NodeCrudEca` consumer secret. It signs the Canvas `signed_request` and authenticates token introspection. |
| `SF_MY_DOMAIN_URL` | yes | `https://acme.my.salesforce.com` | Token introspection is always called here, never on a URL taken from the payload. |
| `SF_ALLOWED_ORG_ID` | yes | `00D…` | 15 or 18 characters. The checksum is validated and the value is normalized to 18. |
| `SF_TRUSTED_ORIGINS` | yes | `https://acme.my.salesforce.com https://acme.lightning.force.com https://acme--c.vf.force.com` | Exact `https` origins separated by spaces. No wildcards or paths. Used for CSP `frame-ancestors` and for the Canvas `Origin` check. |
| `TLS_CERT_FILE`, `TLS_KEY_FILE` | no | `certs/localhost.pem`, `certs/localhost-key.pem` | When set, the app serves HTTPS itself. |
| `SF_TARGET_ORG` | no | `<alias>` | Org used by the scripts. Defaults to the `target-org` configured in `salesforce/`. |

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | App with `node --watch` |
| `npm run dev:tunnel` | Quick tunnel + deploy of the new Canvas URL + app ([operations.md](operations.md#development-tunnel)) |
| `npm start` | App (production) |
| `npm test` | Vitest suite (needs `docker compose up -d db-test`) |
| `npm run lint` | ESLint + EJS escaping check |
| `npm run migrate` | Database migrations |
| `npm run create-admin -- --email … --name …` | First admin user (password prompt) |
| `npm run init-env` | Fill `.env` from the org |
| `npm run set-app-url -- <https-origin>` | Set the app URL in the tracked metadata |
| `npm run rotate-credentials` | Rotate the ECA consumer key and secret and update `.env` |
