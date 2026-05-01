#!/usr/bin/env bash
# Injects Factory project context into spawned subagents.
# Subagents start with no conversation history — this ensures they know
# what project they're in and what rules apply.

BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")

MSG="You are a subagent working on the goose-hub repository (shaunnez/goose-hub).
Key context:
- Branch: $BRANCH
- Stack: Node + pnpm + TypeScript + React + Vite + Drizzle + SQLite + Biome + Vitest
- Architecture: vertical slice milestones (M0-M18), stateless orchestrator, Factory engine
- Rules: no cross-slice imports, no inline prompts (skills/ only), no as-any, no unsolicited scope expansion
- Governance files (MISSION.md, FACTORY_RULES.md) are immutable — do not suggest modifying them
- Source of truth for work items: GitHub Issues on shaunnez/goose-hub"

ESCAPED=$(printf '%s' "$MSG" | jq -Rs .)
echo "{\"hookSpecificOutput\":{\"hookEventName\":\"SubagentStart\",\"additionalContext\":$ESCAPED}}"

exit 0
