#!/usr/bin/env bash
# Plan-first gate: deny Edit|Write when no spec artefact exists for FACTORY_RUN_ID.
# Honours FACTORY_RUN_ALLOWLIST — read-only/triage runs skip this gate.
# Output truncated per rule 31 (4 MB stdout cap).

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

if [ "$TOOL" != "Edit" ] && [ "$TOOL" != "Write" ]; then
  exit 0
fi

# Read-only/triage roles skip the plan-first gate
if [ -n "${FACTORY_RUN_ALLOWLIST:-}" ]; then
  exit 0
fi

# Allowlist: spec files themselves, docs, .claude config, agent-context overlays, READMEs
if echo "$FILE" | grep -qE \
  'slices/[^/]+/spec\.(ts|json)$|/docs/|^docs/|\.claude/|target-projects/.*/agent-context/.*\.md$|/README\.md$|^README\.md$'; then
  exit 0
fi

RUN_ID="${FACTORY_RUN_ID:-}"

# No run ID — ad-hoc/non-agent run; skip gate for backwards compatibility
if [ -z "$RUN_ID" ]; then
  exit 0
fi

# Check for a spec artefact under slices/<run-slug>/
SPEC_TS="slices/${RUN_ID}/spec.ts"
SPEC_JSON="slices/${RUN_ID}/spec.json"

if [ -f "$SPEC_TS" ] || [ -f "$SPEC_JSON" ]; then
  exit 0
fi

printf "Plan-first gate: no spec artefact found for FACTORY_RUN_ID=%s\nCreate slices/%s/spec.ts before editing code files.\n" \
  "$RUN_ID" "$RUN_ID" >&2
exit 2
