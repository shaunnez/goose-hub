#!/usr/bin/env bash
# Re-injects orientation context after Claude Code compresses the conversation.
# Prevents losing track of current branch, milestone, and active issue.

BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")

# Derive active milestone from CLAUDE.md (authoritative source)
MILESTONE=$(grep -o '"M[0-9][^"]*"' CLAUDE.md 2>/dev/null | head -1 | tr -d '"')

# Check for in-progress issue
IN_PROGRESS=$(gh issue list \
  --milestone "$MILESTONE" \
  --label "factory:in-progress" \
  --state open \
  --json number,title \
  --jq 'if length > 0 then .[0] | "#\(.number): \(.title)" else "none" end' 2>/dev/null || echo "none")

MSG="Context was compressed. Orientation:
- Repo: goose-hub (shaunnez/goose-hub)
- Branch: $BRANCH
- Active milestone: $MILESTONE
- In-progress issue: $IN_PROGRESS
- Architecture: vertical slices, stateless orchestrator, GitHub Issues as source of truth
- Rules: CLAUDE.md + FACTORY_RULES.md apply. Governance files are immutable."

ESCAPED=$(printf '%s' "$MSG" | jq -Rs .)
echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PostCompact\",\"additionalContext\":$ESCAPED}}"

exit 0
