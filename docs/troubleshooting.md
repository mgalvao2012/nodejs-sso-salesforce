# Troubleshooting

Start with the app log. Every Canvas failure logs `auth.canvas.rejected`, with a `reason` and, when Salesforce returned an error, a `detail`.

## Canvas sign-in

| `reason` / symptom | Likely cause | Fix |
|---|---|---|
| Tab shows "The connection is blocked because it was initiated by a public page…" | The Canvas URL points to `localhost`, which Chrome's Local Network Access blocks | Use a public HTTPS URL: `npm run dev:tunnel`, or `npm run set-app-url` and deploy |
| Tab not visible | The user lacks `NodeCrud_Access` | `sf org assign permset --name NodeCrud_Access --on-behalf-of <username>` |
| `untrusted_origin` (403) | `SF_TRUSTED_ORIGINS` doesn't match the org's hosts | `npm run init-env` |
| `invalid_signature` (401) | `SF_CANVAS_CONSUMER_SECRET` isn't the `NodeCrudEca` secret, for example after a rotation | `npm run rotate-credentials -- --sync-only`, then restart |
| `token_introspection_unavailable` with `detail: status 401 invalid_client` (502) | The key and secret in `.env` don't belong together | `npm run rotate-credentials -- --sync-only`, then restart |
| `token_introspection_unavailable` with a `network …` detail | The app can't reach `SF_MY_DOMAIN_URL` | Check egress, DNS and `SF_MY_DOMAIN_URL` |
| `wrong_client` (401) | The token in the payload was issued to another app | Expected when someone forges a request. Investigate whether it wasn't you testing. |
| `org_not_allowed` (401) | `SF_ALLOWED_ORG_ID` belongs to another org | `npm run init-env` |
| `replay` (401) | The same signed request was posted twice | Reload the tab. If it isn't you, investigate. |
| Login form with "is not linked to this application" | No local user has this Salesforce User Id | Set the Salesforce User Id in **Users → Edit** |
| Login form with "Your session has expired" | The Canvas session is over 15 minutes old | Reopen the tab |
| No header, **Users** menu or **Sign out** inside the tab | By design: in Canvas mode the app hides its header so it reads as part of Lightning | Manage users at `<app-url>/auth/login` in a browser ([operations.md](operations.md#account-administration)) |

## Deploy

| Error | Fix |
|---|---|
| `Publisher Header can be hidden only when the Publisher is included in the locations` | Don't use `HideHeader`/`HideShare` in `ExtlClntAppCanvasSettings` unless the `Publisher` location is included |
| `We couldn't find permission sets called …` (ECA policy) | `commaSeparatedPermissionSet` takes permission set **API names**. Deploy the permission set first, or in the same deployment. |
| `CannotQuickDeployError` | Quick deploy needs a validation that ran Apex tests. This package has none, so run a regular `sf project deploy start`. |
| Canvas URL went back to an old value | A deploy from the tracked files overwrote the tunnel URL. Run `npm run dev:tunnel` again. |

## Local environment

| Symptom | Fix |
|---|---|
| App exits with `Invalid configuration: …` | The variable named in the message is missing or invalid. See [configuration.md](configuration.md). |
| `port 3000 is already in use` | Stop the other instance: `kill $(lsof -tiTCP:3000 -sTCP:LISTEN)` |
| Tests fail with connection errors | `docker compose up -d db-test` (port 55433) |
| `could not get an access token` in scripts | `sf org login web --alias <alias>` |
