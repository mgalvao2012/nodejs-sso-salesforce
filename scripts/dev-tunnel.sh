#!/usr/bin/env bash
# Starts a Cloudflare quick tunnel, points the NodeCrudEca Canvas URL and OAuth callback at its (new,
# random) URL, deploys that change and runs the app behind the tunnel. Ctrl+C stops app and tunnel.
#
#   npm run dev:tunnel                         # asks for confirmation before deploying
#   npm run dev:tunnel -- --yes                # deploy without asking
#   npm run dev:tunnel -- --no-deploy          # tunnel + app only (Salesforce keeps the old URL)
#   npm run dev:tunnel -- --target-org <alias> # default: $SF_TARGET_ORG or the target-org of salesforce/
#
# The tracked metadata is not modified: the URL is applied to a temporary copy that is deployed.
# The current URL is written to .dev/url.
set -euo pipefail

ORG=""
PORT=3000
YES=false
DEPLOY=true

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) YES=true ;;
    --no-deploy) DEPLOY=false ;;
    --target-org) ORG="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

for cmd in cloudflared sf jq node npm; do
  command -v "$cmd" >/dev/null || { echo "missing dependency: $cmd" >&2; exit 2; }
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SF_DIR="$ROOT/salesforce"
META="force-app/main/default"
DEV_DIR="$ROOT/.dev"
mkdir -p "$DEV_DIR"
# shellcheck source=lib/target-org.sh
. "$ROOT/scripts/lib/target-org.sh"
[ "$DEPLOY" = false ] || resolve_org "$SF_DIR"

# Metadata files that carry the Canvas URL / OAuth callback URL, and their deploy names.
FILES=(
  "extlClntAppCanvasSettings/NodeCrudEca_canvas.ecaCanvas-meta.xml"
  "extlClntAppGlobalOauthSets/NodeCrudEca_glbloauth.ecaGlblOauth-meta.xml"
)
COMPONENTS="ExtlClntAppCanvasSettings:NodeCrudEca_canvas, ExtlClntAppGlobalOauthSettings:NodeCrudEca_glbloauth"

TUNNEL_PID=""
TMP=""
cleanup() {
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  [ -n "$TMP" ] && rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT is already in use — stop the running app first." >&2
  exit 1
fi

echo "starting tunnel to https://localhost:$PORT ..."
cloudflared tunnel --no-autoupdate --url "https://localhost:$PORT" --no-tls-verify > "$DEV_DIR/tunnel.log" 2>&1 &
TUNNEL_PID=$!

URL=""
for _ in $(seq 1 30); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$DEV_DIR/tunnel.log" | head -1 || true)
  [ -n "$URL" ] && break
  kill -0 "$TUNNEL_PID" 2>/dev/null || { echo "tunnel exited, see $DEV_DIR/tunnel.log" >&2; exit 1; }
  sleep 1
done
[ -n "$URL" ] || { echo "no tunnel URL after 30s, see $DEV_DIR/tunnel.log" >&2; exit 1; }
echo "$URL" > "$DEV_DIR/url"
echo "tunnel URL: $URL"

if [ "$DEPLOY" = true ]; then
  TMP=$(mktemp -d "$SF_DIR/.devurl.XXXXXX")
  TMP_REL="${TMP#"$SF_DIR"/}"
  COPIES=()
  for f in "${FILES[@]}"; do
    mkdir -p "$TMP/$(dirname "$f")"
    cp "$SF_DIR/$META/$f" "$TMP/$f"
    COPIES+=("$TMP/$f")
  done
  node "$ROOT/scripts/set-canvas-url.js" "$URL" "${COPIES[@]}"

  ORG_INFO=$(sf org display --target-org "$ORG" --json 2>/dev/null | jq -r '.result | "\(.alias // "-") / \(.username) / \(.instanceUrl)"')
  echo
  echo "deploy to:   $ORG_INFO"
  echo "components:  $COMPONENTS"
  echo "new URL:     $URL/auth/canvas"
  if [ "$YES" != true ]; then
    answer=""
    read -r -p "Deploy this change to $ORG? [y/N] " answer || true
    case "$answer" in y|Y|yes|sim|s) ;; *) echo "deploy skipped; Salesforce still points to the previous URL." ; DEPLOY=false ;; esac
  fi
fi

if [ "$DEPLOY" = true ]; then
  echo "deploying..."
  (cd "$SF_DIR" && sf project deploy start --source-dir "$TMP_REL" --target-org "$ORG" --wait 30 --json) \
    > "$DEV_DIR/deploy.json" 2>/dev/null || true
  if [ "$(jq -r '.result.success // false' "$DEV_DIR/deploy.json")" != "true" ]; then
    echo "deploy failed:" >&2
    jq -r '.message // "unknown error (see .dev/deploy.json)"' "$DEV_DIR/deploy.json" >&2
    exit 1
  fi
  echo "deployed ($(jq -r '.result.id' "$DEV_DIR/deploy.json")): Salesforce now points to $URL"
fi

echo "starting app (TRUST_PROXY=1) — Ctrl+C stops app and tunnel"
cd "$ROOT"
TRUST_PROXY=1 npm run dev
