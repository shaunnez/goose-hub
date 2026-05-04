# ADR 0015: Promote `target-projects/` to a Workspace Package

**Status:** Accepted
**Date:** 2026-05-04

## Context

`target-projects/` is the on-disk home for per-project configuration: `project.config.ts`, `repos.md`, persona registries, governance overlays. It is read by both `apps/cli` (e.g. the `goose status` command imports `goose-hub-self/project.config.ts` directly) and `apps/server` (`shared/projects.ts` walks the directory at runtime to enumerate projects).

Until now the directory was *not* a pnpm workspace package. Both apps reached into it via relative paths:

- `apps/cli/src/index.ts` → `../../../target-projects/goose-hub-self/project.config.js`
- `apps/server/src/shared/projects.ts` → `path.resolve(import.meta.url, '../../../../target-projects')`
- `apps/server/src/domains/workflows/triage-batch.ts` → `join(REPO_ROOT, 'target-projects', slug, 'repos.md')` where `REPO_ROOT = '../../../../..'`

`FACTORY_RULES.md` rule 28a is explicit: any top-level directory imported by 2+ apps must be a pnpm workspace package with a `name` and wildcard `exports`, and apps must import it by package name. Multiple apps were importing `target-projects/` via relative paths — the rule has always been violated for this directory; we now have enough usage to fix it permanently rather than allowing more relative imports to accrue.

The same pattern applied weakly to `skills/`: while `@goose-hub/skills` exists as a package and its `*.ts` modules are imported by package name, the CLI was still reading `prompt.md` files via `new URL('../../../skills/<name>/prompt.md', import.meta.url)` because there was no exported `skillsRoot` to anchor non-JS file lookups.

## Decision

1. **`target-projects/` becomes the `@goose-hub/target-projects` workspace package.** It gets a `package.json` with `"exports": { ".": "./index.ts", "./*": "./*" }` and is added to `pnpm-workspace.yaml`.

2. **Two import shapes are supported:**
   - Per-project static imports: `import gooseHubSelf from '@goose-hub/target-projects/goose-hub-self/project.config.js'`
   - Filesystem-root anchoring: `import { targetProjectsRoot } from '@goose-hub/target-projects'` for runtime walks (`readdir`, dynamic config loads, sibling-file reads like `repos.md`).

3. **`@goose-hub/skills` gains the same shape.** A new `skills/index.ts` exports `skillsRoot`, available as `import { skillsRoot } from '@goose-hub/skills'`. The CLI uses it to resolve `prompt.md` paths; the server's `triage-batch.ts` already used a relative `join(REPO_ROOT, 'skills', ...)` and now uses `skillsRoot` instead.

4. **Both apps depend on `@goose-hub/target-projects`** via `workspace:*` (added to `apps/cli/package.json` and `apps/server/package.json`). `@goose-hub/skills` is also added to `apps/cli` (it was missing).

5. **`tsconfig.json` paths** are extended with the new package mappings so editor + tsc resolve the package-name imports the same way pnpm does at runtime.

## Consequences

**Positive:**
- Rule 28a satisfied. No app reaches into `target-projects/` (or `skills/` for non-JS assets) via relative paths.
- Runtime path resolution no longer depends on counting `../` segments from a particular file's depth — moving the source file no longer breaks discovery.
- `targetProjectsRoot` and `skillsRoot` are the single anchor points for FS walks; future apps follow the same pattern.

**Trade-offs:**
- One more workspace package to maintain. The cost is a 7-line `package.json` and a 1-export `index.ts`.
- The wildcard `"./*": "./*"` export means *any* file under `target-projects/` is reachable by package path. This matches the pattern already in use for `@goose-hub/core` and `@goose-hub/skills` and is acceptable because `target-projects/` content is governed by humans, not imported code.

**Not in scope:**
- Validating that every project directory under `target-projects/` has a `project.config.ts`. The runtime catches missing configs at `getProject(slug)`; we add no static check.
- Promoting `slices/` to a workspace package — slices are not cross-app shared code today.
