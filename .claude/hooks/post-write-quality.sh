#!/usr/bin/env bash
# Runs biome lint + typecheck after every .ts/.tsx edit.
# Injects errors as additionalContext so Claude self-corrects immediately.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

if [ "$TOOL" != "Edit" ] && [ "$TOOL" != "Write" ]; then
  exit 0
fi

if ! echo "$FILE" | grep -qE '\.(ts|tsx)$'; then
  exit 0
fi

# Skip generated files and node_modules
if echo "$FILE" | grep -qE '(node_modules|\.d\.ts$|/dist/)'; then
  exit 0
fi

REPO_ROOT=$(git -C "$(dirname "$FILE")" rev-parse --show-toplevel 2>/dev/null || pwd)

FEEDBACK=""

# Biome lint (fast: ~50ms per file)
LINT=$(cd "$REPO_ROOT" && pnpm exec biome check "$FILE" 2>&1)
LINT_EXIT=$?
if [ $LINT_EXIT -ne 0 ]; then
  FEEDBACK="${FEEDBACK}LINT ERRORS in $FILE:\n$LINT\n\n"
fi

# Typecheck (core/ files only — skip web since it has its own tsconfig)
if echo "$FILE" | grep -q '/core/'; then
  TSC=$(cd "$REPO_ROOT" && pnpm --filter core tsc --noEmit 2>&1)
  TSC_EXIT=$?
  if [ $TSC_EXIT -ne 0 ]; then
    # Truncate to first 30 lines to keep context manageable
    TSC_TRIMMED=$(echo "$TSC" | head -30)
    FEEDBACK="${FEEDBACK}TYPE ERRORS (core):\n$TSC_TRIMMED\n"
  fi
fi

if [ -n "$FEEDBACK" ]; then
  ESCAPED=$(printf '%s' "$FEEDBACK" | jq -Rs .)
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":\"Quality check failed for $FILE. Fix before proceeding:\\n$ESCAPED\"}}"
fi

exit 0
