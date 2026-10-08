<p align="center">
  <img width="1024" alt="OpenPearl logo" src="docs/openpearl.jpg" />
</p>

<p align="center">
  <a href="https://discord.gg/mygDNrQ7DJ"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20the%20chat-5865F2?logo=discord&logoColor=white" /></a>
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" /></a>
</p>

# OpenPearl

_Ticket in, merged PR out. A tiny robot night shift for your GitHub repo._

Open source under the [Apache License 2.0](LICENSE).

The small stuff? Let the little robot handle it while you get a drink from the vending machine.

**OPEN 24/7 · NO SLEEP · TINY WORKFLOW · AUTO-MERGE**

OpenPearl reads a ticket, implements it, opens a PR, reviews it in a loop and auto-merges. All as a GitHub workflow. If it isn't confident, it waves politely and hands the PR to a human. Seamlessly integrates into your existing CI/CD.

## Why not a pile of markdown files?

Instead of piling instructions into markdown files (`CLAUDE.md`, `AGENTS.md`, rules and memory docs) that get loaded into the agent's context on every run, OpenPearl uses workflow orchestration and evals. The workflow drives each step (implement, review, fix, merge) as a separate, focused agent call, and evals decide whether a PR is ready to merge. Context isn't consumed by standing instructions, so the agent keeps its context for the actual task.

## How the night shift works

When an owner, member, or collaborator opens an issue, `.github/workflows/issue-to-pr.yml` runs:

1. The agent (Claude Code by default; OpenCode, Codex, or Pi optional) implements the issue and opens a PR.
2. The agent CLI (Claude by default) runs two review/fix rounds, confirming after each fix that every finding was addressed.
3. The agent CLI runs the eval in `.github/workflows/evals/pr-ready-to-merge.md`.
   - `YES`: the PR is squash-merged and the issue gets a "PR Auto-Merged: …" comment.
   - Anything else: the PR stays open for a human and the issue gets a "PR Ready for Review: …" comment.

Set the `AUTO_MERGE` repo variable to `1` to always merge: the eval and all its guards (protected paths, diff size, project tests) are skipped, so even changes to workflows or auth files merge without review, and the PR is squash-merged once required checks pass. The `dry-run` label still prevents merging.

To add or change evals, see [Evals](#evals).

Images attached to the issue are downloaded so Claude can view them.

## Drop tickets in the slot (`gh`)

Install the [GitHub CLI](https://cli.github.com/) and run `gh auth login` once.

```sh

gh issue create                     # interactive: prompts for title and body

gh issue create -t "Add dark mode toggle" -b "Add a toggle to the settings page."  # starts the pipeline
gh issue create --title "Add dark mode toggle" --body "Add a toggle to the settings page."  # starts the pipeline
gh issue create --title "Try a change" --label dry-run  # run the pipeline without merging
gh issue list                       # open issues
gh issue view 123 --comments        # read an issue with comments
gh issue comment 123 --body "Also handle the empty state."
gh issue close 123
gh pr list                          # PRs opened by the pipeline
gh pr view 456 --comments           # read a PR and its comments
gh pr comment 456 --body "Please also add a test."  # chat with the agent on a PR
gh run watch                        # follow the pipeline live
```

To attach an image, `gh` can't upload files, so commit it with `gh api` and link it:

```sh
gh api -X PUT repos/{owner}/{repo}/contents/issue-assets/shot.png \
  -f message="Add shot.png" -f content="$(base64 < shot.png | tr -d '\n')"
gh issue create -t "Button is misaligned" \
  -b "![shot](https://github.com/{owner}/{repo}/blob/HEAD/issue-assets/shot.png?raw=true)"
```

Replace `{owner}/{repo}` in the issue body with your repo (`gh api` fills it in on its own). You can also drag an image into the issue on github.com.

## Comment chat

`.github/workflows/pr-comment-chat.yml` lets you keep talking to the agent after an issue or PR is created. When an owner, member, or collaborator comments on an issue, or on an open PR (a regular comment or an inline review comment), the agent evaluates it:

- Questions and discussion get a reply comment.
- Change requests are implemented, committed and pushed to the PR branch, and the reply says what changed.
- On an issue, changes go to the open PR for that issue (the one with `Closes #N`); if there is none, a new branch and PR are opened.

PRs from forks are ignored, as are bot comments and the pipeline's own comments (they carry a hidden `<!-- openpearl -->` marker). The reply is posted with `PUSH_TOKEN` if set, so set it if you want replies to be attributed to that account. Pushes made with the built-in `GITHUB_TOKEN` don't trigger CI.

## Setup

1. Copy the `.github/workflows/` directory (the workflow files and the `evals/` folder) from this repository into the root of your own project, then commit and push it. Only copy the Jira and Trello workflows if you use those integrations.
2. Enable **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**.
3. Add the secrets for one provider below under **Settings → Secrets and variables → Actions**.

### Option A: Anthropic API

| Name | Required | Description |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key. |

### Option B: Amazon Bedrock

| Name | Required | Description |
| --- | --- | --- |
| `CLAUDE_CODE_USE_BEDROCK` | Yes | Set to `1` to use Bedrock. |
| `AWS_BEARER_TOKEN_BEDROCK` | Yes | Bedrock API key. |
| `AWS_REGION` | Yes | Region with Claude model access, e.g. `us-east-1`. |
| `ANTHROPIC_MODEL` | No | Model ID or inference profile, e.g. `us.anthropic.claude-sonnet-4-5-20250929-v1:0`. |
| `ANTHROPIC_SMALL_FAST_MODEL` | No | Model for background tasks. |

Enable model access in the Bedrock console for your region. If `ANTHROPIC_MODEL` is unset, Claude Code's default model must be available in your account.

All values above are stored as secrets.

## Optional: OpenCode, Codex, or Pi

Claude Code is the default agent. To use another CLI, set the `AGENT_CLI` repository variable to `opencode`, `codex`, or `pi` and follow the matching section below. To go back to Claude Code, delete the `AGENT_CLI` variable or set it to `claude`.

### Using OpenCode

Run the OpenPearl workflow with the [OpenCode](https://opencode.ai) CLI instead of Claude Code.

1. Follow the base [Setup](#setup) (enable PR creation for Actions, optional `PUSH_TOKEN`).
2. Set the repository variable **`AGENT_CLI`** to `opencode` under **Settings → Secrets and variables → Actions → Variables**.
3. Add credentials for the provider of the model you want, as secrets:

   | Provider | Secret |
   | --- | --- |
   | Anthropic | `ANTHROPIC_API_KEY` |
   | OpenAI | `OPENAI_API_KEY` |
   | Amazon Bedrock | `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION` |

4. Add the secret **`AGENT_MODEL`** in OpenCode's `provider/model` format, e.g. `anthropic/claude-sonnet-4-5` or `openai/gpt-5`. If unset, OpenCode uses its default model for the credentials it finds.

The workflow installs `opencode-ai` from npm and runs `opencode run "<prompt>"`. Permissions are passed through the `OPENCODE_PERMISSION` environment variable:

- Implement and fix steps: edits and shell commands allowed, web fetch denied.
- Review, summary, and eval steps: edits denied; only `git diff`, `git log`, and `git status` are allowed.

Notes:

- The max-turns limit used with Claude Code is not applied; the job's 60-minute timeout still bounds a run.
- Edit `.github/workflows/issue-to-pr.yml` (the `agent-retry` wrapper) to change flags or permissions.

### Using Codex

Run the OpenPearl workflow with the [OpenAI Codex CLI](https://github.com/openai/codex) instead of Claude Code.

1. Follow the base [Setup](#setup) (enable PR creation for Actions, optional `PUSH_TOKEN`).
2. Set the repository variable **`AGENT_CLI`** to `codex` under **Settings → Secrets and variables → Actions → Variables**.
3. Add the secret **`OPENAI_API_KEY`** with your OpenAI API key.
4. Optionally add the secret **`AGENT_MODEL`** (e.g. `gpt-6.1-sol`). If unset, Codex uses its default model.

The workflow installs `@openai/codex` from npm and runs `codex exec`, capturing the final message with `--output-last-message`. Permissions map to Codex sandbox modes:

- Implement and fix steps: `--sandbox workspace-write` (edits inside the checkout; network access is off by default, so commands like `npm install` may fail).
- Review, summary, and eval steps: `--sandbox read-only`.

Notes:

- The max-turns limit used with Claude Code is not applied; the job's 60-minute timeout still bounds a run.
- Codex reads an `AGENTS.md` in the repository root for conventions, if one exists.
- Edit `.github/workflows/issue-to-pr.yml` (the `agent-retry` wrapper) to change flags or sandbox modes.

### Using Pi

Run the OpenPearl workflow with the [Pi](https://github.com/badlogic/pi-mono) coding agent instead of Claude Code.

1. Follow the base [Setup](#setup) (enable PR creation for Actions, optional `PUSH_TOKEN`).
2. Set the repository variable **`AGENT_CLI`** to `pi` under **Settings → Secrets and variables → Actions → Variables**.
3. Add credentials for your provider as secrets (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`).
4. Optionally add the secret **`AGENT_MODEL`** (e.g. `anthropic/claude-sonnet-4-5`). If unset, Pi uses its default model for the credentials it finds.

The workflow installs `@mariozechner/pi-coding-agent` from npm and runs `pi -p "<prompt>"`. Pi has no permission system, so access is limited through its tool list:

- Implement and fix steps: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`.
- Review, summary, and eval steps: read-only tools (`read`, `grep`, `find`, `ls`); no shell.

Notes:

- The max-turns limit used with Claude Code is not applied; the job's 60-minute timeout still bounds a run.
- Bash commands in edit steps are not restricted to an allowlist.
- Edit `.github/workflows/issue-to-pr.yml` (the `agent-retry` wrapper) to change flags or tools.

## Optional: GitHub token

| Name | Required | Description |
| --- | --- | --- |
| `PUSH_TOKEN` | No | Fine-grained PAT or GitHub App token with read/write on **Contents**, **Pull requests**, **Issues**, and **Workflows**. |

Without `PUSH_TOKEN`, the workflow uses the built-in `GITHUB_TOKEN`. That token can't push to `.github/workflows/` and doesn't trigger CI on the PRs it opens. With `PUSH_TOKEN`, both work, so issues can also change the pipeline itself. Comments and PRs are attributed to the token's owner.

> **Security:** this token can edit workflows and runs are started by issue text. Keep the `author_association` check in the workflow and review PRs before merging.

## Optional: Jira

Two workflows connect Jira to the pipeline:

- `.github/workflows/jira-to-issue.yml` polls Jira every 10 minutes for "To Do" tickets in your projects. For each one it:
  - creates a GitHub issue titled `[BLOCKS-475] <summary>`, which starts the normal flow,
  - comments on the Jira ticket with the issue link,
  - moves the ticket to "In Progress".
- `.github/workflows/issue-comment-to-jira.yml` copies comments from owners, members, and collaborators on those issues back to the Jira ticket.

To set up, create an [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens) for a Jira user who can browse, comment on, and transition tickets in your projects. Then add:

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `JIRA_BASE_URL` | Secret | Yes | Jira site URL, e.g. `https://pubnub.atlassian.net`. |
| `JIRA_EMAIL` | Secret | Yes | Email of the user who owns the API token. |
| `JIRA_API_TOKEN` | Secret | Yes | Atlassian API token. |
| `JIRA_PROJECTS` | Variable | Yes | Comma-separated project keys, e.g. `BLOCKS,PLAT`. |
| `JIRA_IN_PROGRESS_STATUS` | Variable | No | Transition applied to imported tickets. Defaults to `In Progress`. |
| `PUSH_TOKEN` | Secret | Yes | See [GitHub token](#optional-github-token). Required so pipeline-created issues and comments trigger workflows. |

Polling is disabled by default (the workflow only runs on manual dispatch). To enable it, uncomment the `schedule` lines at the top of `jira-to-issue.yml` and commit to `main`.

Good to know:

- Every "To Do" ticket is imported (10 per run), so move backlog tickets elsewhere first.
- Built-in `GITHUB_TOKEN` events don't trigger workflows, which is why `PUSH_TOKEN` is required here.
- If no transition matches `JIRA_IN_PROGRESS_STATUS`, the ticket stays in "To Do" and a warning is logged. It won't be imported twice (issues carry a hidden `jira-key` marker).

### Adding tickets from the CLI

Create a ticket with `curl` using the same credentials as the workflow (the ticket must be in "To Do" to be imported):

```sh
export JIRA_BASE_URL=https://your-site.atlassian.net JIRA_EMAIL=you@example.com JIRA_API_TOKEN=...

curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" -X POST "$JIRA_BASE_URL/rest/api/3/issue" \
  -H "Content-Type: application/json" \
  -d '{"fields": {
        "project": {"key": "BLOCKS"},
        "issuetype": {"name": "Task"},
        "summary": "Add dark mode toggle",
        "description": {"type": "doc", "version": 1, "content": [
          {"type": "paragraph", "content": [{"type": "text", "text": "Add a toggle to the settings page."}]}]}
      }}'   # returns the new ticket key, e.g. BLOCKS-476
```

Or use [jira-cli](https://github.com/ankitpokhrel/jira-cli): `jira issue create -p BLOCKS -t Task -s "Add dark mode toggle" -b "Add a toggle to the settings page."`.

## Optional: Trello

`.github/workflows/trello-to-issue.yml` works like the Jira import. It polls a Trello list and, for each card, it:

- creates a GitHub issue titled `[shortLink] <card name>`, which starts the normal flow,
- comments on the card with the issue link,
- moves the card to your "In Progress" list.

To set up, get a Trello [API key and token](https://trello.com/power-ups/admin) for a user who can read, comment on, and move cards on the board. List IDs are visible at `https://api.trello.com/1/boards/<boardId>/lists?key=...&token=...`. Then add:

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `TRELLO_API_KEY` | Secret | Yes | Trello API key. |
| `TRELLO_TOKEN` | Secret | Yes | Trello API token. |
| `TRELLO_TODO_LIST_ID` | Variable | Yes | ID of the list to import cards from. |
| `TRELLO_IN_PROGRESS_LIST_ID` | Variable | Yes | ID of the list imported cards are moved to. |
| `PUSH_TOKEN` | Secret | Yes | See [GitHub token](#optional-github-token). |

Polling is disabled by default (the workflow only runs on manual dispatch). To enable it, uncomment the `schedule` lines at the top of `trello-to-issue.yml` and commit to `main`. Issues carry a hidden `trello-key` marker, so a card is never imported twice. Comments are not synced back to Trello.

### Adding cards from the CLI

Create a card in the "To Do" list with `curl` using the same credentials as the workflow:

```sh
export TRELLO_API_KEY=... TRELLO_TOKEN=... TRELLO_TODO_LIST_ID=...

curl -s -X POST "https://api.trello.com/1/cards" \
  --data-urlencode "idList=$TRELLO_TODO_LIST_ID" \
  --data-urlencode "name=Add dark mode toggle" \
  --data-urlencode "desc=Add a toggle to the settings page." \
  --data-urlencode "key=$TRELLO_API_KEY" \
  --data-urlencode "token=$TRELLO_TOKEN"   # returns the new card, including its shortLink
```

## Evals

An eval is a prompt file in `.github/workflows/evals/` that Claude runs inside `.github/workflows/issue-to-pr.yml` to make a decision. The only eval today is `pr-ready-to-merge.md`, which gates auto-merge. This section explains how to add another.

### How the existing eval works

The step **Eval - PR ready to auto-merge** in `issue-to-pr.yml`:

1. Writes the issue to `$RUNNER_TEMP/issue.md` and runs a final code review into `$RUNNER_TEMP/review-final.md`. Project test results (`tests.md`) and diff stats (`diffstat.md`) are also written there as evidence.
2. Applies deterministic guards first. The dry-run label always wins; otherwise the `AUTO_MERGE=1` repo variable forces a merge and bypasses every other guard and the eval (including the protected-paths, size and test-status checks). Without it, the guards are (dry-run label, diff touches sensitive paths such as `.github/`, auth/secrets or dependency manifests, diff larger than `MAX_DIFF_FILES`/`MAX_DIFF_LINES`, failing tests, final review not clean). If one fails, the verdict is `NO` and Claude is not called. Optional extra criteria in `.github/evals-extra.md` are appended to the eval prompt.
3. Otherwise runs `claude -p` with the eval file's contents plus the paths of the input files.
4. Reads the last non-empty line of the output. Only exactly `YES` passes; anything else, including a failed command, counts as `NO` (fail closed).
5. Posts the output as a PR comment and acts on the verdict.

### Adding a new eval

**1. Write the eval prompt.** Create `.github/workflows/evals/<name>.md`, named after the question it answers (for example `pr-has-adequate-tests.md`). Follow the structure of `pr-ready-to-merge.md`:

- A title that states the question.
- The inputs the eval receives (files, `git diff`, and so on).
- Explicit, numbered criteria for a passing answer.
- A default of `NO` when anything is uncertain.
- An exact output format: a short justification, then a final line that is exactly `YES` or `NO`.

Keep criteria objective and checkable. Vague criteria give inconsistent verdicts.

**2. Run it from the workflow.** In `issue-to-pr.yml`, add a step (or extend the eval step) that passes the file to Claude along with the inputs it needs:

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

**3. Use the verdict.** Decide what the verdict controls. To make a new eval a merge requirement, combine it with the existing verdict so that both must be `YES` before `gh pr merge` runs. To make it informational, only post the comment.

**4. Test and document.**

- Changes under `.github/` are never auto-merged, so a human reviews the PR that adds the eval.
- `GITHUB_TOKEN` can't push to `.github/workflows/`. Set up `PUSH_TOKEN` (see [GitHub token](#optional-github-token)) if you want the pipeline to make this change itself.
- Try the eval on a test issue and read the PR comment to check that the verdict and reasoning make sense. Also try a case that should fail.
- Mention the new eval in [How the night shift works](#how-the-night-shift-works).

## License

Apache 2.0
