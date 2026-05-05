#!/usr/bin/env bash
# Blocks writes to existing governance files (MISSION.md, FACTORY_RULES.md).
# These files are immutable per FACTORY_RULES once created. New project bootstrap
# is allowed to create them — the gate only blocks modification of existing files.

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

exit 0
