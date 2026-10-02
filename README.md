<p align="center">
  <img width="1032" alt="OpenPearl logo" src="https://github.com/user-attachments/assets/cb83af86-9dfa-4cb7-a980-060fca3cc293" />
</p>

# OpenPearl

Ticket to Auto-merge. Software delivery pipeline. Read tickets, implements, PR, Code Review, Auto-merge and deploy or human to merge when needed.

## Setup

The workflow in `.github/workflows/issue-to-pr.yml` runs when an issue is opened by an owner, member, or collaborator. Claude Code implements the issue, opens a PR, runs two review/fix rounds, then runs the eval in `.github/workflows/evals/pr-ready-to-merge.md`. If Claude answers `YES` the PR is squash-merged automatically and the issue gets a "PR Auto-Merged: …" comment; anything else leaves it open for a human and the issue gets a "PR Ready for Review: …" comment.

Enable **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**.

Images attached to the issue body (GitHub uploads) are downloaded and made available to Claude, which can view them while implementing.

Configure one of the two providers below under **Settings → Secrets and variables → Actions** (as secrets).

### Option A: Anthropic API

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Secret | Yes | Anthropic API key. |

### Option B: Amazon Bedrock

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `CLAUDE_CODE_USE_BEDROCK` | Secret | Yes | Set to `1` to make the Claude Code CLI use Bedrock. |
| `AWS_BEARER_TOKEN_BEDROCK` | Secret | Yes | Bedrock API key. |
| `AWS_REGION` | Secret | Yes | Region with Claude model access, e.g. `us-east-1`. |
| `ANTHROPIC_MODEL` | Secret | No | Bedrock model ID or inference profile, e.g. `us.anthropic.claude-sonnet-4-5-20250929-v1:0`. |
| `ANTHROPIC_SMALL_FAST_MODEL` | Secret | No | Model used for background tasks. |

Model access must be enabled in the Bedrock console for the chosen region. If you leave `ANTHROPIC_MODEL` unset, Claude Code uses its default model ID, which must be available in your account.

### GitHub token (optional)

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `PUSH_TOKEN` | Secret | No | Fine-grained PAT (or GitHub App token) for this repo with read/write on **Contents**, **Pull requests**, **Issues**, and **Workflows**. |

Without `PUSH_TOKEN` the workflow falls back to the built-in `GITHUB_TOKEN`, which can modify normal repo files but cannot push changes to `.github/workflows/` and does not trigger CI on the PRs it opens. Set `PUSH_TOKEN` to allow both, so issues can also modify the pipeline itself. Comments and PRs are attributed to the token's owner.

Because this token can edit workflows and the run is started by issue text, keep the trusted-author check (`author_association`) in the workflow and review PRs before merging.

### Jira tickets (optional)

`.github/workflows/jira-to-issue.yml` polls Jira every 10 minutes (or on manual dispatch) for tickets in the listed projects whose status category is "To Do". For each one it creates a GitHub issue titled `[BLOCKS-475] <summary>` (which starts the normal issue-to-PR flow), comments on the Jira ticket with the issue link, and transitions the ticket to "In Progress". Issues carry a hidden `jira-key` marker so a ticket is never imported twice.

`.github/workflows/issue-comment-to-jira.yml` copies comments added to those GitHub issues (by owners, members, or collaborators) onto the original Jira ticket.

Create an API token at <https://id.atlassian.com/manage-profile/security/api-tokens> for a Jira user that can browse, comment on, and transition tickets in the projects.

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `JIRA_BASE_URL` | Secret | Yes | Jira site URL, e.g. `https://pubnub.atlassian.net`. |
| `JIRA_EMAIL` | Secret | Yes | Email of the Atlassian user that owns the API token. |
| `JIRA_API_TOKEN` | Secret | Yes | Atlassian API token. |
| `JIRA_PROJECTS` | Variable | Yes | Comma separated project keys to watch, e.g. `BLOCKS,PLAT`. |
| `JIRA_IN_PROGRESS_STATUS` | Variable | No | Transition name applied to imported tickets. Defaults to `In Progress`. |
| `PUSH_TOKEN` | Secret | Yes | See below; required so issues and comments created by the pipeline trigger workflows. |

Notes:

- Every ticket already in a "To Do" status category is imported (10 per run), so move backlog tickets elsewhere before enabling.
- Events created with the built-in `GITHUB_TOKEN` do not trigger workflows, so `PUSH_TOKEN` is required for Jira imports and for the pipeline's own status comments to be mirrored to Jira.
- If the project's workflow has no transition matching `JIRA_IN_PROGRESS_STATUS`, the ticket stays in "To Do" and a warning is logged; it is not imported twice.

### License

Apache 2.0
