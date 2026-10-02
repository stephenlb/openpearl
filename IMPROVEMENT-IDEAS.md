# Improvement ideas

Ideas for improving the OpenPearl workflow (`.github/workflows/issue-to-pr.yml`).

## Quality

- **Run the project's tests in CI before the eval.** Feed the real pass/fail result to the eval gate instead of relying on Claude's judgment that tests "don't appear to fail".
- **Use a separate reviewer context.** Run review rounds with a fresh session (or a different model) so the reviewer isn't anchored by the implementer's reasoning.
- **Ground the eval in evidence.** Pass the test output, linter output, and diff stats to the eval, and require it to cite them in its justification.
- **Diff-size guardrails.** Automatically hand off to a human when the diff exceeds a line or file threshold, or touches sensitive paths (`.github/workflows`, auth, secrets, dependency manifests).
- **Clarify before coding.** If the issue is ambiguous, have Claude post clarifying questions and wait, instead of guessing.

## Reliability

- **Retry transient failures.** Retry the Claude CLI steps on API errors or rate limits, with backoff/
- **Resume on re-run.** Reuse the existing branch and PR if the workflow is triggered again for the same issue.

## Feedback loop

- **Re-run on PR feedback.** When a human comments on or requests changes to the PR, have Claude address it and push.
- **React to CI failures.** Feed failing check logs back to Claude for a fix round before the eval.
- **Track outcomes.** Log auto-merge vs. handed-off rates, and whether auto-merged PRs are later reverted, to tune the eval's strictness.
- **Label PRs.** Apply labels such as `auto-merged` / `needs-human` for easy filtering.

## Developer experience

- **Project-specific guidance.** Read a `CLAUDE.md`/`AGENTS.md` if it exists for conventions, and allow per-repo customization of the eval criteria.
- **Richer summaries.** Include in the issue comment what was changed, what the review rounds found, and why the eval answered NO.
- **Dry-run mode.** A label that makes the workflow open the PR but never auto-merge.
- **Configurable rounds.** Make the number of review/fix rounds an input or repo variable instead of fixed at two.
