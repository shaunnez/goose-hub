# Agent Skill Discipline and Per-Project Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add universal discipline rules to all agent skills to eliminate read-before-write failures and grep loops, then add per-project context injection so each project (starting with goose-hub-self) can supply role-specific guidance without touching shared skill prompts.

**Architecture:** A shared `readPromptWithContext(skillName, projectId)` utility in `core/agent-runtime/` reads `skills/<name>/skill.md` then optionally appends `target-projects/<projectId>/agent-context/<name>.md` if it exists. Each workflow replaces its local `readPrompt` call with the shared utility. Skill prompts get discipline rules added inline. Per-project context files are plain markdown appended after the base prompt.

**Tech Stack:** Node, TypeScript, pnpm workspaces, Vitest (tests for new utility). No new dependencies.

---

## File Map

**Create:**
- `core/agent-runtime/read-prompt.ts` — shared prompt loader with optional project context
- `core/agent-runtime/read-prompt.test.ts` — unit tests for the loader
- `target-projects/goose-hub-self/agent-context/implement.md`
- `target-projects/goose-hub-self/agent-context/qa.md`
- `target-projects/goose-hub-self/agent-context/advise-on-plan.md`
- `target-projects/goose-hub-self/agent-context/evidence-post.md`
- `target-projects/goose-hub-self/agent-context/investigate.md`
- `target-projects/goose-hub-self/agent-context/spec-author.md`
- `target-projects/goose-hub-self/agent-context/playwright-repro.md`

**Modify:**
- `skills/implement/skill.md` — add 5 universal discipline rules
- `skills/qa/skill.md` — add 3 QA discipline rules
- `skills/advise-on-plan/skill.md` — add 3 advisor discipline rules
- `skills/evidence-post/skill.md` — add 2 evidence discipline rules
- `skills/investigate/skill.md` — add 4 investigation discipline rules
- `skills/spec-author/skill.md` — add 2 spec discipline rules
- `skills/playwright-repro/skill.md` — add 2 repro discipline rules
- `slices/fix-issue/workflow.ts` — replace local readPrompt with shared utility
- `slices/qa/workflow.ts` — replace local readPrompt with shared utility
- `slices/investigate/workflow.ts` — replace local readPrompt with shared utility
- `slices/review/workflow.ts` — replace local readPrompt with shared utility
- `core/agent-runtime/advisor.ts` — replace local readSkillPrompt with shared utility
- `core/workflows/retrospective.ts` — replace local readPrompt with shared utility

---

## Task 1: Create shared readPromptWithContext utility

**Files:**
- Create: `core/agent-runtime/read-prompt.ts`
- Create: `core/agent-runtime/read-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// core/agent-runtime/read-prompt.test.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readPromptWithContext } from './read-prompt.js';

// We'll patch REPO_ROOT by mocking import.meta — instead, pass repoRoot as param
// The utility accepts an optional repoRoot for testability.

const root = join(tmpdir(), `read-prompt-test-${Date.now()}`);

beforeAll(() => {
  // Create fake skill
  mkdirSync(join(root, 'skills', 'my-skill'), { recursive: true });
  writeFileSync(join(root, 'skills', 'my-skill', 'skill.md'), '# base prompt');

  // Create fake project context
  mkdirSync(join(root, 'target-projects', 'my-project', 'agent-context'), { recursive: true });
  writeFileSync(
    join(root, 'target-projects', 'my-project', 'agent-context', 'my-skill.md'),
    '## project context',
  );
});

describe('readPromptWithContext', () => {
  it('returns base prompt when no project context exists', () => {
    const result = readPromptWithContext('my-skill', 'no-such-project', root);
    expect(result).toBe('# base prompt');
  });

  it('appends project context when agent-context file exists', () => {
    const result = readPromptWithContext('my-skill', 'my-project', root);
    expect(result).toContain('# base prompt');
    expect(result).toContain('## project context');
    expect(result.indexOf('# base prompt')).toBeLessThan(result.indexOf('## project context'));
  });

  it('separates base and project context with double newline + header', () => {
    const result = readPromptWithContext('my-skill', 'my-project', root);
    expect(result).toContain('\n\n## Project-specific context\n\n');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter=@goose-hub/core test -- --reporter=verbose core/agent-runtime/read-prompt.test.ts
```

Expected: `FAIL` — `read-prompt.ts` not found.

- [ ] **Step 3: Write the implementation**

```typescript
// core/agent-runtime/read-prompt.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_REPO_ROOT = join(import.meta.dirname, '../..');

/**
 * Reads a skill's base prompt and optionally appends project-specific context.
 *
 * Looks for base prompt at: skills/<skillName>/skill.md
 * Looks for project context at: target-projects/<projectId>/agent-context/<skillName>.md
 *
 * The optional repoRoot parameter exists for testing — production callers omit it.
 */
export function readPromptWithContext(
  skillName: string,
  projectId: string,
  repoRoot: string = DEFAULT_REPO_ROOT,
): string {
  const basePrompt = readFileSync(join(repoRoot, 'skills', skillName, 'skill.md'), 'utf8');
  const contextPath = join(
    repoRoot,
    'target-projects',
    projectId,
    'agent-context',
    `${skillName}.md`,
  );
  if (!existsSync(contextPath)) return basePrompt;
  const projectContext = readFileSync(contextPath, 'utf8');
  return `${basePrompt}\n\n## Project-specific context\n\n${projectContext}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter=@goose-hub/core test -- --reporter=verbose core/agent-runtime/read-prompt.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add core/agent-runtime/read-prompt.ts core/agent-runtime/read-prompt.test.ts
git commit -m "feat(agent-runtime): add readPromptWithContext utility for per-project skill injection"
```

---

## Task 2: Wire shared utility into all workflow files

**Files:**
- Modify: `slices/fix-issue/workflow.ts`
- Modify: `slices/qa/workflow.ts`
- Modify: `slices/investigate/workflow.ts`
- Modify: `slices/review/workflow.ts`
- Modify: `core/agent-runtime/advisor.ts`
- Modify: `core/workflows/retrospective.ts`

No new tests needed — existing workflow slice tests cover these call paths. Changes are mechanical substitutions.

- [ ] **Step 1: Replace readPrompt in slices/fix-issue/workflow.ts**

Remove the local `readPrompt` function:
```typescript
// DELETE this function:
function readPrompt(skillName: string): string {
  return readFileSync(join(REPO_ROOT, 'skills', skillName, 'skill.md'), 'utf8');
}
```

Add import at top of file (after existing imports):
```typescript
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
```

Replace all `readPrompt('implement')` calls with `readPromptWithContext('implement', projectId)`.

Replace all `readPrompt('evidence-post')` calls with `readPromptWithContext('evidence-post', projectId)`.

The `projectId` parameter is already available in scope at the call site (line ~90).

Also remove the `readFileSync` import if it's no longer used after removing `readPrompt` (check — `execFileSync` is still needed, `readFileSync` may not be).

- [ ] **Step 2: Replace readPrompt in slices/qa/workflow.ts**

Remove the local `readPrompt` function (line 17).

Add import:
```typescript
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
```

Replace `readPrompt('qa')` (line ~85) with `readPromptWithContext('qa', projectId)`.

- [ ] **Step 3: Replace readPrompt in slices/investigate/workflow.ts**

Remove local `readPrompt` function (line 29–31).

Add import:
```typescript
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
```

Replace `readPrompt('investigate')` with `readPromptWithContext('investigate', projectId)`.
Replace `readPrompt('playwright-repro')` with `readPromptWithContext('playwright-repro', projectId)`.

- [ ] **Step 4: Replace readPrompt in slices/review/workflow.ts**

Same pattern — remove local function, import shared utility, pass `projectId`.

- [ ] **Step 5: Replace readSkillPrompt in core/agent-runtime/advisor.ts**

Remove `readSkillPrompt` function (lines 105–108).

Add import:
```typescript
import { readPromptWithContext } from './read-prompt.js';
```

Replace `readSkillPrompt('advise-on-plan')` (line ~54) with:
```typescript
readPromptWithContext('advise-on-plan', input.projectId)
```

- [ ] **Step 6: Replace readPrompt in core/workflows/retrospective.ts**

Remove local `readPrompt` function (lines 18–20).

Add import:
```typescript
import { readPromptWithContext } from '../agent-runtime/read-prompt.js';
```

Find where `readPrompt(skillName)` is called (line ~80), replace with `readPromptWithContext(skillName, projectId)`. The `projectId` is available via the workflow's input — check the function signature and use the appropriate variable.

- [ ] **Step 7: Run full test suite**

```bash
pnpm test -- --reporter=verbose
```

Expected: all existing tests pass. Fix any import errors (e.g. unused `readFileSync`).

- [ ] **Step 8: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add slices/fix-issue/workflow.ts slices/qa/workflow.ts slices/investigate/workflow.ts slices/review/workflow.ts core/agent-runtime/advisor.ts core/workflows/retrospective.ts
git commit -m "refactor(workflows): use shared readPromptWithContext for per-project skill injection"
```

---

## Task 3: Add discipline rules to skills/implement/skill.md

**Files:**
- Modify: `skills/implement/skill.md`

- [ ] **Step 1: Add discipline rules block to Step 1 (Read section)**

In `skills/implement/skill.md`, find the `### 1 — Read` section. After the existing bullet list and before the `Emit:` line, insert:

```markdown
#### Discipline — applied before writing anything

1. **Read before write.** Use the `read` tool on the target component/module before writing any test for it. No exceptions. A test written without reading the component will mock the wrong things.
2. **Verbose test output.** Run tests with `--reporter=verbose`. Read the full output. Never pipe through `grep` or `head`. One full run beats ten grep loops.
3. **Orient first.** First command in the worktree: `cat package.json` (and `cat apps/web/package.json` if touching the web app) to understand available test scripts before running anything.
4. **Two-rewrite cap.** Maximum 2 test file rewrites per file. On a 3rd failure, stop writing code. Output a diagnosis in your decision summary: the exact error, what you tried, and what is still unclear.
5. **Mock from source.** Before mocking any import, grep the component file for its import statements. Only mock what it actually imports — never mock by assumption.
```

- [ ] **Step 2: Verify the section renders correctly**

Read back the file and confirm the new block appears inside the `### 1 — Read` section, before `Emit:`.

```bash
grep -n "Discipline\|Read before write\|Verbose test\|Orient first\|Two-rewrite\|Mock from source" skills/implement/skill.md
```

Expected: 6 lines found, all within the Step 1 section.

- [ ] **Step 3: Commit**

```bash
git add skills/implement/skill.md
git commit -m "feat(skills/implement): add 5 universal discipline rules to prevent read-before-write failures"
```

---

## Task 4: Add discipline rules to skills/qa/skill.md

**Files:**
- Modify: `skills/qa/skill.md`

- [ ] **Step 1: Add QA discipline rules after the holdout discipline section**

In `skills/qa/skill.md`, find the `## Holdout discipline` section. After its closing paragraph (before `## Input`), insert:

```markdown
## Execution discipline

- **Full output, no grep.** Run `testCommand` once. Read the complete output before drawing any conclusions. Do not re-run the suite more than once in a verification pass. Re-running speculatively wastes budget and does not produce new information.
- **Verify the command first.** If `testRun` is absent from context, confirm the test command from `projectCommands` before running it. Do not assume `pnpm test` works — the project may require `pnpm --filter=web test` or a workspace-specific invocation.
- **Isolate sparingly.** Only re-run a single test file if you have a specific hypothesis about that file. State the hypothesis in a decision summary before running.
```

- [ ] **Step 2: Verify placement**

```bash
grep -n "Execution discipline\|Full output\|Verify the command\|Isolate sparingly" skills/qa/skill.md
```

Expected: 4 lines found, after the holdout section.

- [ ] **Step 3: Commit**

```bash
git add skills/qa/skill.md
git commit -m "feat(skills/qa): add execution discipline rules to prevent grep loops and command assumptions"
```

---

## Task 5: Add discipline rules to skills/advise-on-plan/skill.md

**Files:**
- Modify: `skills/advise-on-plan/skill.md`

- [ ] **Step 1: Add advisor discipline rules inside the "What you must do" step 2**

In `skills/advise-on-plan/skill.md`, find step 2 (the spot-check step). After the opening description and before the verdict options, insert:

```markdown
#### Verification discipline

- **Verify before asserting.** When the plan names a file, use the `read` tool to confirm it exists and contains what the plan claims before providing feedback on it.
- **Search before recommending.** When you consider pointing the developer to an existing utility, grep for it first. Do not recommend utilities you have not confirmed exist.
- **Read before accepting pattern claims.** When the plan claims to follow an existing pattern in the codebase, find one concrete example of that pattern before accepting the claim.
```

- [ ] **Step 2: Verify**

```bash
grep -n "Verification discipline\|Verify before asserting\|Search before recommending\|Read before accepting" skills/advise-on-plan/skill.md
```

Expected: 4 lines found.

- [ ] **Step 3: Commit**

```bash
git add skills/advise-on-plan/skill.md
git commit -m "feat(skills/advise-on-plan): add verification discipline to prevent unfounded feedback"
```

---

## Task 6: Add discipline rules to skills/evidence-post/skill.md

**Files:**
- Modify: `skills/evidence-post/skill.md`

- [ ] **Step 1: Add evidence discipline rules as a new section before "What you must do"**

In `skills/evidence-post/skill.md`, insert after the `## Role` section:

```markdown
## Execution discipline

- **Verify spec path before running.** Before executing Playwright, confirm `<spec_path>` exists using a file read. If the path does not exist, record a decision summary (`spec path <path> not found — skipping Playwright run`) and return early without posting a comment.
- **Full Playwright output.** Run Playwright with full output. Do not pipe or grep the result. Read any failure messages completely before deciding how to proceed.
```

- [ ] **Step 2: Verify**

```bash
grep -n "Verify spec path\|Full Playwright output" skills/evidence-post/skill.md
```

Expected: 2 lines found.

- [ ] **Step 3: Commit**

```bash
git add skills/evidence-post/skill.md
git commit -m "feat(skills/evidence-post): add discipline rules for spec verification and full output"
```

---

## Task 7: Add discipline rules to skills/investigate/skill.md

**Files:**
- Modify: `skills/investigate/skill.md`

- [ ] **Step 1: Add investigation discipline rules at the start of the investigation process**

In `skills/investigate/skill.md`, find `## Investigation process`. After the opening line and before `### Step 1`, insert:

```markdown
### Discipline — applied throughout

- **Orient first.** Before searching for anything, list the top-level directory structure to understand the codebase layout. Know where `core/`, `apps/`, and `slices/` live before diving in.
- **Read before hypothesising.** Read actual source files before forming hypotheses. File names and directory names are not evidence. Code is evidence.
- **Search before assuming location.** Grep for symbol definitions before assuming a file path. A module named `Sidebar` may not be in `sidebar.ts` — search for the export.
- **Widen before speculating.** If two search attempts return no relevant results, widen the search term or try a synonym. Do not speculate about root cause from empty search results.
```

- [ ] **Step 2: Verify**

```bash
grep -n "Orient first\|Read before hypothes\|Search before assuming\|Widen before spec" skills/investigate/skill.md
```

Expected: 4 lines found, before Step 1.

- [ ] **Step 3: Commit**

```bash
git add skills/investigate/skill.md
git commit -m "feat(skills/investigate): add investigation discipline rules to prevent blind hypothesis formation"
```

---

## Task 8: Add discipline rules to skills/spec-author/skill.md and skills/playwright-repro/skill.md

**Files:**
- Modify: `skills/spec-author/skill.md`
- Modify: `skills/playwright-repro/skill.md`

- [ ] **Step 1: Add spec-author discipline rules**

In `skills/spec-author/skill.md`, find `## What you must do`. Before step 1, insert:

```markdown
## Execution discipline

- **Read playwright config first.** Before writing any spec, read `apps/web/playwright.config.ts` to understand the `webServer` setup, base URL, and project configs. A spec that contradicts the config will fail in ways unrelated to the feature.
- **Navigate before asserting.** Use `mcp__playwright-test__browser_snapshot` to observe the actual DOM at each step before writing `expect` assertions. Do not write assertions against elements you have not seen.
```

- [ ] **Step 2: Add playwright-repro discipline rules**

In `skills/playwright-repro/skill.md`, find `## What you must do`. Before step 1, insert:

```markdown
## Execution discipline

- **Read all repro steps first.** Read the complete `<reproSteps>` before beginning navigation. Understand the full sequence before executing step 1 — mid-sequence surprises are harder to recover from.
- **Full console output.** Include exact error messages verbatim in `consoleErrors`. Do not paraphrase console output — the exact text is what matters for diagnosis.
```

- [ ] **Step 3: Verify both**

```bash
grep -n "Read playwright config\|Navigate before asserting" skills/spec-author/skill.md
grep -n "Read all repro steps\|Full console output" skills/playwright-repro/skill.md
```

Expected: 2 lines each.

- [ ] **Step 4: Commit**

```bash
git add skills/spec-author/skill.md skills/playwright-repro/skill.md
git commit -m "feat(skills): add discipline rules to spec-author and playwright-repro"
```

---

## Task 9: Create goose-hub-self implement context

**Files:**
- Create: `target-projects/goose-hub-self/agent-context/implement.md`

- [ ] **Step 1: Create the file**

```markdown
## Monorepo test commands

Run from worktree **root** using pnpm filter syntax — NOT from `apps/web/`:

| What | Command |
|---|---|
| All packages | `pnpm test` |
| Web only | `pnpm --filter=@goose-hub/web test -- --reporter=verbose` |
| Server only | `pnpm --filter=@goose-hub/server test -- --reporter=verbose` |
| Specific file | `pnpm --filter=@goose-hub/web test -- --reporter=verbose <relative-path>` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |

**First command in any worktree:** `cat package.json` to verify available scripts.

## Before touching any app

- Touching `apps/web/` → read `apps/web/README.md` first
- Touching `apps/server/` → read `apps/server/README.md` first

## Slice structure requirements

Every new slice at `slices/<name>/` MUST include:
- `slice.test.ts` — integration tests (required, not optional)
- `README.md` — purpose, usage, context allowlist

## Import discipline

- Slices import from `core/` using `@goose-hub/core/...` paths only
- Slices NEVER import from other slices
- Never use relative `../../core/...` paths

## Web component test patterns

- jsdom environment: add `/** @vitest-environment jsdom */` at top of test file
- localStorage state: use `localStorage.setItem(...)` in `beforeEach`, NOT `vi.spyOn(Storage.prototype, 'getItem')`
- Before mocking any hook: read the component file and grep its imports first (discipline rule 5)
- `MemoryRouter` is required for any component that uses `Link` or `useNavigate`
```

- [ ] **Step 2: Verify file exists and reads correctly**

```bash
cat target-projects/goose-hub-self/agent-context/implement.md
```

- [ ] **Step 3: Commit**

```bash
git add target-projects/goose-hub-self/agent-context/implement.md
git commit -m "feat(target-projects/goose-hub-self): add implementer project context"
```

---

## Task 10: Create goose-hub-self qa context

**Files:**
- Create: `target-projects/goose-hub-self/agent-context/qa.md`

- [ ] **Step 1: Create the file**

```markdown
## Test commands

| What | Command |
|---|---|
| Full suite | `pnpm test` |
| Web only | `pnpm --filter=@goose-hub/web test -- --reporter=verbose` |
| Server only | `pnpm --filter=@goose-hub/server test -- --reporter=verbose` |
| E2E | `pnpm test:e2e` (only run if `e2eCommand` is provided) |

## Known noise — do not report as findings

- `ERR_DLOPEN_FAILED` on `better-sqlite3` — native module not rebuilt for worktree Node version. Pre-existing environment issue, not a regression introduced by the PR.
- If ALL failures are sqlite noise: mark functional tier `passed`, add one `info`-severity finding noting the sqlite environment noise.

## Slice structure (blocker if absent)

New slices at `slices/<name>/` MUST contain both:
- `slice.test.ts`
- `README.md`

Flag absence of either as a `blocker` finding.

## Cross-slice imports (blocker)

Relative imports between slices (`../other-slice/...`) are forbidden. Flag as `blocker`.

## Import paths

Correct: `@goose-hub/core/...`
Wrong: `../../core/...`

Flag wrong paths as `major` findings.
```

- [ ] **Step 2: Commit**

```bash
git add target-projects/goose-hub-self/agent-context/qa.md
git commit -m "feat(target-projects/goose-hub-self): add QA project context"
```

---

## Task 11: Create goose-hub-self advise-on-plan context

**Files:**
- Create: `target-projects/goose-hub-self/agent-context/advise-on-plan.md`

- [ ] **Step 1: Create the file**

```markdown
## Immutable governance paths — abort immediately if plan touches these

```
MISSION.md
FACTORY_RULES.md
CLAUDE.md
target-projects/**/MISSION.md
target-projects/**/FACTORY_RULES.md
target-projects/**/project.config.ts
target-projects/**/personas/**
docs/PLAN.md
```

Any plan that modifies the above → `abort`.

## Key FACTORY_RULES to verify

| Rule | Check |
|---|---|
| Vertical slices | New features go in `slices/<name>/`, not horizontal layers |
| Slice requirements | Every new slice needs `slice.test.ts` + `README.md` |
| Import isolation | Slices use `@goose-hub/core/...` only; no cross-slice imports |
| No inline prompts | Prompts live in `skills/<name>/skill.md`; not inline in TS |
| One revise pass | Maximum one `revise` verdict per advisor gate (rule 21) |

## Codebase layout

```
core/           — shared utilities, runtime, event stream, types
apps/server/    — Express API, SSE, workflow dispatch
apps/web/       — React frontend (Vite + shadcn/ui)
slices/         — vertical workflow slices (fix-issue, qa, investigate, review)
skills/         — skill prompts (skill.md) and schemas
target-projects/— per-project config and governance
```

## Abort vs revise guidance

| Situation | Verdict |
|---|---|
| Plan modifies governance file | `abort` |
| Plan introduces cross-slice import | `revise` |
| Plan adds new heavyweight dependency without ADR | `revise` |
| Plan adds horizontal layer instead of slice | `revise` |
| Plan modifies immutable path | `abort` |
```

- [ ] **Step 2: Commit**

```bash
git add target-projects/goose-hub-self/agent-context/advise-on-plan.md
git commit -m "feat(target-projects/goose-hub-self): add advisor project context with governance paths"
```

---

## Task 12: Create goose-hub-self evidence-post context

**Files:**
- Create: `target-projects/goose-hub-self/agent-context/evidence-post.md`

- [ ] **Step 1: Create the file**

```markdown
## Playwright command

```bash
pnpm --filter=@goose-hub/web exec playwright test <spec_path>
```

NOT `npx playwright test`. NOT `playwright test` directly.

## Repo

`shaunnez/goose-hub`

## Spec location

Playwright specs live at `apps/web/e2e/issue-<N>.spec.ts`.
If `<spec_path>` points elsewhere, use the `read` tool to verify it exists before running.

## Evidence directory

Create at repo root: `evidence/issue-<N>/`

```bash
mkdir -p evidence/issue-<N>
```
```

- [ ] **Step 2: Commit**

```bash
git add target-projects/goose-hub-self/agent-context/evidence-post.md
git commit -m "feat(target-projects/goose-hub-self): add evidence-post project context"
```

---

## Task 13: Create goose-hub-self investigate context

**Files:**
- Create: `target-projects/goose-hub-self/agent-context/investigate.md`

- [ ] **Step 1: Create the file**

```markdown
## Codebase map — orient here first

```
core/
  agent-runtime/    — agent spawn, context assembly, Claude CLI wrapper, prompt loading
  event-stream/     — SQLite event log (store.ts = appendEvent)
  workflows/        — retrospective workflow
  connectors/       — GitHub API (open-pr.ts)
  persona/          — persona accumulation
  state-source/     — work item abstraction (StateSource interface)
  workspaces/       — worktree management (createWorktree, cleanupWorktree)
apps/
  server/           — Express API, SSE endpoint, workflow dispatch (shared/dispatch.ts)
  web/              — React + Vite + shadcn/ui frontend
slices/
  fix-issue/        — developer workflow (runFixIssueWorkflow)
  investigate/      — investigator workflow (runInvestigateWorkflow)
  qa/               — QA workflow (runQaWorkflow)
  review/           — reviewer workflow (runReviewWorkflow)
skills/             — skill.md prompts and Zod schemas
target-projects/    — per-project config
```

## Key patterns

- Events emitted via `eventStore.appendEvent(...)` in `core/event-stream/store.ts`
- Agent spawned via `AgentSpec` → `ClaudeCliRuntime.run()` in `core/agent-runtime/claude-cli.ts`
- Context filtering in `core/agent-runtime/context-assembly.ts` (holdout isolation here)
- Prompt loading: `readPromptWithContext(skillName, projectId)` in `core/agent-runtime/read-prompt.ts`
- State machine: GitHub label transitions via `StateSource` implementations

## Common bug locations

| Area | Where to look |
|---|---|
| Context leaking to holdouts | `core/agent-runtime/context-assembly.ts` — `renderManifest` |
| Wrong prompt content | `skills/<name>/skill.md` + `target-projects/goose-hub-self/agent-context/<name>.md` |
| Agent spawn config | Slice workflow file `slices/<name>/workflow.ts` |
| Test environment | Workspace `vitest.config.ts` and `apps/web/vitest.config.ts` |
| Worktree isolation | `core/workspaces/worktree.ts` |
```

- [ ] **Step 2: Commit**

```bash
git add target-projects/goose-hub-self/agent-context/investigate.md
git commit -m "feat(target-projects/goose-hub-self): add investigator project context with codebase map"
```

---

## Task 14: Create goose-hub-self spec-author and playwright-repro context

**Files:**
- Create: `target-projects/goose-hub-self/agent-context/spec-author.md`
- Create: `target-projects/goose-hub-self/agent-context/playwright-repro.md`

- [ ] **Step 1: Create spec-author.md**

```markdown
## Playwright config

Read `apps/web/playwright.config.ts` before writing any spec. It defines:
- `webServer` auto-start (do NOT manually start the dev server in the spec)
- Base URL: `http://localhost:5173`

## Known routes

| Route | Page |
|---|---|
| `/` | Project list |
| `/projects/<slug>` | Project overview |
| `/projects/<slug>/issues` | Issue board |
| `/projects/<slug>/issues/<number>` | Issue detail |

## Spec filename

`apps/web/e2e/issue-<number>.spec.ts`
No spaces. No non-ASCII. No slashes in the filename portion.
```

- [ ] **Step 2: Create playwright-repro.md**

```markdown
## App URL

Dev server: `http://localhost:5173`

If `<appUrl>` is not provided, default to `http://localhost:5173`.

## Known routes

| Route | Page |
|---|---|
| `/` | Project list |
| `/projects/<slug>` | Project detail |
| `/projects/<slug>/issues/<number>` | Issue detail |

## Console errors — filter before reporting

- `ERR_DLOPEN_FAILED` on `better-sqlite3` — pre-existing noise, not the bug
- `TypeError`, `ReferenceError`, `Error` — include verbatim in `consoleErrors`
```

- [ ] **Step 3: Commit**

```bash
git add target-projects/goose-hub-self/agent-context/spec-author.md target-projects/goose-hub-self/agent-context/playwright-repro.md
git commit -m "feat(target-projects/goose-hub-self): add spec-author and playwright-repro project context"
```

---

## Task 15: Final verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm test -- --reporter=verbose
```

Expected: all tests pass.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Verify context files are discoverable**

```bash
ls target-projects/goose-hub-self/agent-context/
```

Expected: 7 files — `implement.md`, `qa.md`, `advise-on-plan.md`, `evidence-post.md`, `investigate.md`, `spec-author.md`, `playwright-repro.md`.

- [ ] **Step 4: Smoke test prompt loading manually**

```bash
node --input-type=module <<'EOF'
import { readPromptWithContext } from './core/agent-runtime/read-prompt.js';
const prompt = readPromptWithContext('implement', 'goose-hub-self');
const hasBase = prompt.includes('Red → Green → Refactor');
const hasProject = prompt.includes('Monorepo test commands');
console.log('base present:', hasBase);
console.log('project context present:', hasProject);
if (!hasBase || !hasProject) process.exit(1);
EOF
```

Expected: both `true`.

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -A
git status
# commit any remaining changes
```
