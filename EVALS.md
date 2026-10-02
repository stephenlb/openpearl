# Evals

An eval is a prompt file in `.github/workflows/evals/` that Claude runs inside `.github/workflows/issue-to-pr.yml` to make a decision. The only eval today is `pr-ready-to-merge.md`, which gates auto-merge. This page explains how to add another.

## How the existing eval works

The step **Eval - PR ready to auto-merge** in `issue-to-pr.yml`:

1. Writes the issue to `$RUNNER_TEMP/issue.md` and runs a final code review into `$RUNNER_TEMP/review-final.md`. Project test results (`tests.md`) and diff stats (`diffstat.md`) are also written there as evidence.
2. Applies deterministic guards first (dry-run label, diff touches sensitive paths such as `.github/`, auth/secrets or dependency manifests, diff larger than `MAX_DIFF_FILES`/`MAX_DIFF_LINES`, failing tests, final review not clean). If one fails, the verdict is `NO` and Claude is not called. Optional extra criteria in `.github/evals-extra.md` are appended to the eval prompt.
3. Otherwise runs `claude -p` with the eval file's contents plus the paths of the input files.
4. Reads the last non-empty line of the output. Only exactly `YES` passes; anything else, including a failed command, counts as `NO` (fail closed).
5. Posts the output as a PR comment and acts on the verdict.

## Adding a new eval

### 1. Write the eval prompt

Create `.github/workflows/evals/<name>.md`, named after the question it answers (for example `pr-has-adequate-tests.md`). Follow the structure of `pr-ready-to-merge.md`:

- A title that states the question.
- The inputs the eval receives (files, `git diff`, and so on).
- Explicit, numbered criteria for a passing answer.
- A default of `NO` when anything is uncertain.
- An exact output format: a short justification, then a final line that is exactly `YES` or `NO`.

Keep criteria objective and checkable. Vague criteria give inconsistent verdicts.

### 2. Run it from the workflow

In `issue-to-pr.yml`, add a step (or extend the eval step) that passes the file to Claude along with the inputs it needs:

```bash
verdict=NO
if claude -p "$(cat .github/workflows/evals/<name>.md)

Base branch: origin/$BASE
Issue file: $RUNNER_TEMP/issue.md" \
  --allowedTools "$TOOLS_REVIEW,Read($RUNNER_TEMP/**)" \
  --max-turns 20 > "$RUNNER_TEMP/<name>.md"; then
  last=$(grep -v '^[[:space:]]*$' "$RUNNER_TEMP/<name>.md" | tail -n 1 | tr -d '[:space:]')
  [ "$last" = "YES" ] && verdict=YES
else
  echo "Eval command failed" > "$RUNNER_TEMP/<name>.md"
fi
```

Guidelines:

- Fail closed. Default the verdict to `NO` and set `YES` only on an exact match of the final line.
- Give Claude read-only tools (`$TOOLS_REVIEW`, plus `Read` on `$RUNNER_TEMP`) and a `--max-turns` limit.
- Put checks that can be done with plain shell (path filters, file counts) before the Claude call, as the existing step does. They are cheaper and can't be talked around.
- Post the eval output as a PR comment so reviewers can see the reasoning.

### 3. Use the verdict

Decide what the verdict controls. To make a new eval a merge requirement, combine it with the existing verdict so that both must be `YES` before `gh pr merge` runs. To make it informational, only post the comment.

### 4. Test and document

- Changes under `.github/` are never auto-merged, so a human reviews the PR that adds the eval.
- `GITHUB_TOKEN` can't push to `.github/workflows/`. Set up `PUSH_TOKEN` (see the [README](README.md#optional-github-token)) if you want the pipeline to make this change itself.
- Try the eval on a test issue and read the PR comment to check that the verdict and reasoning make sense. Also try a case that should fail.
- Mention the new eval in the [README](README.md#how-it-works).
