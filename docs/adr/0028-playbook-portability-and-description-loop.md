# ADR 0028: Playbook portability + skill auto-trigger description loop

**Status:** Accepted
**Date:** 2026-05-07
**Milestone:** M11 — Dependency-aware Scheduling (M11.18, M11.19)

## Context

ADR 0024's cross-run learning loop turns one project's lifecycles into a body of mined patterns,
gate thresholds, and cost baselines. Two related questions remained open at the end of M11:

1. **Portability.** A pattern that converges on `goose-hub-self` ("the developer keeps re-running
   the test suite three times before declaring done") is almost certainly relevant to a sibling
   project — but those mined rows live in `goose-hub-self`'s SQLite, not in
   `nannymudnz`'s. Without a portable export format, the value of the loop is locked to the
   project that produced it. The fix had to round-trip without depending on the runtime DB schema
   (which we want to be free to change).

2. **Description-loop measurement.** Skills auto-trigger in the orchestrator on a description match
   (the skill's `prompt.md` description vs. the input prompt's keywords). When a skill description
   is wrong — too narrow, too broad, ambiguous — the auto-trigger fires when it shouldn't or
   misses when it should. M11.19 needed a deterministic eval that *reads the skill descriptions
   off disk* and reports their trigger accuracy on a labelled set of prompts. This is Layer 1 of
   Steve's two-layer skill eval framework (Layer 2 — binary assertion authoring per skill — is
   deferred to M19+).

Both problems are about making the learning surface durable across project and time boundaries.
We bundled them into one ADR because their architectural shape is the same — a small,
deterministic transformer over the artefacts the loop produces.

## Decision — playbook portability

Add `core/learning/playbook-export.ts` and `playbook-import.ts`:

- **Export.** `exportPlaybook(projectId)` reads the operational rows for that project
  (`decision_patterns`, computed gate thresholds via `playbook-stats.ts`, cost baselines per
  phase) and emits a `PlaybookManifest` JSON with a top-level `schemaVersion: '1'`. The manifest
  is fully validated by `PlaybookManifestSchema` (Zod) before being returned. The CLI surface is
  `goose playbook export <slug>` writing to stdout or `--out`.

- **Import.** `importPlaybook(targetProjectId, manifest)` validates `schemaVersion` first, returns
  `{ ok: false, reason: 'incompatible schemaVersion' }` on mismatch, then full-`safeParse`s the
  manifest and upserts decision patterns by `(decisionType, phase)`. Gate thresholds are recorded
  as events rather than into a dedicated table — there is no schema yet that owns them, and
  events round-trip cleanly through the existing replay path.

### Why a separate manifest schema rather than dumping DB rows

The DB schema is internal and will change (e.g. when M9's `improvement_candidates` consolidates
with the cross-run candidates from M11). A portable manifest decouples the on-disk format from the
shipping format. The manifest only carries the fields a sibling project can act on; it deliberately
omits per-project IDs, timestamps, and run pointers.

### Why `schemaVersion` is checked before parsing

A future v2 manifest may add fields the v1 importer cannot handle. Refusing on version mismatch
preserves the user's data — a v2 export read by a v1 importer fails fast and loud rather than
silently dropping unknown fields.

## Decision — description-loop eval

Add `core/learning/description-loop.ts` exposing `runDescriptionLoop({ skillName, fixturePath })`:

- Reads the skill's `prompt.md` from disk (path resolved relative to `skills/<name>/`).
- Reads a `TriggerSet` fixture (`{ shouldTrigger: string[], shouldNotTrigger: string[] }`) from
  the supplied path.
- For each prompt in `shouldTrigger`, runs the auto-trigger keyword match using the skill's
  description; counts true-positives and false-negatives.
- For each prompt in `shouldNotTrigger`, counts true-negatives and false-positives.
- Returns `{ tpRate, tnRate, accuracy, failures }`. The `failures` array is the diagnostic surface
  — every prompt that misclassified is reported with its expected and actual labels.

Stop-words (`a`, `an`, `the`, `and`, ...) are stripped from the description before matching to
avoid trivial matches on filler words.

### Why deterministic instead of LLM-judged

A deterministic keyword match has reproducible accuracy across runs. An LLM judge would introduce
noise into the eval that the eval is supposed to measure. The description loop is a tool for the
human and the skill-coach (ADR 0025) — both need a stable, comparable accuracy number across
descriptions.

### Why Layer 1 only

Layer 2 — per-skill binary assertions on output quality — needs evaluator harnesses that vary
significantly per skill (a triage assertion looks nothing like an investigate assertion). M11
shipped only Layer 1 (description-loop eval). Layer 2 is deferred to the M19 quality-score work
where the harness shape is already on the roadmap.

## Consequences

- A project's mined patterns are now an exportable, importable artefact. The first concrete use
  case is bootstrapping a new project from the patterns of an existing one.
- The portability boundary (the `PlaybookManifest`) is the contract; internal schema can evolve
  freely.
- The description-loop eval is now a pre-commit affordance for any skill description change. A
  drop in `accuracy` is the first signal that a description rewrite has regressed auto-trigger
  behaviour.
- Both surfaces land as small, pure functions in `core/learning/`. They have no dependencies on
  the LLM runtime and can be exercised in unit tests without `ANTHROPIC_API_KEY`.
- Layer 2 of the skill eval (binary assertions per skill) is acknowledged as deferred to M19+.
  This ADR is amended at that time rather than a new ADR per skill.
