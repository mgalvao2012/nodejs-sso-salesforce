#!/usr/bin/env bash
# Rotates the NodeCrudEca consumer key + secret through the OAuth credentials REST API (staged rotation)
# and writes the new values to .env. Nothing secret is printed, passed on argv, or committed.
#
#   scripts/rotate-eca-credentials.sh                    # asks for confirmation
#   scripts/rotate-eca-credentials.sh --yes              # no confirmation
#   scripts/rotate-eca-credentials.sh --sync-only        # no rotation: copy the current key/secret from the org into .env
#   options: --target-org <alias> (default: $SF_TARGET_ORG or the target-org of salesforce/)
#            --api-version <vNN.N> (default v68.0)
#
# Flow: CLI access token -> /apps/oauth/usage (ECA identifier) -> /apps/oauth/credentials/<id>
#       (consumer url + stagedCredentialsUrl) -> POST stage -> GET staged -> PATCH {"command":"rotate"}
#       -> GET <consumer url>?part=keyandsecret (the PATCH response does not carry the new values).
# The Metadata API cannot do this (rotation flags and <consumerSecret> are accepted but ignored).
# Rotation is immediate: Canvas sign-in fails until the app restarts with the new .env.
set -euo pipefail

APP=NodeCrudEca
ORG=""
API=v68.0
YES=false
SYNC_ONLY=false

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) YES=true ;;
    --sync-only) SYNC_ONLY=true ;;
    --target-org) ORG="$2"; shift ;;
    --api-version) API="$2"; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

for cmd in sf jq curl node shasum; do
  command -v "$cmd" >/dev/null || { echo "missing dependency: $cmd" >&2; exit 2; }
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE="$ROOT/.env"
# shellcheck source=lib/target-org.sh
. "$ROOT/scripts/lib/target-org.sh"
resolve_org "$ROOT/salesforce"
[ -f "$ENV_FILE" ] || { echo ".env not found: $ENV_FILE" >&2; exit 2; }

umask 077
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fp() { printf '%s' "$1" | shasum -a 256 | cut -c1-8; }
die() { echo "$*" >&2; exit 1; }
# Length is checked separately: ERE bounds above 255 ({8,256}) do not compile (RE_DUP_MAX) and never match.
valid_value() { [[ "$1" =~ $2 ]] && [ "${#1}" -ge 8 ] && [ "${#1}" -le 256 ]; }

# Access token goes to a private header file, never to argv or stdout.
TOKEN=$(sf org auth show-access-token --target-org "$ORG" --no-prompt --json 2>/dev/null | jq -r '.result.accessToken // empty')
[ -n "$TOKEN" ] || die "could not get an access token for $ORG (sf org login web --alias $ORG)"
printf 'Authorization: Bearer %s\n' "$TOKEN" > "$TMP/auth.header"
unset TOKEN
INSTANCE=$(sf org display --target-org "$ORG" --json 2>/dev/null | jq -r '.result.instanceUrl // empty')
[ -n "$INSTANCE" ] || die "could not read the instance URL of $ORG"

# api METHOD PATH [JSON] -> response body on stdout; fails on HTTP >= 400 printing only the error code.
api() {
  local method=$1 path=$2 body=${3:-} out code
  local args=(--silent --show-error -X "$method" -H @"$TMP/auth.header" -H 'Accept: application/json'
              -o "$TMP/body" -w '%{http_code}')
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' --data "$body")
  code=$(curl "${args[@]}" "$INSTANCE$path") || die "request failed: $method $path"
  if [ "$code" -ge 400 ]; then
    die "HTTP $code on $method $path ($(jq -r 'if type == "array" then .[0].errorCode else .errorCode end // "no error code"' "$TMP/body" 2>/dev/null || echo "non-JSON response"))"
  fi
  cat "$TMP/body"
}

echo "looking up $APP in $ORG..."
IDENTIFIER=$(api GET "/services/data/$API/apps/oauth/usage" | jq -r --arg n "$APP" '[.apps[] | select(.developerName == $n) | .identifier] | if length == 1 then .[0] else empty end')
[ -n "$IDENTIFIER" ] || die "expected exactly one app named $APP in /apps/oauth/usage"

api GET "/services/data/$API/apps/oauth/credentials/$IDENTIFIER" > "$TMP/consumers.json"
[ "$(jq '.consumers | length' "$TMP/consumers.json")" = 1 ] || die "expected exactly one consumer for $APP"
CONSUMER_URL=$(jq -r '.consumers[0].url' "$TMP/consumers.json")
STAGED_URL=$(jq -r '.consumers[0].stagedCredentialsUrl' "$TMP/consumers.json")

# Current (primary) key and secret, straight into .env. Values never reach stdout or argv.
write_current_credentials() {
  api GET "$CONSUMER_URL?part=keyandsecret" > "$TMP/current.json"
  NEW_KEY=$(jq -r '.key // empty' "$TMP/current.json")
  NEW_SECRET=$(jq -r '.secret // empty' "$TMP/current.json")
  rm -f "$TMP/current.json" "$TMP/body"
  valid_value "$NEW_KEY" '^[A-Za-z0-9._]+$' || die "no valid consumer key in the API response; .env untouched"
  valid_value "$NEW_SECRET" '^[A-Za-z0-9]+$' || die "no valid consumer secret in the API response; .env untouched"
  export NEW_SF_CANVAS_CONSUMER_KEY="$NEW_KEY" NEW_SF_CANVAS_CONSUMER_SECRET="$NEW_SECRET"
  node "$ROOT/scripts/update-env.js" "$ENV_FILE"
  echo "key $(fp "$OLD_KEY") -> $(fp "$NEW_KEY"), secret $(fp "$OLD_SECRET") -> $(fp "$NEW_SECRET") (fingerprints)"
  unset NEW_SF_CANVAS_CONSUMER_KEY NEW_SF_CANVAS_CONSUMER_SECRET
}

OLD_KEY=$(sed -n 's/^SF_CANVAS_CONSUMER_KEY=//p' "$ENV_FILE" | head -1)
OLD_SECRET=$(sed -n 's/^SF_CANVAS_CONSUMER_SECRET=//p' "$ENV_FILE" | head -1)

if [ "$SYNC_ONLY" = true ]; then
  write_current_credentials
  echo "Restart the app now (Ctrl+C, then npm run dev:tunnel)."
  exit 0
fi

echo "org:      $ORG ($INSTANCE)"
echo "app:      $APP"
echo "current:  key $(fp "$OLD_KEY") / secret $(fp "$OLD_SECRET") (fingerprints)"
echo "effect:   new key and secret; the current ones stop working immediately."
if [ "$YES" != true ]; then
  [ -t 0 ] || die "not a terminal: re-run with --yes to rotate without confirmation"
  answer=""
  read -r -p "Rotate the credentials of $APP in $ORG? [y/N] " answer || true
  case "$answer" in y|Y|yes|s|sim) ;; *) echo "aborted, nothing changed."; exit 0 ;; esac
fi

# Earlier rotations stay listed (state "rotated", 30-day expiry), so identify the entry this run creates
# by diffing the staged ids before and after the POST.
BEFORE=$(api GET "$STAGED_URL" | jq -c '[.stagedCredentials[].id]')
# Stage new credentials (the response may contain them: never printed).
api POST "$STAGED_URL" > /dev/null
STAGED_ID_URL=$(api GET "$STAGED_URL" | jq -r --argjson before "$BEFORE" \
  '[.stagedCredentials[] | select(.id as $id | $before | index($id) | not) | .url] | if length == 1 then .[0] else empty end')
[ -n "$STAGED_ID_URL" ] || die "could not identify the credential staged by this run; check Setup > External Client App Manager > $APP"

# Rotate exactly once. The response does not carry the new values: read them from the consumer.
api PATCH "$STAGED_ID_URL" '{ "command": "rotate" }' > /dev/null
write_current_credentials
[ "$(fp "$NEW_KEY")" != "$(fp "$OLD_KEY")" ] || echo "warning: the consumer key did not change" >&2
[ "$(fp "$NEW_SECRET")" != "$(fp "$OLD_SECRET")" ] || echo "warning: the consumer secret did not change" >&2
unset NEW_KEY NEW_SECRET
echo "rotated."
echo "Restart the app now (Ctrl+C, then npm run dev:tunnel)."
