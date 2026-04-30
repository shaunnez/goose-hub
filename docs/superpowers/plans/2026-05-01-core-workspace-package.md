# Core Workspace Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `core/` into a proper pnpm workspace package (`@goose-hub/core`) so all apps import it by name instead of via fragile `../../../core/` relative paths, and codify this as a permanent project rule.

**Architecture:** `core/package.json` declares `@goose-hub/core` with a wildcard `exports` map. pnpm creates a symlink in `node_modules/@goose-hub/core` → `core/`. TypeScript's `NodeNext` module resolution follows that symlink and substitutes `.js` → `.ts` to find source files. No extra loaders or plugins needed.

**Tech Stack:** pnpm workspaces, TypeScript `moduleResolution: NodeNext`, tsx (already in use), Node.js package exports.

---

### Task 1: Create `core/package.json`

**Files:**
- Create: `core/package.json`

- [ ] **Step 1: Write `core/package.json`**

```json
{
  "name": "@goose-hub/core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    "./*": "./*.js"
  }
}
```

The wildcard export maps `@goose-hub/core/state-machine/states.js` → `./state-machine/states.js` inside the package dir. TypeScript then substitutes `.js` → `.ts` to reach the source. No explicit entry listing needed.

- [ ] **Step 2: Verify the file exists**

```bash
cat core/package.json
```

Expected: the JSON above.

---

### Task 2: Register `core` in pnpm workspace

**Files:**
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Add `core` to workspace packages**

Current content:
```yaml
packages:
  - 'apps/*'
```

Replace with:
```yaml
packages:
  - 'apps/*'
  - 'core'
```

- [ ] **Step 2: Verify**

```bash
cat pnpm-workspace.yaml
```

Expected: both entries present.

---

### Task 3: Add `@goose-hub/core` dependency to `apps/server` and `apps/cli`

**Files:**
- Modify: `apps/server/package.json`
- Modify: `apps/cli/package.json`

- [ ] **Step 1: Add dependency to server**

Open `apps/server/package.json`. Add to `"dependencies"`:

```json
"@goose-hub/core": "workspace:*"
```

Full result:
```json
{
  "name": "@goose-hub/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "@goose-hub/core": "workspace:*",
    "@hono/node-server": "^1.13.7",
    "hono": "^4.6.14"
  }
}
```

- [ ] **Step 2: Add dependency to CLI**

Open `apps/cli/package.json`. Add to `"dependencies"` (create the key if absent):

```json
{
  "name": "@goose-hub/cli",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "bin": {
    "goose": "./src/index.ts"
  },
  "dependencies": {
    "@goose-hub/core": "workspace:*"
  }
}
```

- [ ] **Step 3: Run `pnpm install` to create the symlink**

```bash
pnpm install
```

Expected: output includes `@goose-hub/core` being linked. No errors.

- [ ] **Step 4: Verify the symlink exists**

```bash
ls -la node_modules/@goose-hub/
```

Expected: `core -> ../../core` (or similar symlink to the `core/` directory).

---

### Task 4: Update imports in `apps/server/`

**Files:**
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/source.ts`
- Modify: `apps/server/src/projects.ts`

- [ ] **Step 1: Update `apps/server/src/index.ts`**

Replace all `'../../../core/...'` imports. Current imports:

```ts
import { buildSseStream } from '../../../core/event-stream/sse.js';
import { eventStore } from '../../../core/event-stream/store.js';
import type { StateName } from '../../../core/state-machine/states.js';
import { isLegalTransition, legalTargets } from '../../../core/state-machine/transitions.js';
```

Change to:

```ts
import { buildSseStream } from '@goose-hub/core/event-stream/sse.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import { isLegalTransition, legalTargets } from '@goose-hub/core/state-machine/transitions.js';
```

- [ ] **Step 2: Update `apps/server/src/source.ts`**

Current:

```ts
import { GitHubLabelsSource } from '../../../core/state-source/github-labels.js';
import type { StateSource } from '../../../core/state-source/interface.js';
```

Change to:

```ts
import { GitHubLabelsSource } from '@goose-hub/core/state-source/github-labels.js';
import type { StateSource } from '@goose-hub/core/state-source/interface.js';
```

- [ ] **Step 3: Update `apps/server/src/projects.ts`**

Current:

```ts
import type { ProjectConfig } from '../../../core/types.js';
```

Change to:

```ts
import type { ProjectConfig } from '@goose-hub/core/types.js';
```

---

### Task 5: Update imports in `apps/cli/`

**Files:**
- Modify: `apps/cli/src/index.ts`

- [ ] **Step 1: Update all core imports in `apps/cli/src/index.ts`**

Current imports (from grep output):

```ts
import type { ProjectConfig } from '../../../core/types.js';
import type { StateName } from '../../../core/state-machine/states.js';
import type { WorkItem } from '../../../core/state-source/interface.js';
import { GitHubLabelsSource } from '../../../core/state-source/github-labels.js';
import { STATES } from '../../../core/state-machine/states.js';
```

Change all to:

```ts
import type { ProjectConfig } from '@goose-hub/core/types.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import { GitHubLabelsSource } from '@goose-hub/core/state-source/github-labels.js';
import { STATES } from '@goose-hub/core/state-machine/states.js';
```

---

### Task 6: Verify typecheck and tests pass

- [ ] **Step 1: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

If you see `Cannot find module '@goose-hub/core/...'` errors: the symlink or `pnpm install` step did not complete correctly. Re-run `pnpm install` and check `node_modules/@goose-hub/core` exists.

- [ ] **Step 2: Run tests**

```bash
pnpm test
```

Expected: all tests pass (same pass/fail count as before this change).

- [ ] **Step 3: Confirm no `../../../core` imports remain in apps/**

```bash
grep -r "from '.*\.\./.*core/" apps/ --include="*.ts"
```

Expected: no output.

---

### Task 7: Add the rule to `FACTORY_RULES.md` and `CONTEXT.md`

**Files:**
- Modify: `FACTORY_RULES.md` (Architecture section, after rule 27)
- Modify: `CONTEXT.md`

> Note: `FACTORY_RULES.md` is a governance file — only humans modify it directly. This task is human-executed.

- [ ] **Step 1: Add rule 28a to `FACTORY_RULES.md` Architecture section**

After rule 27 (`No new heavyweight dependencies...`), add:

```markdown
28a. **Monorepo package boundaries.** Every top-level directory that is imported by two or more apps must be a pnpm workspace package with a `package.json` declaring its public exports. Apps import it by package name (`@goose-hub/<name>`), never by relative path. Intra-package cross-file imports stay relative. New shared modules follow this rule before the first cross-app import is written.
```

- [ ] **Step 2: Add a note to `CONTEXT.md`**

Add a section (or append to existing architecture decisions):

```markdown
## Monorepo import convention

`core/` is the `@goose-hub/core` workspace package. Apps (`apps/server`, `apps/cli`) import it as:

```ts
import { ... } from '@goose-hub/core/state-machine/states.js';
```

Never via relative `../../../core/` paths. The wildcard export in `core/package.json` maps all subpaths. If a new top-level shared directory is created and imported by multiple apps, give it its own `package.json` with `"name": "@goose-hub/<name>"` before the first cross-app import lands.
```

---

### Task 8: Commit

- [ ] **Step 1: Stage and commit**

```bash
git add core/package.json pnpm-workspace.yaml apps/server/package.json apps/cli/package.json \
  apps/server/src/index.ts apps/server/src/source.ts apps/server/src/projects.ts \
  apps/cli/src/index.ts FACTORY_RULES.md CONTEXT.md pnpm-lock.yaml
git commit -m "chore: make core a workspace package (@goose-hub/core)

Replace ../../../core/ relative imports with @goose-hub/core/* package imports
across apps/server and apps/cli. Codify monorepo package boundary rule in
FACTORY_RULES.md and CONTEXT.md."
```

---

## Self-Review

**Spec coverage:**
- `core/package.json` created with wildcard exports ✓
- `pnpm-workspace.yaml` updated ✓
- `apps/server/package.json` and `apps/cli/package.json` updated ✓
- All `../../../core/` imports in `apps/server/` replaced ✓
- All `../../../core/` imports in `apps/cli/` replaced ✓
- Typecheck + tests verified ✓
- Rule added to `FACTORY_RULES.md` ✓
- Convention recorded in `CONTEXT.md` ✓

**Note on intra-core imports:** `core/state-source/github-labels.ts` imports `'../state-machine/states.js'` etc. These are single-level relative imports *within* the same package — they stay as-is. The rule only governs cross-package (app → shared-lib) imports.

**No placeholders found.** All steps contain exact file content or commands.
