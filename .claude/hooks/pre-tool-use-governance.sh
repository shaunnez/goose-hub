#!/usr/bin/env bash
# Blocks writes to governance files and Claude Code config files.
# MISSION.md and FACTORY_RULES.md are immutable once created; creation is
# allowed during new project bootstrap but modification is never allowed.
# .claude/settings.json and .claude/hooks/* are always blocked — agents must
# not self-modify their own permissions or hooks configuration.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

if [ "$TOOL" != "Edit" ] && [ "$TOOL" != "Write" ]; then
  exit 0
fi

if echo "$FILE" | grep -qE '(MISSION\.md|FACTORY_RULES\.md)$'; then
  # Only deny if the file already exists — creation is allowed during new project bootstrap.
  if [ -f "$FILE" ]; then
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Governance file is immutable per FACTORY_RULES. Cannot modify an existing MISSION.md or FACTORY_RULES.md."}}'
    exit 0
  fi
fi

if echo "$FILE" | grep -qE '\.claude/settings\.json$|\.claude/hooks/'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Claude Code configuration files (.claude/settings.json, .claude/hooks/*) are protected. Agents cannot modify their own permissions or hooks."}}'
  exit 0
fi

exit 0
