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

# Full biome check
LINT=$(pnpm run lint 2>&1)
if [ $? -ne 0 ]; then
  LINT_TRIMMED=$(echo "$LINT" | grep -E "error|Error" | head -10)
  ERRORS="${ERRORS}LINT FAILED:\n$LINT_TRIMMED\n\n"
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
