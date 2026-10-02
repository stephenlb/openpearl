# Using Codex

Run the OpenPearl workflow with the [OpenAI Codex CLI](https://github.com/openai/codex) instead of Claude Code.

## Setup

1. Follow the base setup in [README.md](README.md) (enable PR creation for Actions, optional `PUSH_TOKEN`).
2. Set the repository variable **`AGENT_CLI`** to `codex` under **Settings → Secrets and variables → Actions → Variables**.
3. Add the secret **`OPENAI_API_KEY`** with your OpenAI API key.
4. Optionally add the secret **`AGENT_MODEL`** (e.g. `gpt-5-codex`). If unset, Codex uses its default model.

The workflow installs `@openai/codex` from npm and runs `codex exec`, capturing the final message with `--output-last-message`.

## Permissions

Permissions map to Codex sandbox modes:

- Implement and fix steps: `--sandbox workspace-write` (edits inside the checkout; network access is off by default, so commands like `npm install` may fail).
- Review, summary, and eval steps: `--sandbox read-only`.

## Notes

- The max-turns limit used with Claude Code is not applied; the job's 60-minute timeout still bounds a run.
- Codex reads an `AGENTS.md` in the repository root for conventions, if one exists.
- Edit `.github/workflows/issue-to-pr.yml` (the `agent-retry` wrapper) to change flags or sandbox modes.
- To go back to Claude Code, delete the `AGENT_CLI` variable or set it to `claude`.
