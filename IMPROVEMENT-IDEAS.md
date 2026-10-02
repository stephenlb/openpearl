# Improvement ideas

Ideas for improving the OpenPearl workflow (`.github/workflows/issue-to-pr.yml`).

## Implemented

- **Project tests before the eval.** The `Run project tests` step runs `npm test` when a test script exists; failing tests block auto-merge and the results are given to the eval.
- **Grounded eval.** The eval receives test output and diff stats and must cite its evidence.
- **Diff-size and sensitive-path guardrails.** Auto-merge is blocked above `MAX_DIFF_FILES` / `MAX_DIFF_LINES` (repo variables, default 20 / 500) or when the diff touches `.github/`, auth/secrets paths, or dependency manifests.
- **Retry transient failures.** All Claude CLI calls go through `claude-retry` (3 attempts with backoff).
- **Label PRs.** `auto-merged` / `needs-human` labels are applied.
- **Project guidance.** Prompts tell Claude to follow `CLAUDE.md` / `AGENTS.md`; `.github/evals-extra.md` adds per-repo eval criteria.
- **Richer summaries.** The final issue comment lists review-round results and test status; a `NO` verdict includes the eval's reasoning.
- **Dry-run mode.** Label an issue `dry-run` to open the PR without auto-merging.
- **Configurable rounds.** Set the `REVIEW_ROUNDS` repo variable (default 2).

## Not yet implemented

- **Use a separate reviewer context or model.** Review rounds already run in fresh sessions; using a different model is still open.
- **Clarify before coding.** If the issue is ambiguous, post clarifying questions and wait.
- **Resume on re-run.** Reuse the existing branch and PR if the workflow is triggered again for the same issue.
- **Re-run on PR feedback.** Address human comments or change requests on the PR.
- **React to CI failures.** Feed failing check logs back to Claude for a fix round before the eval.
- **Track outcomes over time.** Outcomes are logged per run; aggregating them and detecting later reverts is still open.
