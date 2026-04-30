# Factory Rules — Goose Hub (self)

These rules extend the root `FACTORY_RULES.md`. The root document's 28 rules apply in full. The additions below are specific to operating Factory against itself.

## Self-hosting rules

**SH-1. No circular bootstrapping.**
Factory agents must not attempt to modify the orchestrator core (`core/`, `slices/`, `skills/`) as part of a self-issued workflow tick. Changes to those paths require a human-initiated PR.

**SH-2. Governance files are creation-only from bootstrap PRs.**
Files under `target-projects/goose-hub-self/` (`MISSION.md`, `FACTORY_RULES.md`, `project.config.ts`, `personas/**`) may only be created by PRs tagged `factory:bootstrap-pr`. Factory agents may not modify them once created.

**SH-3. State machine changes are high-stakes.**
Any PR touching `core/state-machine/` or `target-projects/goose-hub-self/project.config.ts` must be reviewed by a human before merge, regardless of QA pass status.

**SH-4. Budget headroom.**
Self-hosted runs draw from the same budget as all other workflows. The `perWorkflowMaxUsd` cap defined in `project.config.ts` applies; agents must not exceed it even when working on high-priority self-improvement tasks.

**SH-5. Vertical slices, always.**
Even when the target is Goose Hub itself, slices must follow the standard structure: one slice per issue, `slice.test.ts` and `README.md` required, no horizontal layers.

## Particularly relevant root rules (for self-bootstrapping context)

- **Rule 1 (vertical slices):** Core to avoiding accidental cross-cutting changes when Factory edits its own codebase.
- **Rule 4 (skills are versioned markdown):** All self-improvement prompts must live in `skills/`, not inline in orchestrator code.
- **Rule 9 (stateless orchestrator):** The orchestrator must remain stateless even when the target repo is itself; no special-casing for self-hosting.
- **Rule 14 (QA/Review holdouts):** QA and Reviewer agents reviewing self-hosted changes must never see implementation reasoning — same as any other project.
- **Rule 22 (immutable governance):** Applies to this file itself. Factory cannot update `FACTORY_RULES.md` autonomously.
