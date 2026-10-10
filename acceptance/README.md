# Script-based acceptance tests

Acceptance checks are deterministic Bash scripts, independent of the agent's review.
They can run application tests, Puppeteer/browser checks, API checks, or load and
performance benchmarks. A script's exit code decides the result; an LLM does not
interpret the logs to decide whether it passed.

## Define a suite

Copy `suite.example.json` to `suite.json`, then create the scripts it references.
The format is JSON with `version: 1` and a nonempty `tests` array. Each test has:

| Field | Meaning |
| --- | --- |
| `name` | Unique test name shown in feedback. |
| `script` | Bash script path relative to the manifest directory, within that directory. |
| `timeout_seconds` | Optional timeout, 1–3600 seconds; defaults to 300. |
| `feedback` | Required fallback message returned when the script fails. |

Scripts run sequentially with Bash's `errexit` and `pipefail` enabled. Each runs
from the candidate project directory. Exit `0` to pass; any other exit code or a
timeout fails. All tests run even if an earlier check fails. Invalid configuration
or an empty suite fails closed.

The runner sets these environment variables:

- `OPENPEARL_PROJECT_DIR`: absolute path to the candidate checkout.
- `OPENPEARL_SUITE_DIR`: absolute path to the manifest directory.
- `OPENPEARL_FEEDBACK_FILE`: writable file for a custom failure message.
- `CI=true`, `PATH`, and `HOME`. Workflow secrets are not passed to scripts.

For example, a test can support npm and provide a purpose-written message:

```bash
#!/usr/bin/env bash
if ! { npm ci --ignore-scripts && npm test; }; then
  cat > "$OPENPEARL_FEEDBACK_FILE" <<'MESSAGE'
The application's regression tests failed. Check the changed behavior against
the public API contract and handle invalid and empty inputs consistently.
MESSAGE
  exit 1
fi
```

A benchmark can generate measured, actionable feedback without revealing its
workload. This example assumes the suite supplies a benchmark program that
prints an integer latency in milliseconds:

```bash
#!/usr/bin/env bash
latency=$(python3 "$OPENPEARL_SUITE_DIR/benchmark.py" "$OPENPEARL_PROJECT_DIR")
if (( latency > 200 )); then
  printf 'Latency was %s ms; the allowed budget is 200 ms. Investigate request handling under concurrent load.\n' \
    "$latency" > "$OPENPEARL_FEEDBACK_FILE"
  exit 1
fi
```

The custom file replaces the fallback message when nonempty. It is limited to
12,000 characters. Passing tests return no failure feedback. Stdout and stderr
are **never automatically included** in the agent's feedback.

Scripts own dependency installation, build steps, server startup, readiness
checks, and benchmark assertions. Use `trap` for cleanup; the runner also kills
processes remaining in the script's process group after completion or timeout.
The Actions runner has Python, Bash, Node, and the usual Ubuntu tools; install any
extra tools your checks need inside the scripts. Browser harnesses and their
fixtures can live alongside the scripts in the suite directory.

## Run locally

Requires Python 3.9+ and Bash on Linux:

```sh
python3 .github/workflows/scripts/acceptance.py /path/to/tests/acceptance/suite.json \
  --project /path/to/project --output /tmp/acceptance-results
```

Exit `0` means all checks passed; exit `1` means a test or infrastructure failure.
The output directory contains `result.json`, `feedback.md`, and a separate
`test-N.log` file with each script's combined stdout/stderr. Feedback is also
printed to the console. Use a fresh output directory for each local run.

## Enable in OpenPearl

Copy the entire `.github/workflows/` directory, including `scripts/` and
`acceptance.yml`, into the project and commit it to the default branch. Then set
these repository variables under **Settings → Secrets and variables → Actions**:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ACCEPTANCE_ENABLED` | disabled | Set to `1` to require acceptance checks before merging. |
| `ACCEPTANCE_FIX_ROUNDS` | `1` | Number of fix-and-retest attempts, from `0` to `3`. |
| `ACCEPTANCE_REPOSITORY` | current repository | Optional separate suite repository, e.g. `your-org/private-acceptance`. |
| `ACCEPTANCE_REF` | `main` | Ref of the external suite; use a commit SHA to pin the benchmark version. |
| `ACCEPTANCE_MANIFEST` | `acceptance/suite.json` | Manifest path relative to the suite repository root. |

For a private external repository, add an **`ACCEPTANCE_TOKEN` secret** with
read-only Contents access to that repository. It is used only by checkout in the
separate acceptance job, is not persisted in Git configuration, and is not given
to the coding agent or scripts. Public external suites also need a token if the
default job token cannot access them.

Local suites are loaded from the default branch, never from the candidate branch.
An external suite is checked out only in the acceptance job. It is absent from
the coding agent's workspace, and the workflow does not give the agent credentials
to modify the external repository. To keep benchmark implementation and fixtures
out of the agent's context, use a private external repository and return only the
diagnostics needed to fix the application.

After review and conflict resolution, OpenPearl dispatches `acceptance.yml` on the
default branch for the exact candidate commit. The workflow runs on a separate,
fresh runner with no coding agent. The caller downloads only the result and
custom feedback, posts it on the PR, and gives failures to the agent for a bounded
fix loop. Every fix is committed and pushed before a fresh acceptance run.
Missing results, workflow failures, or exhausted attempts prevent auto-merge,
including when `AUTO_MERGE=1`. Infrastructure failures do not trigger code fixes.
`ACCEPTANCE_ENABLED` must be explicitly enabled; a missing manifest then fails.

The caller needs `actions: write` permission to dispatch the workflow. If using
`PUSH_TOKEN`, give that token Actions read/write access as well. Dispatching works
with the built-in `GITHUB_TOKEN`; it does not rely on pushes triggering CI.

## Retained logs

Each acceptance run uploads two artifacts:

- **`acceptance-result`**: `result.json` and `feedback.md`, downloaded by the caller.
- **`acceptance-logs`**: full combined stdout/stderr files for debugging, not
  automatically downloaded or passed to the agent.

Both artifacts are retained for 14 days (change `retention-days` in
`acceptance.yml` as needed, within your repository's limit). GitHub also retains
the workflow's own job logs according to repository settings. Find the run under
**Actions → Acceptance tests**, with the request ID matching the parent run ID,
run attempt, and acceptance attempt. Download artifacts from that run's page.

The separate job isolates the test suite from the coding agent's filesystem; it
does not sandbox the application from its test harness. Candidate code runs on
the acceptance runner, so avoid putting secrets into test fixtures or feedback.
