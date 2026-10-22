# Operations

## Development tunnel

```bash
npm run dev:tunnel                    # asks before deploying
npm run dev:tunnel -- --yes           # deploy without asking
npm run dev:tunnel -- --no-deploy     # tunnel + app only
```

The script works in four steps:
1. Starts a Cloudflare quick tunnel to `https://localhost:3000`. Each start gets a new random URL, which is saved in `.dev/url`.
2. Applies that URL to temporary copies of `NodeCrudEca_canvas` and `NodeCrudEca_glbloauth`.
3. Deploys those two components after asking for confirmation.
4. Starts the app with `TRUST_PROXY=1`. Ctrl+C stops both the app and the tunnel.

The tracked metadata is never modified. A quick tunnel exposes the app publicly, so stop it when you're done. A stable URL avoids the redeploy on every start: either a Cloudflare named tunnel on your own domain or real hosting, configured with `npm run set-app-url`.

## Rotating the consumer key and secret

```bash
npm run rotate-credentials                # shows fingerprints, asks for confirmation
npm run rotate-credentials -- --yes
npm run rotate-credentials -- --sync-only # no rotation: copy the current key/secret from the org into .env
```

The script uses the CLI's access token and the OAuth credentials REST API, through these calls:
1. `/apps/oauth/usage` returns the app identifier.
2. `/apps/oauth/credentials/<id>` returns the consumer.
3. A POST to `stagedCredentialsUrl` stages new credentials.
4. A PATCH with `{"command":"rotate"}` rotates them.
5. `GET <consumer>?part=keyandsecret` reads the new values.

The script then writes the key and secret to `.env`, keeping a 0600 backup. Only fingerprints are printed.

Rotation takes effect immediately: restart the app right after. The Metadata API cannot rotate these credentials, because the rotation flags and a `<consumerSecret>` element are accepted on deploy but ignored.

Rotate when someone with access leaves, when the secret may have been exposed, and periodically.

## Logs

Pino writes structured JSON to stdout, or pretty output with `NODE_ENV=development`. Every response carries an `x-request-id`. The logger always redacts cookies, the `authorization` header, passwords, hashes, `signed_request`, `oauthToken` and secrets, and request bodies and query strings are never logged.

| Event | Meaning |
|---|---|
| `auth.session.established` | Successful sign-in (`method`: `local` or `canvas`, `userId`, `sfUserId`) |
| `auth.local.failed` / `auth.local.locked` | Failed local login (`reason`) / account locked for 15 min |
| `auth.local.rate_limited` | More than 10 login attempts in 15 min from one IP |
| `auth.canvas.rejected` | Canvas sign-in refused (`reason`, `detail`). See [troubleshooting.md](troubleshooting.md) |
| `auth.session.revoked` / `auth.session.canvas_expired` | Session ended (user inactive, locked or unlinked; Canvas session older than 15 min) |
| `users.*`, `customers.*`, `users.sf_link_changed` | Audit trail of CRUD changes, logging field names only, never values |

## Account administration

User administration happens **outside Salesforce**. Open `<app-url>/auth/login` in a browser and sign in with an admin's email and password. The **CRUD App** tab hides the app header, including the **Users** menu (see [architecture.md](architecture.md#user-interface-inside-salesforce)).

- **Unlock an account:** go to **Users → Edit → Unlock**. Locks also expire on their own 15 minutes after the 5th failure.
- **Link or unlink a Salesforce user:** set or clear the **Salesforce User Id** field of the user. Clearing it ends that user's open Canvas sessions on their next request.
- **Cut someone's SSO immediately:** remove `NodeCrud_Access` in Salesforce **and** clear their Salesforce User Id in the app.

## Deploying metadata changes

Validate first. Production requires validation, and the package has no Apex, so no tests run:

```bash
cd salesforce
sf project deploy start --source-dir force-app --target-org <alias> --dry-run
sf project deploy start --source-dir force-app --target-org <alias>
```

Deploying `NodeCrudEca_canvas` / `NodeCrudEca_glbloauth` from the repository sets the Canvas URL to the value in the tracked files and overwrites the URL that `dev:tunnel` deployed.
