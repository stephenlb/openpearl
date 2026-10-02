# Using OpenCode

Run the OpenPearl workflow with the [OpenCode](https://opencode.ai) CLI instead of Claude Code.

## Setup

1. Follow the base setup in [README.md](README.md) (enable PR creation for Actions, optional `PUSH_TOKEN`).
2. Set the repository variable **`AGENT_CLI`** to `opencode` under **Settings → Secrets and variables → Actions → Variables**.
3. Add credentials for the provider of the model you want, as secrets:

   | Provider | Secret |
   | --- | --- |
   | Anthropic | `ANTHROPIC_API_KEY` |
   | OpenAI | `OPENAI_API_KEY` |
   | Amazon Bedrock | `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION` |

4. Add the secret **`AGENT_MODEL`** in OpenCode's `provider/model` format, e.g. `anthropic/claude-sonnet-4-5` or `openai/gpt-5`. If unset, OpenCode uses its default model for the credentials it finds.

The workflow installs `opencode-ai` from npm and runs `opencode run "<prompt>"`.

## Permissions

Permissions are passed through the `OPENCODE_PERMISSION` environment variable:

- Implement and fix steps: edits and shell commands allowed, web fetch denied.
- Review, summary, and eval steps: edits denied; only `git diff`, `git log`, and `git status` are allowed.

## Notes

- The max-turns limit used with Claude Code is not applied; the job's 60-minute timeout still bounds a run.
- Edit `.github/workflows/issue-to-pr.yml` (the `agent-retry` wrapper) to change flags or permissions.
- To go back to Claude Code, delete the `AGENT_CLI` variable or set it to `claude`.
