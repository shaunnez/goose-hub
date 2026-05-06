# ADR 0022 — Skill file convention consolidation

**Status:** Accepted
**Date:** 2026-05-06
**Milestone:** M11 (mid-milestone refactor; not gated by an issue)

## Context

Goose Hub had two parallel skill-loading conventions running in production:

| | Legacy (11 skills) | Newer (5 skills) |
|---|---|---|
| Prompt file | `skill.md` | `prompt.md` |
| Config file | `config.ts` | `skill.config.ts` |
| Loader | `core/agent-runtime/read-prompt.ts` (`readPromptWithContext`) | Three ad-hoc `readFileSync(.../prompt.md)` callers + dynamic CLI |
| Per-project overlay | Supported (`target-projects/<slug>/agent-context/<skill>.md`) | Not supported |

The split was functional, not chronological — the newer pair grew up alongside the legacy pair because three callers (`apps/server/src/domains/workflows/triage-batch.ts`, `apps/server/src/domains/inbox/enhance.ts`, `apps/cli/src/index.ts`) each re-implemented prompt reading instead of routing through the canonical loader. New skills inherited the file naming of their caller, not of any decided standard.

This produced three concrete problems:

1. Per-project overlays only worked for orchestrator-side skills. Triage, repo-match, bug-enhance, resolve-conflict had no overlay path even though the feature would be useful for them.
2. CLAUDE.md, PLAN.md §6, and CONTEXT.md disagreed about which convention is canonical.
3. Three ad-hoc `readFileSync` callers (plus the CLI's dynamic load) meant any future change to prompt loading (caching, project-context format, etc.) had four places to land instead of one.

## Decision

Standardise on **`prompt.md` + `skill.config.ts`** for file names and on **`readPromptWithContext()`** as the single loader.

Rationale: file-name choice is purely cosmetic, and the newer naming is more self-describing (`prompt.md` is unambiguous; `skill.config.ts` matches the `<thing>.config.ts` ecosystem convention). Loader choice is functional, and the legacy loader has the overlay capability we want to preserve and extend.

### Migration (executed in PR #537 follow-up commits)

1. Rename `skill.md` → `prompt.md` and `config.ts` → `skill.config.ts` for all 11 legacy skills, and update relative `./config.js` imports inside their slice tests.
2. Update `core/agent-runtime/read-prompt.ts` (and its test fixture) to read `prompt.md`.
3. Update the two static `import config from '@goose-hub/skills/<name>/config.js'` sites (`core/agent-runtime/advisor.ts`, `slices/resolve-conflict/workflow.ts`) to `skill.config.js`.
4. Replace the four ad-hoc readers (`apps/server/src/domains/workflows/triage-batch.ts`, `apps/server/src/domains/inbox/enhance.ts`, `slices/resolve-conflict/workflow.ts`, and `apps/cli/src/index.ts`) with calls to `readPromptWithContext(skillName, projectSlug)`. The CLI gains a `--project=<slug>` flag (defaults to no overlay) so it can drive the same loader.

### Consequences

**Positive:**

- Per-project overlays now work for every skill, not just orchestrator-side ones.
- One loader, one set of file names, one mental model.
- Adding a future capability to skill loading (e.g. cached prompts, signed prompts, or remote fetch) is a single-file change in `read-prompt.ts`.

**Trade-offs:**

- 22 file renames touch every legacy skill simultaneously. Cherry-picking around this commit is fiddly.
- The CLI gains a `--project` flag that didn't exist; documented in the CLI's `Usage:` line as part of this change.

### Alternatives considered

- **Standardise on the legacy file names** (`skill.md` + `config.ts`). Rejected: the newer names are objectively more readable and only 5 skills would have to change, but the cost of the migration is dominated by the loader consolidation, not the renames. Doing both at once costs no extra and ends with the better names.
- **Keep both conventions, document them.** Rejected: that's where we already were. The code-level cost of two parallel loaders (overlay-feature gap, four-way drift surface) was the actual problem; documenting it doesn't fix it.
- **Add overlay support to the ad-hoc loaders instead of consolidating.** Rejected: that would leave four loaders implementing the overlay rule, three of which would inevitably drift from the canonical one in `read-prompt.ts`.

### Cross-references

- CLAUDE.md "Hard rules to remember" — single skill-files paragraph
- PLAN.md §6 — repo layout reflects new naming
- CONTEXT.md "Skill File Convention (ADR 0022)" — short summary; ties back to ADR 0014 (holdout enforcement) and ADR 0015 (target-projects workspace package)
- ADR 0015 (target-projects workspace package) — overlay path resolution depends on `targetProjectsRoot`, unchanged by this ADR
