#!/usr/bin/env bash
# Blocks writes to governance files (MISSION.md, FACTORY_RULES.md).
# These files are immutable per FACTORY_RULES. Enforces rule mechanically.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

if [ "$TOOL" != "Edit" ] && [ "$TOOL" != "Write" ]; then
  exit 0
fi

if echo "$FILE" | grep -qE '(MISSION\.md|FACTORY_RULES\.md)$'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Governance file is immutable per FACTORY_RULES. Cannot modify MISSION.md or FACTORY_RULES.md."}}'
  exit 0
fi

exit 0
