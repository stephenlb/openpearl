#!/usr/bin/env bash
# Usage: tenant-check.sh <trusted-dir> <candidate-dir> <git-dir|""> <tenant> <slug> <report-dir>
# Runs the trusted merge gates and isolation harness against the candidate's
# uncommitted changes, plus any committed acceptance spec as a regression suite.
# Writes gates.json, isolation.json and regression.json; exits non-zero on any failure.
# Call with a scrubbed environment (env -i): candidate code must never see secrets.
set -uo pipefail
trusted=$1 candidate=$2 gitdir=$3 tenant=$4 slug=$5 out=$6
mkdir -p "$out"
if [ -n "$gitdir" ]; then export GIT_DIR="$gitdir" GIT_WORK_TREE="$candidate"; fi
status=0
node "$trusted/framework/gates.js" --tenant "$tenant" --slug "$slug" --base HEAD --repo "$candidate" --out "$out/gates.json" > /dev/null || status=1
ext="$candidate/tenants/$tenant/extensions/$slug"
if [ "$status" = 0 ]; then
  node "$trusted/isolation/run.js" --tenant "$tenant" --dir "$ext" --out "$out/isolation.json" > /dev/null || status=1
  # Regression: the acceptance cases committed with earlier versions (from the trusted tree) must still pass
  regression="$trusted/tenants/$tenant/extensions/$slug/acceptance.json"
  if [ -f "$regression" ]; then
    node "$trusted/isolation/spec-run.js" --tenant "$tenant" --dir "$ext" --spec "$regression" --out "$out/regression.json" > /dev/null || status=1
  fi
else
  echo '{"status":"skipped","reason":"gates failed"}' > "$out/isolation.json"
fi
cat "$out/gates.json" "$out/isolation.json" "$out/regression.json" 2>/dev/null | head -c 20000
exit $status
