# slices/playbook-portability

Portable PlaybookManifest export/import. Closes M11.18 (#556).

## What it does

Allows decision patterns, gate thresholds, cost baselines, and learning entries
from one project to seed another — so new projects don't start cold.

### `exportPlaybook(projectId, sourceProjectName): PlaybookManifest`

Reads from the last 90 days of:
- `archivedLifecycles.learningEntries` — per-lifecycle observations
- `decisionPatterns` table — role-level decision patterns
- `events` (via `computeGateThresholds`) — QA / review score statistics
- `agentRunCosts` (via `computeCostBaselines`) — per-role cost statistics

Returns a `PlaybookManifest` conforming to `PlaybookManifestSchema`. No
project-specific identifiers (issue numbers, repo paths, persona IDs) appear in
the output — all are stripped at export time. Roles are surfaced as `phase`.

### `importPlaybook(targetProjectId, manifest): ImportResult | ImportError`

Upserts decision patterns into the target project's `decision_patterns` table.
On conflict (same `decisionType` + `phase`), consistency score is recalculated
as a weighted average of existing and imported occurrence counts.

Rejects manifests with an unknown `schemaVersion` — returns
`{ ok: false, reason: "incompatible schemaVersion" }`.

### CLI

```bash
# Export to stdout
pnpm goose playbook export <project-slug> [--json]

# Import from stdin
pnpm goose playbook import <project-slug> [--json]
```

Both commands honour `--json` for pipe-friendly operation.

## Vertical surfaces touched

- **`core/learning/playbook-export.ts`** — `exportPlaybook`, `PlaybookManifestSchema`
- **`core/learning/playbook-import.ts`** — `importPlaybook`
- **`apps/cli/src/index.ts`** — `goose playbook export|import` commands

## Running the tests

```bash
pnpm test slices/playbook-portability/slice.test.ts
```

All tests mock the DB layer — no live SQLite required.
