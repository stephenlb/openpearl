#!/usr/bin/env bash
# Installs the agent CLI selected by AGENT_CLI (claude, opencode, codex or pi).
set -euo pipefail
case "${AGENT_CLI:-claude}" in
  claude) npm install -g @anthropic-ai/claude-code ;;
  opencode) npm install -g opencode-ai ;;
  codex) npm install -g @openai/codex ;;
  pi) npm install -g @mariozechner/pi-coding-agent ;;
  *) echo "Unsupported AGENT_CLI '$AGENT_CLI' (use claude, opencode, codex, or pi)"; exit 1 ;;
esac
