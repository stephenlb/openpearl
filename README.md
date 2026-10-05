<p align="center">
  <img width="1024" alt="OpenPearl logo" src="https://github.com/user-attachments/assets/98dd96ba-9c18-4794-8a8c-664a349a3c71" />
</p>

<p align="center">
  <a href="https://discord.gg/mygDNrQ7DJ"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20the%20chat-5865F2?logo=discord&logoColor=white" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/openpearl/openpearl" /></a>
</p>

# OpenPearl

_For simple quick tasks, an AI workflow can handle it._

From ticket to auto-merge. Minimal GitHub workflow. OpenPearl reads a ticket, implements it, opens a PR, reviews it in a loop and auto-merges. If it isn't confident, it hands the PR to a human.

## How it works

When an owner, member, or collaborator opens an issue, `.github/workflows/issue-to-pr.yml` runs:

1. The agent (Claude Code by default; OpenCode or Codex optional) implements the issue and opens a PR.
2. The agent CLI (Claude by default) runs two review/fix rounds, confirming after each fix that every finding was addressed.
3. The agent CLI runs the eval in `.github/workflows/evals/pr-ready-to-merge.md`.
   - `YES`: the PR is squash-merged and the issue gets a "PR Auto-Merged: …" comment.
   - Anything else: the PR stays open for a human and the issue gets a "PR Ready for Review: …" comment.

To add or change evals, see [EVALS.md](EVALS.md).

Images attached to the issue are downloaded so Claude can view them.

## PR comment chat

`.github/workflows/pr-comment-chat.yml` lets you talk to the agent on a PR. When an owner, member, or collaborator comments on an open PR (a regular comment or an inline review comment), the agent evaluates it:

- Questions and discussion get a reply comment.
- Change requests are implemented, committed and pushed to the PR branch, and the reply says what changed.

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

## Optional: OpenCode or Codex

Claude Code is the default agent. To use another CLI, set the `AGENT_CLI` repository variable to `opencode` or `codex` and follow [OPENCODE.md](OPENCODE.md) or [CODEX.md](CODEX.md).

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

## License

Apache 2.0
