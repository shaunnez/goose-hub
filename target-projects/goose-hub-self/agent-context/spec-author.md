## Engineering Spec overlay

This skill authors Engineering Spec JSON only. Do not write Playwright specs,
test files, or implementation files from this skill.

Use the app README before citing app code:
- Server work: read `apps/server/README.md`
- Web work: read `apps/web/README.md`

For feature items created from a PRD, derive `userJourneys`,
`functionalRequirements`, acceptance criteria, slice boundaries, implementation
decisions, and testing decisions from `<prdContext>` when present. Fall back to
the work item body only when no explicit `<prdContext>` or `<prd>` block is
present.

Put required tests and commands in `acceptanceCriteria.verifyCommand` and
`verificationTooling`; do not create e2e file paths as the output artefact.
Each `verificationTooling[]` entry must use `command`, not `scriptPath`, and
the value must be a runnable repo-root command such as
`pnpm vitest run apps/web/src/lib/lanes.config.test.ts` or
`pnpm --filter @goose-hub/web exec playwright test apps/web/e2e/pipeline/golden-bug.spec.ts`.
Never emit a bare test/source file path, never shorten Playwright paths to
package-relative arguments such as `e2e/pipeline/golden-bug.spec.ts`, and never
use root `pnpm exec playwright` commands for web Playwright specs.

Strict shape reminders for fields that commonly fail schema validation:
- Optional fields should be omitted when they do not apply. Do not emit `null`.
- `schemaChanges` is always an object: `{"ddl":[],"migrations":[]}` when there
  are no DB changes. Never return it as an array.
- Every `interfaceContracts[]` item must include `name`, `signature`, and
  `file`. Use a short descriptive `name` even for one-off functions or Zod
  blocks.
- Every `constraints[]` item must use one of these exact `kind` values:
  `phase`, `gate`, `hook`, `model`, or `output-format`. Put domain concepts
  like "API route", "database", "UI", or "test" in `name`, not `kind`.
- Every `constraints[].source` must be exactly `path/to/file.ts:123` or
  `path/to/file.ts:SymbolName`.
  - Good: `core/agent-runtime/event-types.ts:EventLike`
  - Good: `apps/server/README.md:5`
  - Bad: `core/agent-runtime/event-types.ts:SYMBOL:EventLike`
  - Bad: `apps/server/README.md:5-20`
