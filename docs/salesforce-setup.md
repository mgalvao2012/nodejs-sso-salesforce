# Set up the project in a Salesforce org

These steps reproduce the project from scratch in any Salesforce org: production, sandbox, Developer Edition or scratch org.

## Prerequisites

### Local tools

| Tool | Version | Used for |
|---|---|---|
| Node.js | 22 or newer | App, scripts and tests |
| Docker + Docker Compose | recent | PostgreSQL 16 for development and tests |
| Salesforce CLI (`sf`) | 2.155 or newer | Deploy, retrieve, access token |
| `jq`, `curl`, `shasum` | any | Scripts |
| `mkcert` | any | Local HTTPS certificate (`https://localhost:3000`) |
| `cloudflared` | any | Public HTTPS URL during development (`npm run dev:tunnel`) |

### Salesforce org

- **My Domain** deployed. It's mandatory in current orgs.
- **External Client Apps** available, with Canvas support. That means Metadata API **66.0** or newer: `ExtlClntAppCanvasSettings` was added in 66.0. If the org requires it, turn on Setup → External Client App Settings → opt in to External Client Apps.
- A **deploying user** with System Administrator (or equivalent). They need: customize application, manage External Client Apps, view and rotate consumer details, and API enabled.
- A **public HTTPS origin** for the app: hosting with a fixed URL, or a Cloudflare quick tunnel for development. Salesforce's Canvas iframe cannot reach `localhost`.

## 1. Clone and install

```bash
git clone <repo> node-crud-sso && cd node-crud-sso
npm install
docker compose up -d db db-test
mkcert -install && mkdir -p certs \
  && mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem localhost 127.0.0.1
```

## 2. Connect the org

```bash
sf org login web --alias <alias> --instance-url https://<mydomain>.my.salesforce.com
(cd salesforce && sf config set target-org <alias>)
```

All scripts use this target org unless you pass `--target-org` or set `SF_TARGET_ORG`.

## 3. Review the org-specific values in the metadata

| File | Value | Change it when |
|---|---|---|
| `externalClientApps/NodeCrudEca.eca-meta.xml` | `contactEmail` | Always: use the admin contact of the org |
| `extlClntAppCanvasSettings/NodeCrudEca_canvas.ecaCanvas-meta.xml` | `canvasUrl` | Set it with `npm run set-app-url -- <https-origin>` (step 4) |
| `extlClntAppGlobalOauthSets/NodeCrudEca_glbloauth.ecaGlblOauth-meta.xml` | `callbackUrl` | Same as above |
| `extlClntAppOauthPolicies/NodeCrudEca_oauthPlcy.ecaOauthPlcy-meta.xml` | `commaSeparatedPermissionSet` | Only if you rename the permission set. It takes the permission set **API name**, which makes it portable. |

All files live in `salesforce/force-app/main/default/`.

## 4. Choose the app URL

- **Fixed URL (hosting):**
  ```bash
  npm run set-app-url -- https://node-crud.example.com
  ```
- **Development tunnel:** skip this step. `npm run dev:tunnel` (step 9) deploys the tunnel URL every time it starts.

## 5. Deploy the metadata

Always validate first. In production, validation is mandatory before deploying.

```bash
cd salesforce
sf project deploy start --source-dir force-app --target-org <alias> --dry-run
sf project deploy start --source-dir force-app --target-org <alias>
cd ..
```

This deploys:
- **External Client App:** `NodeCrudEca`, with its OAuth, policy and Canvas settings.
- **Visualforce:** the page `NodeCrudCanvasEca` and the tab "CRUD App".
- **Permission set:** `NodeCrud_Access`.

The package has no Apex, so production doesn't require running tests.

## 6. Grant access

Assign the permission set to every Salesforce user that should get automatic sign-in:

```bash
sf org assign permset --name NodeCrud_Access --on-behalf-of <username> --target-org <alias>
```

## 7. Create `.env` from the org

```bash
npm run init-env
```

The script writes `.env` (mode 0600) and prints only non-secret values and fingerprints. It fills in:
- `SF_ALLOWED_ORG_ID`, `SF_MY_DOMAIN_URL` and `SF_TRUSTED_ORIGINS`. The trusted origins are derived from My Domain: My Domain, Lightning and Visualforce hosts, for production, sandbox, Developer Edition and scratch orgs.
- `SESSION_SECRET`, generated only if it's missing.
- `SF_CANVAS_CONSUMER_KEY` and `SF_CANVAS_CONSUMER_SECRET`, read from the OAuth credentials REST API.

Check the remaining variables in [configuration.md](configuration.md). The database URLs default to the Docker Compose roles.

## 8. Prepare the database and the first admin

```bash
npm run migrate
npm run create-admin -- --email you@example.com --name "Your Name"   # password prompt (min 12 chars)
```

## 9. Run

- **With a tunnel:** this deploys the new URL after asking for confirmation, then starts the app.
  ```bash
  npm run dev:tunnel
  ```
- **On hosting:** set `TRUST_PROXY=1` behind the proxy, then:
  ```bash
  NODE_ENV=production npm start
  ```

## 10. Link users and test

1. Sign in with the admin at `<app-url>/auth/login`.
2. Go to **Users → Edit**. In **Salesforce User Id**, enter the user's Id from Setup → Users (starts with `005`).
3. In Lightning, open the **CRUD App** tab. The customer list should appear without a login screen.

If it fails, look up the `reason` of `auth.canvas.rejected` in the app log and check [troubleshooting.md](troubleshooting.md).

## Removing the project from an org

These are destructive operations. Validate them with `--dry-run` and review them before running.

```bash
cd salesforce
sf project delete source --metadata ExternalClientApplication:NodeCrudEca \
  --metadata ApexPage:NodeCrudCanvasEca --metadata CustomTab:NodeCrudCanvasEca \
  --metadata PermissionSet:NodeCrud_Access --target-org <alias> --check-only
```
