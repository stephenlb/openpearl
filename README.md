# OpenPerl

From Ticket to PR software delivery pipeline. Reads ticket, implements, PR, Code Review, Ready for human to merge.

## Setup

The workflow in `.github/workflows/issue-to-pr.yml` runs when an issue is opened by an owner, member, or collaborator. Claude Code implements the issue, opens a PR, runs two review/fix rounds, then comments "ready to go".

Enable **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**.

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

### GitHub token (required)

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `PUSH_TOKEN` | Secret | Yes | Fine-grained PAT (or GitHub App token) for this repo with read/write on **Contents**, **Pull requests**, **Issues**, and **Workflows**. |

The built-in `GITHUB_TOKEN` cannot push changes to `.github/workflows/`, so issues that modify the pipeline itself would fail. It also cannot trigger CI on the PRs it opens. `PUSH_TOKEN` fixes both. Comments and PRs are attributed to the token's owner.

Because this token can edit workflows and the run is started by issue text, keep the trusted-author check (`author_association`) in the workflow and review PRs before merging.

### License

Apache 2.0
