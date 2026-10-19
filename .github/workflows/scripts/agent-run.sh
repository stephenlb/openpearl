#!/usr/bin/env bash
# Usage: agent-run.sh <read|edit> <prompt> [max-turns]
# Tenant-pipeline agent wrapper: like issue-to-pr.yml's agent-retry, but no mode
# ever gets a shell or network tools. Edit mode can only read and write files.
# Prints the agent's final answer; retries transient failures with backoff.
mode=$1 prompt=$2 turns=$3
out=$(mktemp)
run_agent() {
  case "$AGENT_CLI" in
    claude)
      args=(-p "$prompt" --disallowedTools "Bash,WebFetch,WebSearch,Task,NotebookEdit")
      if [ "$mode" = edit ]; then
        args+=(--permission-mode acceptEdits --allowedTools "Read,Edit,Write,Glob,Grep,Read(/$RUNNER_TEMP/**)")
      else
        args+=(--allowedTools "Read,Glob,Grep,Read(/$RUNNER_TEMP/**)")
      fi
      [ -n "$turns" ] && args+=(--max-turns "$turns")
      claude "${args[@]}"
      ;;
    opencode)
      ext="\"external_directory\":{\"$RUNNER_TEMP/**\":\"allow\"}"
      edit=deny
      [ "$mode" = edit ] && edit=allow
      export OPENCODE_PERMISSION='{"edit":"'"$edit"'","webfetch":"deny",'"$ext"',"bash":{"*":"deny"}}'
      args=(run)
      [ -n "$AGENT_MODEL" ] && args+=(-m "$AGENT_MODEL")
      opencode "${args[@]}" "$prompt"
      ;;
    codex)
      export CODEX_API_KEY="${CODEX_API_KEY:-$OPENAI_API_KEY}"
      local sandbox=read-only last rc
      [ "$mode" = edit ] && sandbox=workspace-write
      last=$(mktemp)
      args=(exec --sandbox "$sandbox" --skip-git-repo-check --output-last-message "$last")
      [ -n "$AGENT_MODEL" ] && args+=(-m "$AGENT_MODEL")
      codex "${args[@]}" "$prompt" >&2
      rc=$?
      [ "$rc" -eq 0 ] && cat "$last"
      rm -f "$last"
      return $rc
      ;;
    pi)
      local tools=read,grep,find,ls
      [ "$mode" = edit ] && tools=read,edit,write,grep,find,ls
      args=(-p --tools "$tools")
      [ -n "$AGENT_MODEL" ] && args+=(--model "$AGENT_MODEL")
      pi "${args[@]}" "$prompt"
      ;;
    *)
      echo "Unsupported AGENT_CLI '$AGENT_CLI'" >&2
      return 2
      ;;
  esac
}
for attempt in 1 2 3; do
  if run_agent > "$out"; then
    cat "$out"; rm -f "$out"; exit 0
  fi
  echo "$AGENT_CLI failed (attempt $attempt/3)" >&2
  [ "$attempt" -lt 3 ] && sleep $((attempt * 20))
done
rm -f "$out"
exit 1
