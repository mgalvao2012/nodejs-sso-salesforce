# Sourced by the scripts in scripts/. Resolves the Salesforce target org into $ORG:
# --target-org (already in $ORG) > $SF_TARGET_ORG > target-org configured in salesforce/ (sf config set target-org).
resolve_org() {
  local sf_dir=$1
  [ -n "${ORG:-}" ] && return 0
  ORG=${SF_TARGET_ORG:-$(cd "$sf_dir" && sf config get target-org --json 2>/dev/null | jq -r '.result[0].value // empty')}
  if [ -z "$ORG" ]; then
    echo "no target org: pass --target-org <alias>, set SF_TARGET_ORG, or run 'sf config set target-org <alias>' in salesforce/" >&2
    exit 2
  fi
}
