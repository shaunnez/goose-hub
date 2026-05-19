# Milestone Sweep CLI Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `goose sweep <project-slug> <milestone-number>` CLI command that lists all non-terminal issues in a milestone and batch-transitions them to `factory:archived`, enabling clean milestone close-out when issues didn't complete the normal flow.

**Architecture:** The normal `transitionState` validates against the state machine — many mid-flow states can't reach `factory:archived` directly. The sweep needs to force-set a label regardless of current state. Add `forceState(itemId, to)` to `StateSource` (no transition check), implement it in `GitHubLabelsSource` (remove all `factory:*` labels, add the target), then wire up the `sweep` subcommand in the CLI. Terminal states are `factory:done`, `factory:archived`, `factory:rejected`; these are skipped.

**Tech Stack:** TypeScript, Node.js, `tsx`, Vitest, GitHub REST API

---

## File Map

| File | Change |
|------|--------|
| `core/state-source/interface.ts` | Add `forceState(itemId: string, to: StateName): Promise<void>` to `StateSource` |
| `core/state-source/interface.test.ts` | Add stub `forceState` to `StubStateSource` |
| `core/state-source/github-labels.ts` | Implement `forceState` — remove all `factory:*` labels, add target label |
| `core/state-source/github-labels.test.ts` | Add `forceState` unit tests |
| `apps/cli/src/index.ts` | Add `sweep` command |

---

### Task 1: Add forceState to StateSource interface and stub

**Files:**
- Modify: `core/state-source/interface.ts:62-78`
- Modify: `core/state-source/interface.test.ts:13-57`

- [ ] **Step 1: Add forceState to the interface**

In `core/state-source/interface.ts`, add `forceState` after `transitionState`:

```typescript
export interface StateSource {
  projectId: string;
  repoRef: string;

  listOpenWork(): Promise<WorkItem[]>;
  listClosedWorkByMilstone(milestoneNumber: number): Promise<WorkItem[]>;
  getItem(itemId: string): Promise<WorkItem>;
  listMilestones(): Promise<Milestone[]>;
  getActiveMilestone(): Promise<Milestone | null>;

  transitionState(itemId: string, from: StateName, to: StateName, note?: string): Promise<void>;
  forceState(itemId: string, to: StateName): Promise<void>;
  comment(itemId: string, body: string): Promise<void>;
  attach(itemId: string, artifact: Artifact): Promise<void>;
  createIssue(input: CreateIssueInput): Promise<WorkItem>;

  watchForUpdates(callback: (event: SourceEvent) => void): Promise<Subscription>;
}
```

- [ ] **Step 2: Run typecheck to confirm it fails**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: errors in `github-labels.ts` and `interface.test.ts` about missing `forceState`.

- [ ] **Step 3: Add stub to StubStateSource in interface.test.ts**

Add after `transitionState` in `StubStateSource`:

```typescript
forceState(_itemId: string, _to: StateName): Promise<void> {
  return Promise.resolve();
}
```

- [ ] **Step 4: Typecheck — only github-labels.ts should remain broken**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: only `github-labels.ts` error about missing `forceState`.

- [ ] **Step 5: Run interface tests**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run core/state-source/interface.test.ts 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && git add core/state-source/interface.ts core/state-source/interface.test.ts && git commit -m "feat(core): add forceState to StateSource interface"
```

---

### Task 2: Implement forceState in GitHubLabelsSource

**Files:**
- Modify: `core/state-source/github-labels.ts`
- Modify: `core/state-source/github-labels.test.ts`

`forceState` must:
1. Extract the issue number from `itemId` (same as `transitionState`)
2. Fetch current labels from the issue via `GET /repos/{repo}/issues/{number}/labels`
3. DELETE each label whose name starts with `factory:` (skip non-factory labels)
4. POST the target label

- [ ] **Step 1: Write the failing tests**

Add to `core/state-source/github-labels.test.ts`, after the `listClosedWorkByMilstone` describe block:

```typescript
// ---------------------------------------------------------------------------
// forceState
// ---------------------------------------------------------------------------

describe('forceState', () => {
  it('removes all factory:* labels and adds the target label', async () => {
    const existingLabels = [
      { name: 'factory:in-progress' },
      { name: 'type:feature' },
      { name: 'priority:high' },
    ];

    const deletedLabels: string[] = [];
    const postedLabels: string[] = [];

    vi.stubGlobal(
      'fetch',
      mockFetchByUrl((url) => {
        const method = (vi.mocked(global.fetch).mock.calls.at(-1)?.[1] as RequestInit)?.method ?? 'GET';

        // GET labels
        if (url.includes('/labels') && !url.includes('factory:') && method !== 'DELETE' && method !== 'POST') {
          return new Response(JSON.stringify(existingLabels), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // DELETE a label
        if (method === 'DELETE') {
          const label = url.split('/labels/').pop() ?? '';
          deletedLabels.push(decodeURIComponent(label));
          return new Response('', { status: 200 });
        }
        // POST new labels
        if (method === 'POST') {
          return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('[]', { status: 200 });
      }),
    );

    const source = makeSource();
    await source.forceState('github:shaunnez/goose-hub#10', 'factory:archived');

    expect(deletedLabels).toContain('factory:in-progress');
    // Non-factory labels (type:feature, priority:high) must NOT be deleted.
    expect(deletedLabels).not.toContain('type:feature');
    expect(deletedLabels).not.toContain('priority:high');
  });

  it('works when itemId is a plain number string', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl(() =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const source = makeSource();
    // Should not throw
    await expect(source.forceState('42', 'factory:done')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run core/state-source/github-labels.test.ts 2>&1 | tail -20
```

Expected: FAIL — `forceState is not a function`.

- [ ] **Step 3: Implement forceState in github-labels.ts**

Add after `transitionState` in `GitHubLabelsSource`:

```typescript
async forceState(itemId: string, to: StateName): Promise<void> {
  const match = itemId.match(/#(\d+)$/);
  const number = match != null ? match[1] : itemId;

  // Fetch current labels on the issue.
  const labelsUrl = `https://api.github.com/repos/${this.repoRef}/issues/${number}/labels`;
  const labelsRes = await this.ghFetch(labelsUrl);
  const currentLabels = (await labelsRes.json()) as { name: string }[];

  // Remove all factory:* labels.
  for (const label of currentLabels) {
    if (!label.name.startsWith('factory:')) continue;
    const removeUrl = `https://api.github.com/repos/${this.repoRef}/issues/${number}/labels/${encodeURIComponent(label.name)}`;
    const res = await fetch(removeUrl, { method: 'DELETE', headers: this.baseHeaders });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to remove label ${label.name}: ${res.status} ${res.statusText}`);
    }
  }

  // Add the target label.
  const addUrl = `https://api.github.com/repos/${this.repoRef}/issues/${number}/labels`;
  const addRes = await fetch(addUrl, {
    method: 'POST',
    headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels: [to] }),
  });
  if (!addRes.ok) {
    throw new Error(`Failed to add label ${to}: ${addRes.status} ${addRes.statusText}`);
  }
}
```

- [ ] **Step 4: Run all tests in the file**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run core/state-source/github-labels.test.ts 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && git add core/state-source/github-labels.ts core/state-source/github-labels.test.ts && git commit -m "feat(core): implement forceState in GitHubLabelsSource"
```

---

### Task 3: Add the sweep command to the CLI

**Files:**
- Modify: `apps/cli/src/index.ts`

The `sweep` command:
- Usage: `goose sweep <project-slug> <milestone-number>`
- Fetches open issues (`listOpenWork`) filtered by `milestoneId === String(milestoneNumber)`
- Skips issues already in terminal states: `factory:done`, `factory:archived`, `factory:rejected`
- If no non-terminal issues: prints "All issues in milestone #N are already in a terminal state." and exits 0
- If there are non-terminal issues: prints a numbered list, then asks "Archive all N issues? [y/N] "
- If user inputs `y` or `Y`: calls `source.forceState(item.id, 'factory:archived')` for each, prints progress
- If user inputs anything else: prints "Aborted." and exits 0

Note: The CLI reads from stdin. Use Node's `readline` module.

- [ ] **Step 1: Add the readline import and sweepCommand function**

At the top of `apps/cli/src/index.ts`, add the readline import after the existing imports:

```typescript
import { createInterface } from 'node:readline';
```

Then add the `sweepCommand` function before the `switch` statement at the bottom:

```typescript
const TERMINAL_STATES = new Set<string>(['factory:done', 'factory:archived', 'factory:rejected']);

async function sweepCommand(slug: string, milestoneArg: string): Promise<void> {
  if (!slug || !milestoneArg) {
    console.error('Usage: goose sweep <project-slug> <milestone-number>');
    process.exit(1);
  }

  const milestoneNumber = Number(milestoneArg);
  if (Number.isNaN(milestoneNumber)) {
    console.error(`Invalid milestone number: ${milestoneArg}`);
    process.exit(1);
  }

  const config = registry[slug];
  if (!config) {
    console.error(`Unknown project: ${slug}`);
    console.error(`Known projects: ${Object.keys(registry).join(', ')}`);
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN is required. Set it in .env or the environment.');
    process.exit(1);
  }

  const source = new GitHubLabelsSource(config.id, config.source.repo, token);

  let allOpen: WorkItem[];
  try {
    allOpen = await source.listOpenWork();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const inMilestone = allOpen.filter((i) => i.milestoneId === String(milestoneNumber));
  const nonTerminal = inMilestone.filter((i) => !TERMINAL_STATES.has(i.state));

  if (nonTerminal.length === 0) {
    console.log(`All issues in milestone #${milestoneNumber} are already in a terminal state.`);
    process.exit(0);
  }

  console.log(`\nNon-terminal issues in milestone #${milestoneNumber}:\n`);
  for (const item of nonTerminal) {
    const num = `#${item.externalId}`.padStart(5);
    const state = item.state.padEnd(30);
    console.log(`  ${num}  ${state}  ${item.title.slice(0, 45)}`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`\nArchive all ${nonTerminal.length} issue${nonTerminal.length === 1 ? '' : 's'}? [y/N] `, resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }

  let failed = 0;
  for (const item of nonTerminal) {
    try {
      await source.forceState(item.id, 'factory:archived');
      console.log(`  #${item.externalId}: archived`);
    } catch (err) {
      console.error(`  #${item.externalId}: failed — ${(err as Error).message}`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} issue${failed === 1 ? '' : 's'} failed. Re-run to retry.`);
    process.exit(1);
  }

  console.log(`\nDone. ${nonTerminal.length} issue${nonTerminal.length === 1 ? '' : 's'} archived.`);
}
```

- [ ] **Step 2: Wire the sweep case into the switch statement**

Replace the existing `switch` block at the bottom of `apps/cli/src/index.ts`:

```typescript
switch (command) {
  case 'status':
    await statusCommand(args[0] ?? '');
    break;
  case 'sweep':
    await sweepCommand(args[0] ?? '', args[1] ?? '');
    break;
  default:
    console.error('Usage: goose <command> [args]');
    console.error('Commands:');
    console.error('  status <project-slug>           Show open issues and their factory states');
    console.error('  sweep <project-slug> <milestone> Archive non-terminal issues in a milestone');
    process.exit(1);
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Smoke test the help output**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && npx tsx apps/cli/src/index.ts 2>&1
```

Expected output includes:
```
Usage: goose <command> [args]
Commands:
  status <project-slug>           Show open issues and their factory states
  sweep <project-slug> <milestone> Archive non-terminal issues in a milestone
```

- [ ] **Step 5: Smoke test invalid milestone**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && npx tsx apps/cli/src/index.ts sweep goose-hub-self abc 2>&1
```

Expected: `Invalid milestone number: abc`

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && git add apps/cli/src/index.ts && git commit -m "feat(cli): add goose sweep command to archive non-terminal milestone issues"
```

---

## Self-Review

**Spec coverage:**
- `forceState` on interface — Task 1 ✓
- `forceState` implementation removes only `factory:*` labels — Task 2 ✓
- `forceState` adds target label — Task 2 ✓
- `sweep` command filters by milestoneId — Task 3 ✓
- Skips terminal states — Task 3 (`TERMINAL_STATES` set) ✓
- Shows non-terminal issues before prompting — Task 3 ✓
- Prompts for confirmation — Task 3 ✓
- Archives on `y`, aborts otherwise — Task 3 ✓
- Reports per-issue progress — Task 3 ✓
- Exits 1 on partial failure — Task 3 ✓

**Placeholder scan:** No TBDs. All code complete.

**Type consistency:**
- `forceState(itemId: string, to: StateName)` consistent across interface.ts, interface.test.ts, github-labels.ts, and CLI usage ✓
- `TERMINAL_STATES` typed as `Set<string>` — compatible with `item.state` (which is `StateName`, a subtype of `string`) ✓

**Edge cases handled:**
- No non-terminal issues → friendly exit without prompt ✓
- Single failure doesn't abort remaining issues → error count + exit 1 ✓
- `milestoneId` comparison uses `String(milestoneNumber)` matching `WorkItem.milestoneId` format ✓
- `itemId` as plain number or `github:owner/repo#N` format handled in `forceState` (same as `transitionState`) ✓

**What this does NOT handle:**
- Closed issues that slipped through with wrong state — use the GitHub Action plan to prevent future occurrences; for existing ones, close them manually or add a second sweep pass that calls `listClosedWorkByMilstone` and force-states any non-done/archived ones
