#!/usr/bin/env bash
# AC-completeness check for Stop hook.
# Parses the spec file for the current FACTORY_RUN_ID and exits 2 if any
# [ ] ACs remain unchecked. Skips when no spec file is present (backwards
# compatible with non-spec runs).

RUN_ID="${FACTORY_RUN_ID:-}"

if [ -z "$RUN_ID" ]; then
  exit 0
fi

SPEC_TS="slices/${RUN_ID}/spec.ts"
SPEC_JSON="slices/${RUN_ID}/spec.json"

SPEC_FILE=""
if [ -f "$SPEC_TS" ]; then
  SPEC_FILE="$SPEC_TS"
elif [ -f "$SPEC_JSON" ]; then
  SPEC_FILE="$SPEC_JSON"
fi

if [ -z "$SPEC_FILE" ]; then
  exit 0
fi

UNCHECKED=$(grep -c '\[ \]' "$SPEC_FILE" 2>/dev/null || echo 0)

if [ "$UNCHECKED" -gt 0 ]; then
  printf "AC-completeness gate: %d unchecked AC(s) remain in %s\nCheck off all [ ] items before finishing.\n" \
    "$UNCHECKED" "$SPEC_FILE" >&2
  exit 2
fi

exit 0
