# Grill-me Crystallization & Worktree Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the griller worktree access plus a crystallization mechanic so each round derives a precise decision from the prior Q+A, and pass those decisions into write-prd as the authoritative record.

**Architecture:** Combined approach. Each grill-me invocation does two things atomically — crystallize the prior round's Q+A (when one exists) and ask the next question. The workflow extracts the `crystallizedDecision` from each grill output, persists a `grill.decision-crystallized` event, augments `priorReplies` with crystallizations from the event store on every tick, and forwards the enriched `priorReplies` to write-prd. The griller tool bundle moves from `core` (no tools) to `read` (sandboxed read/search/work-item-read), with a per-run worktree created and cleaned up by the workflow.

**Tech Stack:** TypeScript, Zod, Vitest, existing `core/workspaces/worktree.ts` helpers, existing `core/event-stream/store.ts`.

---

## File Structure

**Modified:**
- `skills/grill-me/schema.ts` — add `crystallizedDecision?: string` to `GrillMeOutputSchema`
- `skills/grill-me/skill.config.ts` — add `crystallized?: string` to `priorReplies` agent entries; add `worktreePath: string` to context; change `toolBundles` from `['core']` to `['read']`; extend `contextAllowlist`
- `skills/grill-me/prompt.md` — add code-first rule, crystallization rule, document worktree access
- `skills/grill-me/slice.test.ts` — schema + config tests for new fields and bundle change
- `skills/write-prd/skill.config.ts` — add optional `priorReplies` (with crystallizations) to context
- `skills/write-prd/prompt.md` — instruct prd-writer to treat crystallized decisions as the authoritative record
- `core/workflows/grill-and-prd.ts` — worktree lifecycle, crystallization extraction, priorReplies augmentation from event store, write-prd handoff with priorReplies
- `slices/grill-and-prd/slice.test.ts` — coverage for crystallization, worktree lifecycle, write-prd handoff
- `slices/grill-and-prd/README.md` — document the crystallization flow

**Created:**
- `docs/adr/0034-grill-crystallization-and-worktree.md` — ADR documenting the design

No new top-level directories. No new packages. No state-machine changes.

---

## Task 0: Write ADR

**Files:**
- Create: `docs/adr/0034-grill-crystallization-and-worktree.md`

- [ ] **Step 1: Write the ADR**

```markdown
# ADR 0034 — Grill-me crystallization and worktree access

**Status:** Accepted
**Date:** 2026-05-10
**Supersedes / extends:** ADR 0029 (discover-lane entry)

## Context

The grilling loop produces a chain of Q+A pairs that feeds into write-prd as `priorReplies`. Two problems:

1. The griller has no tools. It can only ask questions the user has to answer, even when the answer sits in CONTEXT.md, an ADR, or the codebase. Round count grows because the griller can't self-serve.
2. write-prd receives raw Q+A transcripts. The semantic distillation — what was actually decided — is implicit and re-derived by every downstream consumer.

## Decision

1. **Tool bundle change.** Grill-me moves from `core` (zero tools) to `read` (sandboxed `read`, `search`, `work-item-read`). Same posture as the investigator skill. No write access.
2. **Worktree per round.** The workflow creates a detached-HEAD worktree before invoking grill-me and cleans it up in a `finally` block. The path is injected into the grill context.
3. **Crystallization at start of each round.** When `priorReplies` is non-empty, grill-me crystallizes the last Q+A pair into a single precise decision (`crystallizedDecision` field on the output). The workflow extracts this, persists a `grill.decision-crystallized` event, and the next tick rehydrates crystallizations from the event store before invoking grill-me again. The same mechanism populates the augmented `priorReplies` passed to write-prd.
4. **No state-machine change.** Same `factory:grilling` ↔ `factory:gate-pending` loop. 7-round hard cap unchanged.

## Consequences

- The crystallized decisions become the durable, queryable record of the grill's outcome. Raw Q+A is preserved as supporting detail but is no longer the primary contract for write-prd.
- The first grill round produces no crystallization (`priorReplies` is empty). Round N's response crystallizes round N-1's Q+A. When the griller returns `readyForPRD: true`, that response also crystallizes the most recent Q+A (the one that satisfied it). No edge case is left uncrystallized.
- Worktree cleanup must be guaranteed on every workflow exit (success, validation failure, exception). The cleanup is per-runId and idempotent.

## Alternatives considered

- **Crystallize immediately after each user answer (separate call).** Cleaner state lifecycle but doubles LLM calls. Rejected for cost; combined approach naturally handles the last round so the edge case advantage disappears.
- **Comment-marker side channel for crystallizations.** Self-contained in source of truth, but pollutes the issue thread and duplicates a record already kept in the event store. Rejected.
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0034-grill-crystallization-and-worktree.md
git commit -m "docs(adr): 0034 — grill crystallization and worktree access"
```

---

## Task 1: Add crystallizedDecision to grill-me output schema

**Files:**
- Modify: `skills/grill-me/schema.ts`
- Test: `skills/grill-me/slice.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `describe('grill-me schema', ...)` block in `skills/grill-me/slice.test.ts`:

```ts
  it('accepts crystallizedDecision when readyForPRD is false', () => {
    const result = GrillMeOutputSchema.safeParse({
      questions: [
        {
          text: 'Is the export CSV-only or also JSON?',
          recommendedAnswer: 'CSV-only per CONTEXT.md export convention.',
        },
      ],
      refinedIntent: 'Add an admin-only audit-log export.',
      readyForPRD: false,
      crystallizedDecision: 'Audience: admin users only.',
      decisionSummaries: [{ kind: 'PLAN', summary: 'Crystallized audience.' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts crystallizedDecision when readyForPRD is true', () => {
    const result = GrillMeOutputSchema.safeParse({
      questions: [],
      refinedIntent: 'Add an admin-only audit-log CSV export.',
      readyForPRD: true,
      crystallizedDecision: 'Format: CSV-only with date-range filter.',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'Final crystallization.' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts output without crystallizedDecision (round 1)', () => {
    const result = GrillMeOutputSchema.safeParse({
      questions: [{ text: 'What audience?' }],
      refinedIntent: 'Build a thing.',
      readyForPRD: false,
      decisionSummaries: [{ kind: 'PLAN', summary: 'Round 1 ask.' }],
    });
    expect(result.success).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @goose-hub/skills test skills/grill-me/slice.test.ts`
Expected: 3 new tests FAIL (or at minimum the two that assert the field is parsed back through). Other existing tests still pass.

- [ ] **Step 3: Add the field to the schema**

Edit `skills/grill-me/schema.ts`:

```ts
export const GrillMeOutputSchema = z.object({
  questions: z
    .array(
      z.object({
        text: z.string(),
        recommendedAnswer: z.string().optional(),
      }),
    )
    .max(1),
  refinedIntent: z.string(),
  readyForPRD: z.boolean(),
  crystallizedDecision: z.string().optional(),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @goose-hub/skills test skills/grill-me/slice.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/grill-me/schema.ts skills/grill-me/slice.test.ts
git commit -m "feat(grill-me): add crystallizedDecision to output schema"
```

---

## Task 2: Update grill-me context schema and tool bundle

**Files:**
- Modify: `skills/grill-me/skill.config.ts`
- Test: `skills/grill-me/slice.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the `describe('grill-me skill config', ...)` block in `skills/grill-me/slice.test.ts`:

```ts
  it('uses the read tool bundle (sandboxed read/search/work-item-read)', () => {
    expect(config.toolBundles).toEqual(['read']);
  });

  it('contextAllowlist includes worktreePath', () => {
    expect(config.contextAllowlist).toContain('worktreePath');
  });

  it('contextSchema accepts a worktreePath', () => {
    const result = GrillMeContextSchema.safeParse({
      workItem: { title: 'T', body: 'B', number: 1 },
      priorReplies: [],
      roundNumber: 1,
      projectContext: validProjectContext,
      worktreePath: '/tmp/wt/run-abc',
    });
    expect(result.success).toBe(true);
  });

  it('contextSchema rejects missing worktreePath', () => {
    const result = GrillMeContextSchema.safeParse({
      workItem: { title: 'T', body: 'B', number: 1 },
      priorReplies: [],
      roundNumber: 1,
      projectContext: validProjectContext,
    });
    expect(result.success).toBe(false);
  });

  it('contextSchema accepts crystallized field on agent priorReplies entries', () => {
    const result = GrillMeContextSchema.safeParse({
      workItem: { title: 'T', body: 'B', number: 1 },
      priorReplies: [
        {
          role: 'agent',
          content: 'Round 1 — what audience?',
          crystallized: 'Audience: admins.',
        },
        { role: 'user', content: 'Admins only.' },
      ],
      roundNumber: 2,
      projectContext: validProjectContext,
      worktreePath: '/tmp/wt/run-abc',
    });
    expect(result.success).toBe(true);
  });
```

Replace the existing `'has toolBundles containing core'` test with the new `'uses the read tool bundle'` assertion above (delete the old one).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @goose-hub/skills test skills/grill-me/slice.test.ts`
Expected: new tests FAIL (toolBundles still `['core']`, schema lacks `worktreePath` and `crystallized`).

- [ ] **Step 3: Update `skills/grill-me/skill.config.ts`**

```ts
import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

export const ProjectContextSchema = z.object({
  stackSummary: z.string(),
  contextMd: z.string(),
  adrSummaries: z.array(
    z.object({
      filename: z.string(),
      title: z.string(),
      status: z.string(),
      oneLiner: z.string(),
    }),
  ),
  claudeMd: z.string(),
});

export const GrillPriorReplyEntrySchema = z.object({
  role: z.enum(['user', 'agent']),
  content: z.string(),
  crystallized: z.string().optional(),
});

export const GrillMeContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number().int(),
  }),
  priorReplies: z.array(GrillPriorReplyEntrySchema),
  roundNumber: z.number().int().min(1),
  projectContext: ProjectContextSchema,
  worktreePath: z.string(),
});

const config: SkillConfig = {
  contextSchema: GrillMeContextSchema,
  toolBundles: ['read'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'griller',
  contextAllowlist: [
    'workItem',
    'priorReplies',
    'roundNumber',
    'projectContext',
    'worktreePath',
  ],
};

export default config;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @goose-hub/skills test skills/grill-me/slice.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/grill-me/skill.config.ts skills/grill-me/slice.test.ts
git commit -m "feat(grill-me): switch to read bundle, add worktreePath + crystallized priorReplies"
```

---

## Task 3: Update grill-me prompt with code-first and crystallization rules

**Files:**
- Modify: `skills/grill-me/prompt.md`

No tests for prompt content — prompt changes are validated by the integration tests in Task 7.

- [ ] **Step 1: Add the code-first rule under "Your job this invocation"**

Insert after the existing "Read `projectContext`..." bullet (the third bullet) in `skills/grill-me/prompt.md`:

```markdown
4. **Code-first rule.** Before asking the user, attempt to answer your candidate question yourself by exploring the worktree. You have `read`, `search`, and `work-item-read` tools rooted at `<worktree_path>`. If the answer is in the codebase, an ADR, CONTEXT.md, or a sibling work item — use it as the basis for `recommendedAnswer` and only ask the user to confirm or override. Only escalate to a fresh question when no source-of-truth artefact answers it.
```

Renumber the subsequent steps (so the original step 4 becomes step 5, etc.).

- [ ] **Step 2: Add the crystallization rule as a new top-level section**

Insert this section between "Your job this invocation" and "When to stop":

```markdown
## Crystallization rule

When `<prior_replies>` contains at least one `agent` entry, the **last unanswered Q+A pair** (an `agent` entry immediately followed by a `user` entry, where that agent entry has no `<crystallized>` child) must be distilled into a single precise statement of what was decided.

- Read the agent's question and the user's reply.
- Produce one sentence — a concrete decision, not a paraphrase. "Format: CSV-only with optional JSON later." beats "User said CSV would be fine."
- Place this string in the top-level `crystallizedDecision` field of your output.
- Do this on **every** round where there is an unanswered Q+A — including the round where you return `readyForPRD: true`. The final round still crystallizes the user's last reply before stopping.
- If `<prior_replies>` has no `agent` entry yet (round 1), omit `crystallizedDecision`.
- If every agent entry already has a `<crystallized>` child, omit `crystallizedDecision` (nothing new to distill — the workflow already captured prior rounds).

The crystallized decision is the authoritative downstream record. Take it as seriously as the next question you ask.
```

- [ ] **Step 3: Update the input section to document worktree access**

Replace the existing input list with:

```markdown
Your context contains:

- `<work_item>` — the work item with `<title>`, `<body>`, and `<number>` fields.
- `<prior_replies>` — the conversation so far (array of `{ role, content, crystallized? }` entries). May be empty for round 1. An `agent` entry's `<crystallized>` child holds the decision distilled from that question and the following user reply. An agent entry starting with `<!-- factory:prd -->` is a previously drafted PRD that the user declined.
- `<round_number>` — which round you are on **right now** (1-based). Authoritative.
- `<project_context>` — `stackSummary`, `contextMd`, `adrSummaries`, `claudeMd`.
- `<worktree_path>` — absolute path to a detached-HEAD worktree of the target repo. Use `read`, `search`, and `work-item-read` against this path to ground questions and recommended answers in actual code rather than asking the user.
```

- [ ] **Step 4: Update the output format JSON example**

In the "Output format" section, the JSON sample becomes:

```json
{
  "questions": [
    {
      "text": "<single focused question>",
      "recommendedAnswer": "<concrete answer grounded in projectContext or worktree exploration>"
    }
  ],
  "refinedIntent": "<one sentence capturing the work item's clarified intent>",
  "readyForPRD": false,
  "crystallizedDecision": "<one sentence: the decision distilled from the last Q+A pair, or omit on round 1>",
  "decisionSummaries": [
    { "kind": "PLAN", "summary": "<what you decided to ask about and why>", "evidence": "<quote or signal>" }
  ]
}
```

- [ ] **Step 5: Commit**

```bash
git add skills/grill-me/prompt.md
git commit -m "feat(grill-me): add code-first and crystallization rules to prompt"
```

---

## Task 4: Add priorReplies (with crystallizations) to write-prd context

**Files:**
- Modify: `skills/write-prd/skill.config.ts`
- Modify: `skills/write-prd/prompt.md`

No new test file — the slice.test.ts in Task 7 covers the integration. Confirm the config still typechecks.

- [ ] **Step 1: Update `skills/write-prd/skill.config.ts`**

```ts
import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { GrillPriorReplyEntrySchema, ProjectContextSchema } from '../grill-me/skill.config.js';
import { PRDOutputSchema } from './schema.js';

export { ProjectContextSchema };

export const WritePRDContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number().int(),
  }),
  refinedIntent: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  projectContext: ProjectContextSchema,
  priorReplies: z.array(GrillPriorReplyEntrySchema).optional(),
  priorPrd: PRDOutputSchema.optional(),
  humanConcerns: z.array(z.string()).optional(),
});

const config: SkillConfig = {
  contextSchema: WritePRDContextSchema,
  toolBundles: ['read', 'core'],
  modelPin: 'opus',
  freshContext: true,
  role: 'prd-writer',
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'refinedIntent',
    'priority',
    'projectContext',
    'priorReplies',
    'priorPrd',
    'humanConcerns',
  ],
};

export default config;
```

- [ ] **Step 2: Update `skills/write-prd/prompt.md` — fresh-context contract section**

Replace the "Fresh-context contract" section's input list with:

```markdown
You run in **fresh context**. The only inputs you can see are:

- `<work_item>` — the work item with `<title>`, `<body>`, and `<number>`.
- `<refined_intent>` — a single-sentence statement of clarified intent (typically produced by the `grill-me` skill).
- `<priority>` — one of `low | medium | high | critical`.
- `<prior_replies>` (optional) — the grilling transcript that produced the refined intent. Each `agent` entry may carry a `<crystallized>` child: a single-sentence decision distilled from that question and its reply. **Treat the crystallized decisions as the authoritative record of what was agreed.** Use the raw Q+A only as supporting detail when a crystallization is ambiguous or absent.
```

- [ ] **Step 3: Add a "Crystallized decisions" subsection right after the fresh-context contract**

Insert:

```markdown
## Crystallized decisions

When `<prior_replies>` is present, walk every `agent` entry's `<crystallized>` child first. These are the contract you must reflect in the PRD — every crystallized decision should be visible somewhere in the output (as a journey constraint, an acceptance criterion, an `outOfScope` entry, an `implementationDecision`, etc.). If a crystallized decision contradicts `<refined_intent>`, the crystallization wins (it is more granular).

Do **not** invent decisions that aren't in either the refined intent or a crystallization. If a section needs information that neither source provides, mark it explicitly as a `UNCERTAINTY` decision summary and write a best-effort placeholder.
```

- [ ] **Step 4: Run typecheck to confirm imports resolve**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/write-prd/skill.config.ts skills/write-prd/prompt.md
git commit -m "feat(write-prd): accept priorReplies with crystallizations as authoritative record"
```

---

## Task 5: Workflow — worktree lifecycle for grill-me

**Files:**
- Modify: `core/workflows/grill-and-prd.ts`
- Test: `slices/grill-and-prd/slice.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `slices/grill-and-prd/slice.test.ts` (in a new `describe` block at the bottom of the file, before the closing of the file):

```ts
describe('grill-and-prd: worktree lifecycle', () => {
  it('creates a worktree before grill, cleans up after, and injects worktreePath into the grill context', async () => {
    const projectId = uniqueProjectId('worktree-lifecycle');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFeatureItem(source, { state: 'factory:grilling' });
    const workItem = await source.getItem(item.externalId);

    const runtime = makeQueuedRuntime([validGrillRound1NotReady()]);

    const createdWith: Array<{ repo: string; runId: string }> = [];
    const cleanedRunIds: string[] = [];
    const createWorktreeImpl = vi.fn((repo: string, runId: string) => {
      createdWith.push({ repo, runId });
      return `/tmp/test-wt/${runId}`;
    });
    const cleanupWorktreeImpl = vi.fn((runId: string) => {
      cleanedRunIds.push(runId);
    });

    await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies: [],
      deps: {
        runtime,
        projectConfig: injectedConfig(),
        createWorktreeImpl,
        cleanupWorktreeImpl,
      },
    });

    expect(createdWith).toHaveLength(1);
    expect(createdWith[0].repo).toBe('/tmp/test-repo');
    expect(cleanedRunIds).toHaveLength(1);
    expect(cleanedRunIds[0]).toBe(createdWith[0].runId);

    const runCall = (runtime.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(runCall.context.worktreePath).toBe(`/tmp/test-wt/${createdWith[0].runId}`);
    expect(runCall.workspaceDir).toBe(`/tmp/test-wt/${createdWith[0].runId}`);
    expect(runCall.toolBundles).toEqual(['read']);
  });

  it('cleans up the worktree even when grill-me throws', async () => {
    const projectId = uniqueProjectId('worktree-cleanup-on-throw');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFeatureItem(source, { state: 'factory:grilling' });
    const workItem = await source.getItem(item.externalId);

    const runtime: AgentRuntime = {
      run: vi.fn().mockRejectedValue(new Error('boom')),
    };

    const cleanedRunIds: string[] = [];
    const createWorktreeImpl = vi.fn((_repo: string, runId: string) => `/tmp/test-wt/${runId}`);
    const cleanupWorktreeImpl = vi.fn((runId: string) => {
      cleanedRunIds.push(runId);
    });

    const result = await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies: [],
      deps: {
        runtime,
        projectConfig: injectedConfig(),
        createWorktreeImpl,
        cleanupWorktreeImpl,
      },
    });

    expect(result.phase).toBe('grilling');
    expect(cleanedRunIds).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run slices/grill-and-prd/slice.test.ts`
Expected: FAIL — `deps.createWorktreeImpl` not recognised; `worktreePath` missing from context; `toolBundles` is `['core']`.

- [ ] **Step 3: Extend `RunGrillAndPrdInput.deps` and add lifecycle to the workflow**

Edit `core/workflows/grill-and-prd.ts`. Add the imports at the top with the existing imports:

```ts
import { cleanupWorktree, createWorktree } from '../workspaces/worktree.js';
```

Extend the `deps` interface (inside `RunGrillAndPrdInput`):

```ts
  deps?: {
    runtime?: AgentRuntime;
    projectConfig?: Pick<ProjectConfig, 'budgets' | 'stack' | 'targetRepo'> | null;
    totalSpendForSkill?: (projectId: string, skill: string) => number;
    buildContext?: (localPath: string) => Promise<ProjectContextBundle>;
    createWorktreeImpl?: typeof createWorktree;
    cleanupWorktreeImpl?: typeof cleanupWorktree;
  };
```

Inside `runGrillAndPrdWorkflow`, near the top after the existing `deps` destructuring, add:

```ts
  const createWorktreeFn = deps.createWorktreeImpl ?? createWorktree;
  const cleanupWorktreeFn = deps.cleanupWorktreeImpl ?? cleanupWorktree;
```

Skip worktree creation in revise mode (write-prd doesn't need it). After the revise-mode early return and before the `roundNumber` calculation, create the worktree:

```ts
  // Create per-round worktree for grill-me read-only exploration. The path is
  // injected into context and used as the agent's CWD via workspaceDir.
  const localRepoPath = (projectConfig as ProjectConfig | null)?.targetRepo?.localPath;
  if (localRepoPath == null || localRepoPath === '') {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: {
        skill: 'grill-and-prd',
        error: 'cannot create worktree: targetRepo.localPath is missing',
      },
    });
    return { phase: 'needs-human' };
  }
  const expandedRepoPath = localRepoPath.startsWith('~/')
    ? join(process.env.HOME ?? '/root', localRepoPath.slice(2))
    : localRepoPath;
  const worktreePath = createWorktreeFn(expandedRepoPath, runId);
```

Wrap the entire grill-me block (everything up to the point where the workflow either returns `phase: 'grilling'` or proceeds to `runWritePrdStep`) in a `try { ... } finally { cleanupWorktreeFn(runId); }`. The cleanest way: extract the grill phase into an inner async function or thread the cleanup through both exit paths. **Implementation note for the executor:** convert the existing in-line grill block into a `try/finally` where the `finally` runs `cleanupWorktreeFn(runId)` regardless of which branch exits.

In the `runtime.run({...})` call for grill-me, change the context and add `workspaceDir`:

```ts
    const grillResult = await runtime.run({
      runId,
      role: 'griller',
      skill: 'grill-me',
      workspaceDir: worktreePath,
      context: {
        projectId,
        workItemId: workItem.id,
        workItem: {
          title: workItem.title,
          body: workItem.body,
          number: Number(workItem.externalId),
        },
        priorReplies,
        roundNumber,
        projectContext: fullProjectContext,
        worktreePath,
      },
      contextAllowlist: ['workItem', 'priorReplies', 'roundNumber', 'projectContext', 'worktreePath'],
      freshContext: false,
      toolBundles: ['read'],
      toolExtras: [],
      ...grillBudget,
      personaId: grillerPersona.personaId,
      appendSystemPrompt: grillPrompt,
      outputJsonSchema: grillJsonSchema,
      extraEventPayload: { roundNumber },
    });
```

Make sure `import { join } from 'node:path';` exists at the top of the file (it already does).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run slices/grill-and-prd/slice.test.ts`
Expected: the two new lifecycle tests PASS, all existing tests still PASS (existing tests don't pass `createWorktreeImpl`, so the workflow falls back to the real `createWorktree` — but `injectedConfig()` provides `targetRepo.localPath: '/tmp/test-repo'` which doesn't exist on disk, so existing tests will now fail unless they also inject a stub).

- [ ] **Step 5: Update existing tests in `slices/grill-and-prd/slice.test.ts` to inject worktree stubs**

Add a helper near the top of the test file:

```ts
function noopWorktreeDeps() {
  return {
    createWorktreeImpl: (_repo: string, runId: string) => `/tmp/wt/${runId}`,
    cleanupWorktreeImpl: (_runId: string) => undefined,
  };
}
```

Update every existing `runGrillAndPrdWorkflow({ ... deps: { runtime, projectConfig: injectedConfig() } })` call to spread the noop stubs:

```ts
      deps: { runtime, projectConfig: injectedConfig(), ...noopWorktreeDeps() },
```

- [ ] **Step 6: Run all slice tests**

Run: `pnpm vitest run slices/grill-and-prd/slice.test.ts`
Expected: PASS for every test.

- [ ] **Step 7: Commit**

```bash
git add core/workflows/grill-and-prd.ts slices/grill-and-prd/slice.test.ts
git commit -m "feat(grill-and-prd): create per-round worktree, inject path into grill context"
```

---

## Task 6: Workflow — extract crystallization, persist event, augment priorReplies

**Files:**
- Modify: `core/workflows/grill-and-prd.ts`
- Test: `slices/grill-and-prd/slice.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `slices/grill-and-prd/slice.test.ts`:

```ts
describe('grill-and-prd: crystallization', () => {
  it('persists grill.decision-crystallized when grill output includes one', async () => {
    const projectId = uniqueProjectId('crystallize-mid');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFeatureItem(source, { state: 'factory:gate-pending' });
    const workItem = await source.getItem(item.externalId);

    const grillOutput = {
      questions: [
        { text: 'Round 2 question?', recommendedAnswer: 'Recommended.' },
      ],
      refinedIntent: 'A more refined thing.',
      readyForPRD: false,
      crystallizedDecision: 'Audience: admin users only.',
      decisionSummaries: [{ kind: 'PLAN', summary: 'Crystallized round 1.' }],
    };
    const runtime = makeQueuedRuntime([grillOutput]);

    const priorReplies = [
      { role: 'agent' as const, content: '<!-- factory:grill-question -->\n**Round 1** — what audience?' },
      { role: 'user' as const, content: 'Admins only.' },
    ];

    await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies,
      deps: { runtime, projectConfig: injectedConfig(), ...noopWorktreeDeps() },
    });

    const evs = eventStore.replay({ projectId, workItemId: workItem.id });
    const crystEv = evs.find((e) => e.kind === 'grill.decision-crystallized');
    expect(crystEv).toBeDefined();
    expect((crystEv?.payload as { roundNumber: number }).roundNumber).toBe(1);
    expect((crystEv?.payload as { decision: string }).decision).toBe('Audience: admin users only.');
  });

  it('attaches prior crystallizations to priorReplies before invoking grill-me', async () => {
    const projectId = uniqueProjectId('crystallize-rehydrate');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFeatureItem(source, { state: 'factory:gate-pending' });
    const workItem = await source.getItem(item.externalId);

    // Seed a prior crystallization in the event store.
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'grill.decision-crystallized',
      payload: { roundNumber: 1, decision: 'Audience: admin users only.' },
    });

    const runtime = makeQueuedRuntime([
      {
        questions: [{ text: 'Round 3 question?' }],
        refinedIntent: 'Sharper.',
        readyForPRD: false,
        crystallizedDecision: 'Format: CSV-only.',
        decisionSummaries: [{ kind: 'PLAN', summary: 'Asked next.' }],
      },
    ]);

    const priorReplies = [
      { role: 'agent' as const, content: '<!-- factory:grill-question -->\n**Round 1** — audience?' },
      { role: 'user' as const, content: 'Admins.' },
      { role: 'agent' as const, content: '<!-- factory:grill-question -->\n**Round 2** — format?' },
      { role: 'user' as const, content: 'CSV.' },
    ];

    await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies,
      deps: { runtime, projectConfig: injectedConfig(), ...noopWorktreeDeps() },
    });

    const runCall = (runtime.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const passed = runCall.context.priorReplies as Array<{ role: string; crystallized?: string }>;
    expect(passed[0].role).toBe('agent');
    expect(passed[0].crystallized).toBe('Audience: admin users only.');
    expect(passed[2].role).toBe('agent');
    expect(passed[2].crystallized).toBeUndefined();
  });

  it('forwards augmented priorReplies (with crystallizations) to write-prd on readyForPRD', async () => {
    const projectId = uniqueProjectId('crystallize-handoff');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFeatureItem(source, { state: 'factory:gate-pending' });
    const workItem = await source.getItem(item.externalId);

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'grill.decision-crystallized',
      payload: { roundNumber: 1, decision: 'Audience: admin users only.' },
    });

    const runtime = makeQueuedRuntime([
      {
        questions: [],
        refinedIntent: 'Final.',
        readyForPRD: true,
        crystallizedDecision: 'Format: CSV-only.',
        decisionSummaries: [{ kind: 'VERDICT', summary: 'Done.' }],
      },
      validPRD(),
    ]);

    const priorReplies = [
      { role: 'agent' as const, content: '<!-- factory:grill-question -->\n**Round 1** — audience?' },
      { role: 'user' as const, content: 'Admins.' },
      { role: 'agent' as const, content: '<!-- factory:grill-question -->\n**Round 2** — format?' },
      { role: 'user' as const, content: 'CSV.' },
    ];

    await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies,
      deps: { runtime, projectConfig: injectedConfig(), ...noopWorktreeDeps() },
    });

    const writePrdCall = (runtime.run as ReturnType<typeof vi.fn>).mock.calls[1][0];
    const passed = writePrdCall.context.priorReplies as Array<{ role: string; crystallized?: string }>;
    expect(passed).toBeDefined();
    expect(passed[0].crystallized).toBe('Audience: admin users only.');
    expect(passed[2].crystallized).toBe('Format: CSV-only.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run slices/grill-and-prd/slice.test.ts`
Expected: the three new tests FAIL — workflow doesn't emit `grill.decision-crystallized`, doesn't augment `priorReplies`, doesn't forward to write-prd.

- [ ] **Step 3: Add a helper to augment priorReplies from event-store crystallizations**

In `core/workflows/grill-and-prd.ts`, add this function (top-level, near the other helpers):

```ts
/**
 * Walk the event-store crystallizations for a work item and attach each
 * decision to its corresponding `agent` entry in priorReplies. Round N's
 * crystallization decorates the Nth agent entry (1-indexed).
 */
function augmentPriorRepliesWithCrystallizations(
  priorReplies: Array<{ role: 'user' | 'agent'; content: string; crystallized?: string }>,
  projectId: string,
  workItemId: string,
): Array<{ role: 'user' | 'agent'; content: string; crystallized?: string }> {
  const events = eventStore.replay({ projectId, workItemId });
  const byRound = new Map<number, string>();
  for (const ev of events) {
    if (ev.kind !== 'grill.decision-crystallized') continue;
    const payload = ev.payload as { roundNumber?: number; decision?: string };
    if (typeof payload.roundNumber !== 'number' || typeof payload.decision !== 'string') continue;
    byRound.set(payload.roundNumber, payload.decision);
  }
  let agentIdx = 0;
  return priorReplies.map((entry) => {
    if (entry.role !== 'agent') return entry;
    agentIdx += 1;
    const decision = byRound.get(agentIdx);
    return decision != null ? { ...entry, crystallized: decision } : entry;
  });
}
```

- [ ] **Step 4: Use the helper before the grill call and emit the new crystallization event**

Inside `runGrillAndPrdWorkflow`, before computing `roundNumber`, augment priorReplies:

```ts
  const augmentedPriorReplies = augmentPriorRepliesWithCrystallizations(
    priorReplies,
    projectId,
    workItem.id,
  );
  const roundNumber = augmentedPriorReplies.filter((r) => r.role === 'agent').length + 1;
```

In the runtime.run context (Task 5 step 3), replace `priorReplies` with `priorReplies: augmentedPriorReplies`.

After `grillOutput = parsed.data;` succeeds, persist the new crystallization (if any) before any other emission. The crystallization belongs to the most recent prior round = `roundNumber - 1`:

```ts
    if (
      typeof grillOutput.crystallizedDecision === 'string' &&
      grillOutput.crystallizedDecision.trim() !== '' &&
      roundNumber > 1
    ) {
      eventStore.appendEvent({
        kind: 'grill.decision-crystallized',
        projectId,
        workItemId: workItem.id,
        runId,
        payload: {
          roundNumber: roundNumber - 1,
          decision: grillOutput.crystallizedDecision.trim(),
        },
      });
    }
```

- [ ] **Step 5: Pass augmented priorReplies through to write-prd**

Change the `runWritePrdStep({...})` call sites (both the readyForPRD path AND the existing handoff inside the workflow) to include `priorReplies`:

```ts
  return runWritePrdStep({
    workItem,
    stateSource,
    projectId,
    runId,
    runtime,
    projectConfig,
    totalSpendForSkill,
    fullProjectContext,
    refinedIntent: grillOutput.refinedIntent,
    priorReplies: augmentPriorRepliesWithCrystallizations(
      augmentedPriorReplies,
      projectId,
      workItem.id,
    ),
  });
```

(The double augment looks redundant — it isn't. The first augment ran before the grill emitted its new event; we re-augment here so the round-`N-1` crystallization the griller just produced is included.)

Update `WritePrdStepInput` to accept the new field:

```ts
interface WritePrdStepInput {
  workItem: WorkItem;
  stateSource: StateSource;
  projectId: string;
  runId: string;
  runtime: AgentRuntime;
  projectConfig: Pick<ProjectConfig, 'budgets' | 'stack' | 'targetRepo'> | null | undefined;
  totalSpendForSkill: (projectId: string, skill: string) => number;
  fullProjectContext: ProjectContextBundle;
  refinedIntent: string;
  priorPrd?: PRDOutput;
  humanConcerns?: string[];
  priorReplies?: Array<{ role: 'user' | 'agent'; content: string; crystallized?: string }>;
}
```

Inside `runWritePrdStep`, plumb it into the runtime call:

```ts
    const prdResult = await runtime.run({
      runId,
      role: 'prd-writer',
      skill: 'write-prd',
      context: {
        projectId,
        workItemId: workItem.id,
        workItem: {
          title: workItem.title,
          body: workItem.body,
          number: Number(workItem.externalId),
        },
        refinedIntent,
        priority: workItem.priority,
        projectContext: fullProjectContext,
        ...(priorReplies != null ? { priorReplies } : {}),
        ...(priorPrd != null ? { priorPrd } : {}),
        ...(humanConcerns != null ? { humanConcerns } : {}),
      },
      contextAllowlist: [
        'workItem.title',
        'workItem.body',
        'workItem.number',
        'refinedIntent',
        'priority',
        'projectContext',
        'priorReplies',
        'priorPrd',
        'humanConcerns',
      ],
      ...
    });
```

(Add `priorReplies` to the destructure at the top of `runWritePrdStep` and inside `input`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run slices/grill-and-prd/slice.test.ts`
Expected: all crystallization tests PASS, all existing tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add core/workflows/grill-and-prd.ts slices/grill-and-prd/slice.test.ts
git commit -m "feat(grill-and-prd): persist crystallizations, augment priorReplies, forward to write-prd"
```

---

## Task 7: End-to-end smoke test for combined approach

**Files:**
- Test: `slices/grill-and-prd/slice.test.ts`

- [ ] **Step 1: Write a 3-round end-to-end test**

Append to `slices/grill-and-prd/slice.test.ts`:

```ts
describe('grill-and-prd: 3-round combined approach end-to-end', () => {
  it('crystallizes each round, accumulates decisions, hands them to write-prd', async () => {
    const projectId = uniqueProjectId('e2e-3-round');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFeatureItem(source, { state: 'factory:grilling' });

    // Round 1 — no priorReplies, no crystallization in output
    const round1Output = {
      questions: [{ text: 'Audience?' }],
      refinedIntent: 'Build a thing for someone.',
      readyForPRD: false,
      decisionSummaries: [{ kind: 'PLAN', summary: 'Round 1.' }],
    };
    // Round 2 — crystallizes round 1
    const round2Output = {
      questions: [{ text: 'Format?' }],
      refinedIntent: 'Build a thing for admins.',
      readyForPRD: false,
      crystallizedDecision: 'Audience: admin users only.',
      decisionSummaries: [{ kind: 'PLAN', summary: 'Round 2.' }],
    };
    // Round 3 — crystallizes round 2 AND signals readyForPRD
    const round3Output = {
      questions: [],
      refinedIntent: 'Add an admin-only audit-log CSV export.',
      readyForPRD: true,
      crystallizedDecision: 'Format: CSV-only.',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'Round 3.' }],
    };

    // Round 1
    let runtime = makeQueuedRuntime([round1Output]);
    let workItem = await source.getItem(item.externalId);
    await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies: [],
      deps: { runtime, projectConfig: injectedConfig(), ...noopWorktreeDeps() },
    });

    // Round 2 — simulate the user reply being appended
    await source.comment(item.externalId, 'Admins only.');
    runtime = makeQueuedRuntime([round2Output]);
    workItem = await source.getItem(item.externalId);
    const r2Comments = await source.listComments(item.externalId);
    const r2PriorReplies = r2Comments
      .filter((c) => !c.body.startsWith('<!-- factory:system -->'))
      .map((c) => ({
        role: c.body.startsWith('<!-- factory:grill-question -->')
          ? ('agent' as const)
          : ('user' as const),
        content: c.body,
      }));
    await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies: r2PriorReplies,
      deps: { runtime, projectConfig: injectedConfig(), ...noopWorktreeDeps() },
    });

    // Round 3 — simulate the second user reply
    await source.comment(item.externalId, 'CSV.');
    runtime = makeQueuedRuntime([round3Output, validPRD()]);
    workItem = await source.getItem(item.externalId);
    const r3Comments = await source.listComments(item.externalId);
    const r3PriorReplies = r3Comments
      .filter((c) => !c.body.startsWith('<!-- factory:system -->'))
      .map((c) => ({
        role: c.body.startsWith('<!-- factory:grill-question -->')
          ? ('agent' as const)
          : ('user' as const),
        content: c.body,
      }));
    const r3Result = await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies: r3PriorReplies,
      deps: { runtime, projectConfig: injectedConfig(), ...noopWorktreeDeps() },
    });

    expect(r3Result.phase).toBe('prd-review');

    // Both crystallizations should have landed in the event store.
    const evs = eventStore.replay({ projectId, workItemId: workItem.id });
    const crystEvs = evs.filter((e) => e.kind === 'grill.decision-crystallized');
    expect(crystEvs).toHaveLength(2);
    expect(crystEvs.map((e) => (e.payload as { roundNumber: number }).roundNumber).sort()).toEqual([
      1, 2,
    ]);

    // write-prd should have received priorReplies with both crystallizations.
    const writePrdCall = (runtime.run as ReturnType<typeof vi.fn>).mock.calls[1][0];
    const passed = writePrdCall.context.priorReplies as Array<{
      role: string;
      crystallized?: string;
    }>;
    const crystallizedAgents = passed.filter(
      (p) => p.role === 'agent' && typeof p.crystallized === 'string',
    );
    expect(crystallizedAgents).toHaveLength(2);
    expect(crystallizedAgents[0].crystallized).toBe('Audience: admin users only.');
    expect(crystallizedAgents[1].crystallized).toBe('Format: CSV-only.');
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run slices/grill-and-prd/slice.test.ts`
Expected: PASS for the new end-to-end test plus all earlier tests.

- [ ] **Step 3: Run the full suite**

Run: `pnpm typecheck && pnpm test && pnpm --filter @goose-hub/web build && pnpm --filter @goose-hub/server build`
Expected: PASS on all four.

- [ ] **Step 4: Commit**

```bash
git add slices/grill-and-prd/slice.test.ts
git commit -m "test(grill-and-prd): 3-round end-to-end combined-approach smoke"
```

---

## Task 8: Update README and ship

**Files:**
- Modify: `slices/grill-and-prd/README.md`

- [ ] **Step 1: Add a "Crystallization" section to the README**

Insert after the existing "priorReplies contract" section:

```markdown
## Crystallization

Each grill round (after round 1) distils the prior Q+A pair into a single-sentence decision recorded as a `grill.decision-crystallized` event in the local event store. The workflow rebuilds `priorReplies` from issue comments on every tick and re-attaches crystallizations from the event store before invoking grill-me, so the griller always sees the chain of prior decisions.

When `readyForPRD: true`, the same workflow tick:
1. Crystallizes the most recent Q+A.
2. Re-augments `priorReplies` with the just-emitted crystallization.
3. Forwards the augmented array to write-prd as the authoritative record.

Round 1 emits no crystallization (no Q+A exists yet). The round that flips `readyForPRD` to true also crystallizes the user's last answer — there is no uncrystallized tail.

## Worktree access

Grill-me runs with the `read` tool bundle (sandboxed `read`, `search`, `work-item-read`) against a per-round detached-HEAD worktree of the target repo. The workflow creates the worktree before the grill call and cleans it up in a `finally` block (covers success, validation failure, and exception paths). The path is injected into context as `worktreePath` and used as the agent's `cwd` via the runtime's `workspaceDir` parameter.
```

- [ ] **Step 2: Commit**

```bash
git add slices/grill-and-prd/README.md
git commit -m "docs(grill-and-prd): document crystallization + worktree access"
```

- [ ] **Step 3: Open PR**

Title: `feat(grill-and-prd): combined crystallization + worktree access`
Body: link this plan, the ADR (`docs/adr/0034-…`), and any tracking issue. Include `Closes #N` if a tracking issue exists.

---

## Self-Review Checklist (already applied)

1. **Spec coverage.** Both pillars of the user-confirmed combined approach are covered:
   - Worktree + read bundle: Tasks 2, 5.
   - Crystallization (combined within grill rounds, last round still crystallizes): Tasks 1, 3, 6, 7.
   - write-prd consumes crystallized priorReplies: Tasks 4, 6.
2. **No placeholders.** Every code block contains the actual code, not "implement here". Test bodies include real assertions and real fixtures.
3. **Type consistency.** `crystallized` (priorReplies entry) and `crystallizedDecision` (top-level grill output) are kept distinct on purpose: the former is the persisted attribute on history, the latter is the per-round emission. Both are typed as `string | undefined`. The `GrillPriorReplyEntrySchema` is exported from `skills/grill-me/skill.config.ts` and re-imported in `skills/write-prd/skill.config.ts`.
4. **No state-machine changes.** The `factory:grilling` ↔ `factory:gate-pending` loop is unchanged; the 7-round cap inside `runGrillAndPrdWorkflow` continues to enforce.
5. **Holdout discipline.** No holdout role gains anything new. The `read` bundle is already approved for the `griller` role (it's the same bundle the investigator uses). PRD-writer remains a holdout — it sees `priorReplies` only with the crystallizations the workflow attaches, never decision-summaries from grill-me.
