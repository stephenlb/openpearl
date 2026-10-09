#!/usr/bin/env bash
# Run on the agent job; only the separate acceptance job sees test code/logs.
set -euo pipefail
sha=$1
request=$2
output=$3
mkdir -p "$output"
gh workflow run acceptance.yml --ref "$BASE" -f sha="$sha" -f request_id="$request"
deadline=$((SECONDS + 2100))
run_id=""
while [ "$SECONDS" -lt "$deadline" ]; do
  if [ -z "$run_id" ]; then
    run_id=$(gh run list --workflow acceptance.yml --event workflow_dispatch --limit 100 \
      --json databaseId,displayTitle --jq ".[] | select(.displayTitle == \"acceptance-$request\") | .databaseId")
  fi
  if [ -n "$run_id" ]; then
    state=$(gh run view "$run_id" --json status --jq .status)
    if [ "$state" = completed ]; then
      gh run download "$run_id" --name acceptance-result --dir "$output"
      conclusion=$(gh run view "$run_id" --json conclusion --jq .conclusion)
      # Never turn missing/malformed feedback into a passing verdict.
      python3 - "$output/result.json" "$sha" "$conclusion" <<'PY'
import json, sys
result = json.load(open(sys.argv[1]))
if result["sha"] != sys.argv[2]:
    raise ValueError("Acceptance result does not match candidate")
sys.exit(0 if result["status"] == "pass" and sys.argv[3] == "success" else 1)
PY
      exit $?
    fi
  fi
  sleep 10
done
echo "Acceptance workflow did not finish within 35 minutes." >&2
exit 1
