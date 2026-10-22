#!/usr/bin/env bash
# Sets the public HTTPS origin of the app in the tracked Salesforce metadata (Canvas URL and OAuth callback
# of NodeCrudEca). Use it for a stable URL (hosting); for quick tunnels use npm run dev:tunnel instead.
#
#   npm run set-app-url -- https://node-crud.example.com
set -euo pipefail

[ $# -eq 1 ] || { sed -n '2,5p' "$0"; exit 2; }
ROOT=$(cd "$(dirname "$0")/.." && pwd)
META="$ROOT/salesforce/force-app/main/default"
node "$ROOT/scripts/set-canvas-url.js" "$1" \
  "$META/extlClntAppCanvasSettings/NodeCrudEca_canvas.ecaCanvas-meta.xml" \
  "$META/extlClntAppGlobalOauthSets/NodeCrudEca_glbloauth.ecaGlblOauth-meta.xml"
echo "metadata now points to $1/auth/canvas — deploy salesforce/ to apply it."
