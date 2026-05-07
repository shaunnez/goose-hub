# slices/governance-check

Governance PR protection check. Closes M12.05 (#305).

## What it does

Enforces FACTORY_RULES rule 12: governance files cannot be modified by any
Factory-dispatched PR. They can only be created in PRs tagged
`factory:bootstrap-pr`.

A GitHub Actions workflow runs on every `pull_request` event
(opened, synchronize, reopened, labeled, unlabeled). It fetches the PR's
changed files via the GitHub REST API and runs them through `checkGovernance()`.
The check fails with a clear per-file error message if any governance file is
touched in a disallowed way.

## Governance perimeter

| Path pattern | Covered by |
|---|---|
| `MISSION.md` | Root governance — immutable |
| `FACTORY_RULES.md` | Root governance — immutable |
| `CLAUDE.md` | Root governance — immutable |
| `target-projects/<slug>/project.config.ts` | Project config |
| `target-projects/<slug>/personas/**` | Persona configs |
| `target-projects/<slug>/MISSION.md` | Per-project overlay |
| `target-projects/<slug>/FACTORY_RULES.md` | Per-project overlay |

## Bootstrap exception

PRs labelled `factory:bootstrap-pr` may ADD (not modify/remove/rename) files
within the perimeter. The rationale: bootstrapping a new project requires
creating its governance set for the first time. Modification of existing
governance files is still blocked even on bootstrap PRs.

Root `CLAUDE.md` addition is also permitted on bootstrap PRs to support
initial repository setup.

## Vertical surfaces touched

- **Core lib**: `core/bootstrap/governance-check.ts`
  - `isGovernancePath(path)` — returns true if a path is in the perimeter
  - `isBootstrapAllowedAddition(path)` — returns true if a path may be added
    on a bootstrap PR
  - `checkGovernance(changes, hasBootstrapLabel)` — pure function, no I/O;
    returns `{ ok, violations }` where each violation includes `path` and `reason`

- **Script**: `scripts/governance-check-pr.ts`
  - Reads `GITHUB_EVENT_PATH`, fetches PR files via GitHub REST, calls
    `checkGovernance`, exits non-zero on failure

- **Workflow**: `.github/workflows/governance-check.yml`
  - Triggers on `pull_request` (opened, synchronize, reopened, labeled, unlabeled)
  - Runs `pnpm tsx scripts/governance-check-pr.ts`

## Running the tests

```bash
pnpm vitest run slices/governance-check/slice.test.ts
```

No live GitHub API required — the pure `checkGovernance` function is tested
directly with injected file lists.
