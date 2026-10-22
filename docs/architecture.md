# Architecture

## Overview

The app is a server-rendered Express 5 application backed by PostgreSQL. It has a public homepage; every other route requires a session. Users sign in in one of two ways:

| Strategy | Entry point | Who |
|---|---|---|
| Email + password | `GET/POST /auth/login` | Any active local user |
| Automatic SSO (Salesforce Canvas) | `POST /auth/canvas` | Salesforce users with the `NodeCrud_Access` permission set **and** a local user linked by Salesforce User Id |

Both strategies end in the same place, `establishSession()`. It regenerates the session id and rotates the CSRF token.

## Components

```mermaid
flowchart LR
  subgraph SF["Salesforce org"]
    USER["User in Lightning"]
    TAB["Visualforce tab<br/>NodeCrudCanvasEca"]
    ECA["External Client App<br/>NodeCrudEca<br/>Canvas + OAuth"]
    PS["Permission set<br/>NodeCrud_Access"]
    INTROSPECT["OAuth introspection<br/>/services/oauth2/introspect"]
    CREDAPI["OAuth credentials API<br/>/apps/oauth/credentials"]
  end
  subgraph EDGE["Public HTTPS"]
    PROXY["Cloudflare tunnel<br/>or hosting proxy"]
  end
  subgraph APP["Node.js app - Express 5"]
    CANVAS["Canvas SSO<br/>POST /auth/canvas"]
    LOCAL["Local login<br/>/auth/login"]
    CRUD["Customers and users<br/>CRUD"]
  end
  DB[("PostgreSQL<br/>users, customers,<br/>session, canvas_nonces")]
  BROWSER["Browser outside Salesforce"]
  DEV["Developer CLI<br/>sf + scripts"]

  USER --> TAB
  PS -. "admin-approved access" .-> ECA
  TAB -- "Canvas iframe<br/>POST signed_request" --> PROXY
  BROWSER --> PROXY
  PROXY --> CANVAS
  PROXY --> LOCAL
  PROXY --> CRUD
  CANVAS -- "introspect token" --> INTROSPECT
  CANVAS --> DB
  LOCAL --> DB
  CRUD --> DB
  DEV -- "deploy metadata" --> ECA
  DEV -- "rotate / sync key and secret" --> CREDAPI
```

| Component | Responsibility |
|---|---|
| `NodeCrudEca` (External Client App) | Canvas app, with access method Signed Request (POST) and the Visualforce location. OAuth scope `openid`. Policy: admin-approved users, pre-authorized through `NodeCrud_Access`. |
| `NodeCrudCanvasEca` (VF page + tab "CRUD App") | Hosts `<apex:canvasApp developerName="NodeCrudEca">` inside Lightning. |
| `NodeCrud_Access` (permission set) | The only way a Salesforce user gets SSO. It also grants access to the VF page and tab. |
| Express app (`src/`) | Security headers (CSP `frame-ancestors`), Pino logging, sessions in Postgres, CSRF, local and Canvas auth, CRUD. |
| PostgreSQL | `users` (with `sf_user_id`, lockout columns), `customers`, `session` (connect-pg-simple), `canvas_nonces` (replay protection). Runtime role `app_runtime` has DML only; migrations run as `app_migrator`. |
| Cloudflare tunnel / hosting | Public HTTPS origin. The Canvas iframe cannot reach `localhost`, because Chrome's Local Network Access blocks it. |

## Canvas SSO sequence

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant SF as Salesforce Lightning
  participant APP as Node.js app
  participant OA as Salesforce OAuth
  participant DB as PostgreSQL

  U->>SF: Open the CRUD App tab
  SF->>SF: Check NodeCrud_Access (admin-approved ECA)
  alt user lacks the permission set
    SF-->>U: Tab not available
  else authorized
    SF->>APP: POST /auth/canvas with signed_request (iframe)
    APP->>APP: Check Origin, canonical HMAC-SHA256, org Id
    APP->>DB: Insert hash of signed payload (single use, 24 h)
    APP->>OA: Introspect oauthToken with ECA key and secret
    OA-->>APP: active, client_id, sub (org and user Id)
    APP->>APP: client_id equals consumer key, user and org match
    APP->>DB: Find active, unlocked user by sf_user_id
    alt linked active user
      APP->>DB: Create session (15 min, bound to sfUserId)
      APP-->>U: 303 to /customers with Partitioned cookie
    else not linked or inactive
      APP-->>U: 303 to /auth/login with notice
    end
  end
  Note over APP: Any failed check returns 401, 403 or 502 and logs auth.canvas.rejected
```

## Local login sequence

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant APP as Node.js app
  participant DB as PostgreSQL

  U->>APP: GET /auth/login
  APP-->>U: Login form with CSRF token
  U->>APP: POST /auth/login (email, password, CSRF)
  APP->>DB: Load user by email
  alt unknown, locked, inactive or wrong password
    APP->>DB: Count failure (lock 15 min after 5)
    APP-->>U: 401 with generic message
  else valid credentials
    APP->>DB: Reset failures and regenerate session (8 h)
    APP-->>U: 302 to the requested page
  end
```

## Request pipeline

Middleware runs in this order (`src/app.js`): security headers → HTTP logger → static assets → `/healthz` → body parser (64 kb) → session → `loadCurrentUser` → `requireAuth` (global, with a public-path allowlist: `/`, `/healthz`, `/auth/*`, `/assets/*`) → CSRF (every POST except `/auth/canvas`) → method override → routes.

`loadCurrentUser` re-reads the user on every request. It revokes the session when the user is deleted, inactive or locked, and when a Canvas session is older than 15 minutes or its `sfUserId` no longer matches `users.sf_user_id`.

## User interface inside Salesforce

When the session comes from Canvas (`authMethod === 'canvas'`), or the page is opened with `?embedded=1`, the app hides its own header: brand, navigation and **Sign out**. Lightning already provides those around the tab, so the app reads as part of Salesforce. This is in `src/views/partials/head.ejs`.

As a result, the **CRUD App** tab shows only the customer screens. User administration (**Users**) and logout are available only when the app is opened directly in a browser (`<app-url>/auth/login`, local sign-in). Canvas sessions don't need a logout: they end after 15 minutes, or when the Salesforce link is removed.

## Data model

| Table | Key columns |
|---|---|
| `users` | `email` (citext, unique), `password_hash` (argon2id), `role` (`admin`/`user`), `active`, `sf_user_id` (18-char, unique, nullable), `failed_login_count`, `locked_until` |
| `customers` | `name`, `document` (CPF/CNPJ digits, unique), `email`, `phone`, `created_by` |
| `session` | connect-pg-simple store |
| `canvas_nonces` | `hash` (SHA-256 of the signed payload), `expires_at` |

The only link between a Salesforce user and a local user is `users.sf_user_id`. Admins set it in the user form. Email is never used for linking, and users are never created automatically from Salesforce.

## Repository layout

```
src/                     Express app (auth/, users/, customers/, security/, views/)
migrations/              node-pg-migrate migrations
test/                    Vitest + Supertest (real Postgres on port 55433)
salesforce/              SFDX project: ECA, VF page, tab, permission set
scripts/                 init-env, dev-tunnel, set-app-url, rotate-eca-credentials and helpers
docker/initdb/           Local database roles (app_migrator, app_runtime)
docs/                    This documentation
```
