#!/usr/bin/env bash
# Creates/updates .env for a Salesforce org: org id, My Domain, trusted origins, a session secret (if
# missing) and the NodeCrudEca consumer key/secret (read through the REST API). Run it after deploying
# the metadata in salesforce/ to the org. Nothing secret is printed.
#
#   npm run init-env                          # org: $SF_TARGET_ORG or the target-org of salesforce/
#   npm run init-env -- --target-org <alias>
#   npm run init-env -- --skip-credentials    # do not read the ECA key/secret (app not deployed yet)
set -euo pipefail

ORG=""
CREDENTIALS=true

while [ $# -gt 0 ]; do
  case "$1" in
    --target-org) ORG="$2"; shift ;;
    --skip-credentials) CREDENTIALS=false ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

for cmd in sf jq node; do
  command -v "$cmd" >/dev/null || { echo "missing dependency: $cmd" >&2; exit 2; }
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE="$ROOT/.env"
# shellcheck source=lib/target-org.sh
. "$ROOT/scripts/lib/target-org.sh"
resolve_org "$ROOT/salesforce"

umask 077
if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "created .env from .env.example"
fi

ORG_JSON=$(sf org display --target-org "$ORG" --json 2>/dev/null) || { echo "cannot reach org $ORG (sf org login web --alias $ORG)" >&2; exit 1; }
ORG_ID=$(printf '%s' "$ORG_JSON" | jq -r '.result.id // empty')
MY_DOMAIN=$(printf '%s' "$ORG_JSON" | jq -r '.result.instanceUrl // empty' | sed 's:/*$::')
unset ORG_JSON
[ -n "$ORG_ID" ] && [ -n "$MY_DOMAIN" ] || { echo "could not read org id / instance URL of $ORG" >&2; exit 1; }
ORIGINS=$(node "$ROOT/scripts/salesforce-origins.js" "$MY_DOMAIN")

export NEW_SF_ALLOWED_ORG_ID="$ORG_ID" NEW_SF_MY_DOMAIN_URL="$MY_DOMAIN" NEW_SF_TRUSTED_ORIGINS="$ORIGINS"
CURRENT_SECRET=$(sed -n 's/^SESSION_SECRET=//p' "$ENV_FILE" | head -1)
if [ "${#CURRENT_SECRET}" -lt 32 ]; then
  NEW_SESSION_SECRET=$(node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))")
  export NEW_SESSION_SECRET
  echo "generated SESSION_SECRET"
fi
unset CURRENT_SECRET
node "$ROOT/scripts/update-env.js" "$ENV_FILE"
unset NEW_SF_ALLOWED_ORG_ID NEW_SF_MY_DOMAIN_URL NEW_SF_TRUSTED_ORIGINS NEW_SESSION_SECRET

echo "org:              $ORG ($ORG_ID)"
echo "My Domain:        $MY_DOMAIN"
echo "trusted origins:  $ORIGINS"

if [ "$CREDENTIALS" = true ]; then
  bash "$ROOT/scripts/rotate-eca-credentials.sh" --sync-only --target-org "$ORG"
else
  echo "skipped consumer key/secret: run 'bash scripts/rotate-eca-credentials.sh --sync-only' after deploying."
fi
