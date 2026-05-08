#!/usr/bin/env bash
# PreToolUse hook: file-ownership runtime guard for WP builders (M19.03, ADR 0031).
#
# Denies Edit|Write to files outside the builder's filesOwned set.
# Active only when FACTORY_WP_FILESOWNED is non-empty (set by orchestrator at spawn).
# FACTORY_WP_FILESOWNED is a colon-separated list of workspace-relative paths.
# FACTORY_WP_ID identifies the WP for the violation message.
#
# WHY Bash is not blocked here:
#   Each WP builder runs in its own isolated scratch worktree. Even if a builder
#   uses Bash to write files outside filesOwned, the orchestrator's commit step
#   (orchestratorCommitWp) only stages the WP's declared filesOwned paths —
#   so out-of-scope Bash writes are never committed and never contaminate other WPs.
#   Blocking Bash entirely would also prevent legitimate read-only shell operations.
#
# Exit codes (Claude CC hook protocol):
#   0 — allow
#   2 — deny (stderr message shown to agent)

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')

# Only enforce for Edit/Write
if [ "$TOOL" != "Edit" ] && [ "$TOOL" != "Write" ]; then
  exit 0
fi

# Skip when no WP file-ownership is configured
FILES_OWNED="${FACTORY_WP_FILESOWNED:-}"
if [ -z "$FILES_OWNED" ]; then
  exit 0
fi

FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""')
if [ -z "$FILE" ]; then
  exit 0
fi

# Normalise leading ./ so comparisons are consistent
FILE="${FILE#./}"

WP_ID="${FACTORY_WP_ID:-unknown}"

# Check each owned path (colon-separated)
IFS=':' read -ra OWNED_ARRAY <<< "$FILES_OWNED"
for OWNED in "${OWNED_ARRAY[@]}"; do
  OWNED="${OWNED#./}"
  if [ "$FILE" = "$OWNED" ]; then
    exit 0
  fi
done

printf "wp-file-guard: DENIED — file '%s' is outside WP '%s' filesOwned list.\n" \
  "$FILE" "$WP_ID" >&2
printf "Allowed paths: %s\n" "$FILES_OWNED" >&2
exit 2
