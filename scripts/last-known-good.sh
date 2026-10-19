#!/usr/bin/env bash
# Finds the most recent production deploy that passed its smoke test and
# recorded the Worker versions that were live afterwards (the
# last-good-deployment artifact deploy-production uploads). Prints one line
# and, under GitHub Actions, sets it as the step output `summary`. Never
# fails: it runs while a deploy is already failing.
set -uo pipefail

repo="${GITHUB_REPOSITORY:-}"
summary="No last known-good deployment record found (none uploaded yet, or all expired); find the last green deploy-production run by hand."

if [ -n "$repo" ]; then
  runs=$(gh run list --workflow deploy-production.yml --branch main --status completed \
    --limit "${LKG_RUN_LIMIT:-40}" --json databaseId --jq '.[].databaseId' 2>/dev/null || true)
  for run in $runs; do
    found=$(gh api "repos/$repo/actions/runs/$run/artifacts" \
      --jq '[.artifacts[] | select(.name == "last-good-deployment" and .expired == false)][0].id // empty' 2>/dev/null || true)
    [ -n "$found" ] || continue
    dir=$(mktemp -d)
    gh run download "$run" --name last-good-deployment --dir "$dir" >/dev/null 2>&1 || continue
    record="$dir/last-good-deployment.json"
    [ -f "$record" ] || continue
    line=$(jq -r '"commit \(.sha) (run \(.run_id), smoke-passed \(.recorded_at)), Worker versions \(.versions | tostring)"' "$record" 2>/dev/null || true)
    [ -n "$line" ] || continue
    summary="Last known-good deployment: $line. Cloudflare expires old Worker versions, so a rollback to them can fail with 4xx; the durable fix is a revert or fix on main."
    break
  done
fi

echo "$summary"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "summary=$summary" >> "$GITHUB_OUTPUT"
fi
exit 0
