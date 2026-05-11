# core/bootstrap

Library code that supports the bootstrap workflow (`slices/bootstrap-project`). Each module is independently testable and stateless; the slice composes them.

## Modules

| File | Purpose |
|---|---|
| `stack-detector.ts` | Inspects a target repo on disk and produces a `StackInfo` describing runtime, package manager, and detected lifecycle commands (`build`, `test`, `lint`, `typecheck`, `e2e`). Node, Python, Go, Rust, Ruby. |
| `claude-md-auditor.ts` | Returns `create` / `update` / `ok` for a target repo's `CLAUDE.md`. `update` produces an addition-only unified diff — never overwrites existing content. |
| `labels.ts` | Single source of truth for `FACTORY_LABELS` (the canonical `factory:*` state-machine labels with color and description). Consumed by both `label-installer.ts` here and `scripts/install-labels.ts`. |
| `label-installer.ts` | Idempotent reconciliation of `FACTORY_LABELS` against a target repo via the GitHub API. Creates missing labels, patches drifted color/description, never deletes. |
| `governance-check.ts` | Implements FACTORY_RULES rule 12 — refuses PRs that modify governance files (`MISSION.md`, `FACTORY_RULES.md`, `CLAUDE.md`, per-project `project.config.ts`, persona configs) unless tagged `factory:bootstrap-pr`. Used by the governance-check GitHub Action. |

## Consumers

- `slices/bootstrap-project` — composes these to onboard a new target repo end-to-end.
- `slices/cli-bootstrap` — exposes `goose project bootstrap` as a CLI command.
- `slices/governance-check` — runs `governance-check.ts` in CI.
- `scripts/install-labels.ts` — uses `labels.ts` and the install logic for ad-hoc label installs.
