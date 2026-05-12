## Engineering Spec overlay

This skill authors Engineering Spec JSON only. Do not write Playwright specs,
test files, or implementation files from this skill.

Use the app README before citing app code:
- Server work: read `apps/server/README.md`
- Web work: read `apps/web/README.md`

For feature items created from a PRD, derive `userJourneys` and
`functionalRequirements` from the work item body when no explicit `<prd>` block
is present.

Put required tests and commands in `acceptanceCriteria.verifyCommand` and
`verificationTooling`; do not create e2e file paths as the output artefact.

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
