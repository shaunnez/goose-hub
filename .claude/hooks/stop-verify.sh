#!/usr/bin/env bash
# Completion gate: runs full lint + typecheck before allowing Claude to stop.
# Prevents premature "done" when quality checks are failing.
# Only fires if there are staged/unstaged changes (no-op on clean trees).

# Skip if nothing changed this session
CHANGES=$(git diff --name-only HEAD 2>/dev/null; git diff --cached --name-only 2>/dev/null)
if [ -z "$CHANGES" ]; then
  exit 0
fi

# Check for .ts/.tsx changes — only gate if code was touched
TS_CHANGES=$(echo "$CHANGES" | grep -E '\.(ts|tsx)$' | head -1)
if [ -z "$TS_CHANGES" ]; then
  exit 0
fi

ERRORS=""

# Biome check scoped to files changed this session only.
# Full-workspace lint causes multi-agent conflicts: agent B's stop-verify fires,
# picks up agent A's in-progress errors, then tries to fix files it didn't touch.
CHANGED_TS_FILES=$(echo "$CHANGES" | grep -E '\.(ts|tsx|js|jsx|json)$' | sort -u)
if [ -n "$CHANGED_TS_FILES" ]; then
  LINT=$(echo "$CHANGED_TS_FILES" | xargs pnpm biome check 2>&1)
  if [ $? -ne 0 ]; then
    LINT_TRIMMED=$(echo "$LINT" | grep -E "error|Error" | head -10)
    ERRORS="${ERRORS}LINT FAILED:\n$LINT_TRIMMED\n\n"
  fi
fi

# Full typecheck
TSC=$(pnpm typecheck 2>&1)
if [ $? -ne 0 ]; then
  TSC_TRIMMED=$(echo "$TSC" | head -20)
  ERRORS="${ERRORS}TYPECHECK FAILED:\n$TSC_TRIMMED\n"
fi

if [ -n "$ERRORS" ]; then
  printf "Quality checks failed. Fix before finishing:\n\n%b" "$ERRORS" >&2
  exit 2
fi

exit 0
