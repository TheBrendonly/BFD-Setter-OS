#!/usr/bin/env bash
# One-off: deploy the security-review edge-function fixes (2026-06-05).
# All target functions are currently verify_jwt=false in prod, so deploy each
# with --no-verify-jwt to preserve that (the in-function authorizeClientRequest
# guard is what now enforces auth). Logs per-function PASS/FAIL.
set -u
cd "$(dirname "$0")/../frontend" || exit 1
set -a; . ../.env 2>/dev/null; set +a
export SUPABASE_ACCESS_TOKEN="$SUPABASE_PAT"
REF=bjgrgbgykvjrsuwwruoh
SUPA="npx -y supabase@2.105.0"

# Changed function slugs (from git diff at run time).
mapfile -t FNS < <(cd .. && git diff --name-only -- 'frontend/supabase/functions/*/index.ts' \
  | sed -E 's#.*/functions/([^/]+)/index.ts#\1#' | sort -u)

echo "Deploying ${#FNS[@]} functions to $REF ..."
pass=0; fail=0; failed=()
for fn in "${FNS[@]}"; do
  echo "----- deploy $fn -----"
  if timeout 150 $SUPA functions deploy "$fn" --project-ref "$REF" --no-verify-jwt --use-api >/tmp/deploy_"$fn".log 2>&1; then
    echo "PASS $fn"; pass=$((pass+1))
  else
    echo "FAIL $fn (see /tmp/deploy_$fn.log)"; tail -4 /tmp/deploy_"$fn".log; fail=$((fail+1)); failed+=("$fn")
  fi
done
echo "============================================"
echo "DONE: $pass passed, $fail failed"
[ "$fail" -gt 0 ] && printf 'FAILED: %s\n' "${failed[*]}"
