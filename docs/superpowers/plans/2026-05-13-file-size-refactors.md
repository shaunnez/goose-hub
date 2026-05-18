# File Size Refactors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split 11 production files that exceed reasonable size thresholds by extracting cohesive function groups into focused sibling modules, leaving each original file as the canonical public surface.

**Architecture:** Pure mechanical extractions — no logic changes, no new behaviour. Each task moves a cluster of functions to a new sibling file and re-imports them in the original. All existing tests must pass before and after each task. Tasks are fully independent and can be run in parallel by separate subagents.

**Tech Stack:** TypeScript, pnpm, Vitest (`pnpm test`), `pnpm typecheck`

---

## Shared conventions

- `dispatch.ts` is excluded — a separate agent is already working on it.
- Every extracted file lives alongside the original (same directory), named to describe the group of symbols it holds.
- The original file re-imports from the new file; public import paths for callers do not change.
- No logic changes. If you find a bug while moving code, open a new issue — don't fix it here.
- After each task: `pnpm typecheck && pnpm test` must pass.
- Commit after each task — do not batch.

---

## Task 1: Split `apps/web/src/lib/api.ts` → domain API modules

**Files:**
- Create: `apps/web/src/lib/api/client.ts`
- Create: `apps/web/src/lib/api/issues.ts`
- Create: `apps/web/src/lib/api/milestones.ts`
- Create: `apps/web/src/lib/api/settings.ts`
- Create: `apps/web/src/lib/api/roster.ts`
- Create: `apps/web/src/lib/api/inbox.ts`
- Create: `apps/web/src/lib/api/playbooks.ts`
- Create: `apps/web/src/lib/api/bootstrap.ts`
- Modify: `apps/web/src/lib/api.ts` (becomes a re-export barrel)

- [ ] **Step 1: Confirm baseline**

```bash
pnpm typecheck && pnpm test
```

Expected: all pass.

- [ ] **Step 2: Create `client.ts` with HTTP primitives**

Move the four base helpers out of `api.ts` (lines ~35–79):

```typescript
// apps/web/src/lib/api/client.ts
const BASE = import.meta.env.VITE_API_BASE ?? '';

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  // move body verbatim from api.ts
}
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  // move body verbatim from api.ts
}
export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  // move body verbatim from api.ts
}
export async function deleteRequest(path: string): Promise<void> {
  // move body verbatim from api.ts
}
```

- [ ] **Step 3: Create `issues.ts`**

Move all issue/PRD/diff/cost functions. Imports from `./client.ts` and `../types.ts`:

```typescript
// apps/web/src/lib/api/issues.ts
import { getJson, postJson, patchJson } from './client.js';
import type { WorkItemDto, IssueDiffDto, WorkItemCostsDto, IssueCommentDto } from '../types.js';

// Functions to move from api.ts:
// fetchIssues, fetchIssue, fetchClosedIssues, fetchMilestoneIssues,
// fetchIssueDiff, fetchIssueCosts,
// approveIssue, rejectIssue, approvePRD, rejectPRD, revisePRD, declinePRD, proceedToPrd,
// fetchComments, addComment, setLabel, resumeIssue, startFakeRun, transitionState,
// fetchTriageResult, fetchEvents, fetchEventsPage, setRepoOverride
```

- [ ] **Step 4: Create `milestones.ts`**

```typescript
// apps/web/src/lib/api/milestones.ts
import { getJson, postJson, patchJson, deleteRequest } from './client.js';
import type { MilestoneDto } from '../types.js';

// Functions to move:
// fetchMilestones, fetchActiveMilestone, setActiveMilestone,
// createMilestone, updateMilestone, deleteMilestone,
// fetchSprintReviewEligibility, triggerSprintReview, setMilestone
```

- [ ] **Step 5: Create `settings.ts`**

```typescript
// apps/web/src/lib/api/settings.ts
import { getJson, postJson, patchJson, deleteRequest } from './client.js';
import type { ProjectConfigDto, ProjectSettingsDto } from '../types.js';

// Functions to move:
// fetchProjectSettings, patchGlobalBudgetSettings, patchSkillBudgetSetting,
// deleteSkillBudgetSetting, resetAllProjectBudgets,
// fetchCodexAuthStatus, fetchDevReviewSettings, patchDevReviewSettings,
// fetchPipelineSettings, patchPipelineSettings, fetchReviewSettings, patchReviewSettings
```

- [ ] **Step 6: Create `roster.ts`**

```typescript
// apps/web/src/lib/api/roster.ts
import { getJson, postJson } from './client.js';
import type { PersonaStatDto, PersonaNameDto, PersonaRunDto, PersonaCandidateDto, ImprovementCandidateDto, QualityTrendDto, CostSummaryDto } from '../types.js';

// Functions to move:
// fetchRoster, fetchPersonaNames, fetchPersonaRuns, fetchPersonaCandidates,
// fetchQualityTrend, approveCandidateById, rejectCandidateById, fetchCostSummary
```

- [ ] **Step 7: Create `inbox.ts`**

```typescript
// apps/web/src/lib/api/inbox.ts
import { getJson, postJson, deleteRequest } from './client.js';
import type { InboxItemDto } from '../types.js';

// Functions to move:
// createInboxItem, fetchInboxItems, promoteInboxItem, deleteInboxItem
```

- [ ] **Step 8: Create `playbooks.ts`**

```typescript
// apps/web/src/lib/api/playbooks.ts
import { getJson, postJson } from './client.js';
import type { PlaybookSummaryDto, PlaybookDetailDto } from '../types.js';

// Functions to move: fetchPlaybooks, fetchPlaybook, createPlaybook
```

- [ ] **Step 9: Create `bootstrap.ts`**

```typescript
// apps/web/src/lib/api/bootstrap.ts
import { getJson, postJson } from './client.js';
import type { BootstrapPreviewDto, BootstrapRunDto, ProjectSummary } from '../types.js';

// Functions to move: fetchProjects, fetchProjectConfigs, previewBootstrap, runBootstrap
```

- [ ] **Step 10: Convert `api.ts` to a re-export barrel**

Replace the entire contents of `apps/web/src/lib/api.ts` with:

```typescript
// Re-export barrel — keeps all existing import paths valid.
export * from './api/client.js';
export * from './api/issues.js';
export * from './api/milestones.js';
export * from './api/settings.js';
export * from './api/roster.js';
export * from './api/inbox.js';
export * from './api/playbooks.js';
export * from './api/bootstrap.js';
```

- [ ] **Step 11: Typecheck and test**

```bash
pnpm typecheck && pnpm test
```

Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/api/
git commit -m "refactor: split api.ts into domain modules under api/"
```

---

## Task 2: Split `apps/cli/src/index.ts` → command modules

**Files:**
- Create: `apps/cli/src/commands/status.ts`
- Create: `apps/cli/src/commands/sweep.ts`
- Create: `apps/cli/src/commands/agent.ts`
- Create: `apps/cli/src/commands/task-move.ts`
- Create: `apps/cli/src/commands/playbook.ts`
- Create: `apps/cli/src/commands/skill.ts`
- Modify: `apps/cli/src/index.ts`

The existing `bootstrap-command.ts` is the pattern to follow.

- [ ] **Step 1: Confirm baseline**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 2: Extract `statusCommand` (lines ~34–138)**

```typescript
// apps/cli/src/commands/status.ts
// Move all imports that statusCommand needs from index.ts.
// Move the function body verbatim.
export async function statusCommand(slug: string): Promise<void> {
  // ... verbatim body
}
```

- [ ] **Step 3: Extract `sweepCommand` (lines ~139–224)**

```typescript
// apps/cli/src/commands/sweep.ts
export async function sweepCommand(slug: string, milestoneArg: string): Promise<void> {
  // ... verbatim body
}
```

- [ ] **Step 4: Extract `runAgentCommand` (lines ~225–359)**

```typescript
// apps/cli/src/commands/agent.ts
export async function runAgentCommand(rawArgs: string[]): Promise<void> {
  // ... verbatim body
}
```

- [ ] **Step 5: Extract `taskMoveCommand` (lines ~360–468)**

```typescript
// apps/cli/src/commands/task-move.ts
export async function taskMoveCommand(rawArgs: string[]): Promise<void> {
  // ... verbatim body
}
```

- [ ] **Step 6: Extract `playbookCommand` (lines ~469–535)**

```typescript
// apps/cli/src/commands/playbook.ts
export async function playbookCommand(subArgs: string[]): Promise<void> {
  // ... verbatim body
}
```

- [ ] **Step 7: Extract `skillCommand` (lines ~536–end)**

```typescript
// apps/cli/src/commands/skill.ts
export async function skillCommand(subArgs: string[]): Promise<void> {
  // ... verbatim body
}
```

- [ ] **Step 8: Update `index.ts` to import from command modules**

Replace each function definition with an import. Only CLI wiring (argv parsing, switch/case dispatch) remains in `index.ts`:

```typescript
import { statusCommand } from './commands/status.js';
import { sweepCommand } from './commands/sweep.js';
import { runAgentCommand } from './commands/agent.js';
import { taskMoveCommand } from './commands/task-move.js';
import { playbookCommand } from './commands/playbook.js';
import { skillCommand } from './commands/skill.js';
```

- [ ] **Step 9: Typecheck and test**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 10: Commit**

```bash
git add apps/cli/src/index.ts apps/cli/src/commands/
git commit -m "refactor: extract CLI commands from index.ts into commands/"
```

---

## Task 3: Split `core/state-source/github-labels.ts` → issue mapper

**Files:**
- Create: `core/state-source/github-issue-mapper.ts`
- Modify: `core/state-source/github-labels.ts`

- [ ] **Step 1: Confirm baseline**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 2: Create `github-issue-mapper.ts`**

Move the mapping/parsing functions out of `github-labels.ts` (lines ~26–163):

```typescript
// core/state-source/github-issue-mapper.ts
import type { WorkItem, Milestone } from './interface.js';
// ... other imports as needed

// Move verbatim:
// parseIssueNumber (line 26)
// parseRefs (line 90)
// parseDependsOn (line 103)
// parseBlocks (line 107)
// mapIssueToWorkItem (line 111)
// mapGithubMilestone (line 150)
// Re-export SCHEDULE_UI_TO_VALUE, SCHEDULE_UI_TO_LABEL, ScheduleUIValue if defined here

export { parseIssueNumber, parseRefs, parseDependsOn, parseBlocks, mapIssueToWorkItem, mapGithubMilestone };
```

- [ ] **Step 3: Update `github-labels.ts`**

Replace the moved functions with imports:

```typescript
import {
  mapIssueToWorkItem,
  mapGithubMilestone,
  parseIssueNumber,
} from './github-issue-mapper.js';
```

Remove the moved function bodies. `GitHubLabelsSource` class and all constants stay in `github-labels.ts`.

- [ ] **Step 4: Typecheck and test**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add core/state-source/github-labels.ts core/state-source/github-issue-mapper.ts
git commit -m "refactor: extract issue mapping helpers from github-labels.ts"
```

---

## Task 4: Split `core/agent-runtime/codex-cli.ts` → config + parser

**Files:**
- Create: `core/agent-runtime/codex-config.ts`
- Create: `core/agent-runtime/codex-parser.ts`
- Modify: `core/agent-runtime/codex-cli.ts`

- [ ] **Step 1: Confirm baseline**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 2: Create `codex-config.ts`**

Move setup/config functions (roughly lines 19–133):

```typescript
// core/agent-runtime/codex-config.ts
export class CodexBinaryNotFoundError extends Error { /* verbatim */ }
export class CodexNotAuthenticatedError extends Error { /* verbatim */ }
export function resolveCodexBinary(): string { /* verbatim */ }
export function assertCodexAuthenticated(): void { /* verbatim */ }
export function escapeForTomlMultilineBasic(input: string): string { /* verbatim */ }
export function buildCodexArgv(input: { /* ... */ }): string[] { /* verbatim */ }
```

- [ ] **Step 3: Create `codex-parser.ts`**

Move parsing utilities (roughly lines 134–323):

```typescript
// core/agent-runtime/codex-parser.ts
export function pickCodexAgentMessageText(obj: Record<string, unknown>): string | null { /* verbatim */ }
export function parseCodexEnvelope(stdout: string): CodexEnvelope | null { /* verbatim */ }
export function extractResultJson(text: string, runId: string): unknown { /* verbatim */ }
// pickString, pickNumber stay private (not exported, used only here)
```

- [ ] **Step 4: Update `codex-cli.ts`**

`CodexCliRuntime` class stays. Replace moved functions with imports:

```typescript
import {
  CodexBinaryNotFoundError,
  CodexNotAuthenticatedError,
  resolveCodexBinary,
  assertCodexAuthenticated,
  buildCodexArgv,
  escapeForTomlMultilineBasic,
} from './codex-config.js';
import { parseCodexEnvelope, extractResultJson, pickCodexAgentMessageText } from './codex-parser.js';
```

Re-export the error classes from `codex-cli.ts` so callers don't break:

```typescript
export { CodexBinaryNotFoundError, CodexNotAuthenticatedError } from './codex-config.js';
export { resolveCodexBinary, assertCodexAuthenticated } from './codex-config.js';
```

- [ ] **Step 5: Typecheck and test**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add core/agent-runtime/codex-cli.ts core/agent-runtime/codex-config.ts core/agent-runtime/codex-parser.ts
git commit -m "refactor: extract config and parser out of codex-cli.ts"
```

---

## Task 5: Split `core/agent-runtime/swarm.ts` → scout runner + utils

**Files:**
- Create: `core/agent-runtime/scout-runner.ts`
- Create: `core/agent-runtime/swarm-utils.ts`
- Modify: `core/agent-runtime/swarm.ts`

- [ ] **Step 1: Confirm baseline**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 2: Create `swarm-utils.ts`**

Move low-level primitives (lines ~430–519):

```typescript
// core/agent-runtime/swarm-utils.ts
export class ScoutTimeoutError extends Error { /* verbatim */ }
export function runWithDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> { /* verbatim */ }
export async function runWithConcurrencyCap<T, R>(
  items: T[],
  cap: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> { /* verbatim */ }
export function startHeartbeat(opts: StartHeartbeatOptions): HeartbeatHandle { /* verbatim */ }
// Move StartHeartbeatOptions and HeartbeatHandle interfaces too
```

- [ ] **Step 3: Create `scout-runner.ts`**

Move `runOneScout` and its private helpers (lines ~248–428):

```typescript
// core/agent-runtime/scout-runner.ts
import { runWithDeadline, ScoutTimeoutError } from './swarm-utils.js';
// ... other imports as needed

export async function runOneScout(/* params verbatim */): Promise</* return type */> {
  // verbatim body
}
```

- [ ] **Step 4: Update `swarm.ts`**

`dispatchWave` and all exported interfaces/types stay. Replace moved code with imports:

```typescript
import { runWithConcurrencyCap, startHeartbeat } from './swarm-utils.js';
import { runOneScout } from './scout-runner.js';
```

Re-export `ScoutTimeoutError` from `swarm.ts` if any callers import it from there:

```typescript
export { ScoutTimeoutError } from './swarm-utils.js';
```

- [ ] **Step 5: Typecheck and test**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add core/agent-runtime/swarm.ts core/agent-runtime/scout-runner.ts core/agent-runtime/swarm-utils.ts
git commit -m "refactor: extract scout-runner and swarm-utils from swarm.ts"
```

---

## Task 6: Split `slices/investigate/workflow.ts` → wave2 selection

**Files:**
- Create: `slices/investigate/wave2-selection.ts`
- Modify: `slices/investigate/workflow.ts`

- [ ] **Step 1: Confirm baseline**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 2: Create `wave2-selection.ts`**

Move wave-2 constants, selection, and heuristic functions (lines ~36–88, 439–485):

```typescript
// slices/investigate/wave2-selection.ts
import type { ScoutSpec } from '@goose-hub/core/agent-runtime/swarm.js';
// ... other imports as needed

// Move verbatim:
export const WAVE_1_SCOUTS: ScoutSpec[] = [ /* ... */ ];
export const WAVE_2_INTERFACE_SPEC = { /* ... */ };
export const WAVE_2_RISK_SPEC = { /* ... */ };

export function selectWave2Scouts(opts: SelectWave2ScoutsOptions): ScoutSpec[] { /* verbatim */ }
export function collectWave2SignalText(opts: SelectWave2ScoutsOptions): string { /* verbatim */ }
export function implicatesInterfaceBoundaries(text: string): boolean { /* verbatim */ }
export function implicatesRiskAnalysis(text: string): boolean { /* verbatim */ }
// Move SelectWave2ScoutsOptions interface too
```

- [ ] **Step 3: Update `workflow.ts`**

Replace the moved code with an import:

```typescript
import {
  WAVE_1_SCOUTS,
  WAVE_2_INTERFACE_SPEC,
  WAVE_2_RISK_SPEC,
  selectWave2Scouts,
  collectWave2SignalText,
} from './wave2-selection.js';
```

- [ ] **Step 4: Typecheck and test**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add slices/investigate/workflow.ts slices/investigate/wave2-selection.ts
git commit -m "refactor: extract wave2 selection logic from investigate/workflow.ts"
```

---

## Task 7: Split `slices/qa/workflow.ts` → deterministic tiers

**Files:**
- Create: `slices/qa/deterministic-tiers.ts`
- Create: `slices/qa/qa-helpers.ts`
- Modify: `slices/qa/workflow.ts`

- [ ] **Step 1: Confirm baseline**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 2: Create `qa-helpers.ts`**

Move context-gathering helpers (lines ~29–88):

```typescript
// slices/qa/qa-helpers.ts
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';

export function getPrDiff(_workItem: WorkItem, workspaceDir?: string): string { /* verbatim */ }
export function findPrOpenedHints(workItemId: string): PrOpenedHints { /* verbatim */ }
export function findDevTestsRun(workItemId: string): { command: string; paths: string[] } | undefined { /* verbatim */ }
// Move PrOpenedHints type too
```

- [ ] **Step 3: Create `deterministic-tiers.ts`**

Move tier execution and analysis functions (lines ~116–267):

```typescript
// slices/qa/deterministic-tiers.ts
import type { QaOutput } from '@goose-hub/skills/qa/schema.js';

export interface VerifyCommand { /* verbatim from workflow.ts */ }
export async function defaultRunTests(cwd: string, command: string): Promise<TestRun | null> { /* verbatim */ }
export async function runDeterministicTiers(opts: { /* ... */ }): Promise<DeterministicTierResults> { /* verbatim */ }
export function detectTierDisagreement(d: DeterministicTierResults): TierDisagreement | null { /* verbatim */ }
export function toAgentTierResults(d: DeterministicTierResults): QaOutput['tierResults'] | undefined { /* verbatim */ }
// Move TestRun, DeterministicTierResults, TierDisagreement types too
```

- [ ] **Step 4: Update `workflow.ts`**

`runQaWorkflow` stays. Replace with imports:

```typescript
import { getPrDiff, findPrOpenedHints, findDevTestsRun } from './qa-helpers.js';
import { runDeterministicTiers, detectTierDisagreement, toAgentTierResults } from './deterministic-tiers.js';
```

Export `VerifyCommand` from `workflow.ts` if any slice tests import it directly:

```typescript
export type { VerifyCommand } from './deterministic-tiers.js';
```

- [ ] **Step 5: Typecheck and test**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add slices/qa/workflow.ts slices/qa/deterministic-tiers.ts slices/qa/qa-helpers.ts
git commit -m "refactor: extract deterministic tiers and helpers from qa/workflow.ts"
```

---

## Task 8: Split `slices/fix-issue/workflow.ts` → implement phase + PR helpers

**Files:**
- Create: `slices/fix-issue/implement-phase.ts`
- Create: `slices/fix-issue/pr-helpers.ts`
- Modify: `slices/fix-issue/workflow.ts`

- [ ] **Step 1: Confirm baseline**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 2: Create `implement-phase.ts`**

Move the two implementation phase functions (lines ~335–591):

```typescript
// slices/fix-issue/implement-phase.ts
// Move all imports these functions need.

export async function runImplement(input: RunImplementInput): Promise<ImplementOutputShape> { /* verbatim */ }
export async function afterImplement(input: AfterImplementInput): Promise<void> { /* verbatim */ }
// Move RunImplementInput, AfterImplementInput, ImplementOutputShape types too
```

- [ ] **Step 3: Create `pr-helpers.ts`**

Move PR construction, evidence posting, and git utilities (lines ~592–740):

```typescript
// slices/fix-issue/pr-helpers.ts
export async function runEvidencePost(input: RunEvidencePostInput): Promise<void> { /* verbatim */ }
export function buildPrBody(opts: { /* ... */ }): string { /* verbatim */ }
export function resolveWorktreeHeadSha(worktreePath: string): string { /* verbatim */ }
export async function deriveStack(projectId: string): Promise<{ /* ... */ }> { /* verbatim */ }
// Move RunEvidencePostInput type too
```

- [ ] **Step 4: Update `workflow.ts`**

`runFixIssueWorkflow` and `FixIssueDeps` stay. Replace with imports:

```typescript
import { runImplement, afterImplement } from './implement-phase.js';
import { runEvidencePost, buildPrBody, resolveWorktreeHeadSha, deriveStack } from './pr-helpers.js';
```

- [ ] **Step 5: Typecheck and test**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add slices/fix-issue/workflow.ts slices/fix-issue/implement-phase.ts slices/fix-issue/pr-helpers.ts
git commit -m "refactor: extract implement phase and PR helpers from fix-issue/workflow.ts"
```

---

## Task 9: Split `core/workflows/bootstrap-project.ts` → renderers + GitHub helpers

**Files:**
- Create: `core/workflows/bootstrap-renderers.ts`
- Create: `core/workflows/bootstrap-github.ts`
- Modify: `core/workflows/bootstrap-project.ts`

- [ ] **Step 1: Confirm baseline**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 2: Create `bootstrap-renderers.ts`**

Move all `render*` and `summariseStack` functions (approx lines 157–413):

```typescript
// core/workflows/bootstrap-renderers.ts
import type { StackInfo, AuditResult } from './bootstrap-project.js'; // or shared types

export function summariseStack(stack: StackInfo): string { /* verbatim */ }
export function renderProjectConfig(input: { /* ... */ }): string { /* verbatim */ }
export function renderStackBlock(stack: StackInfo, detectedAt: string): string { /* verbatim */ }
export function renderPrBody(input: PrBodyInput): string { /* verbatim */ }
export function renderClaudeBlock(audit: AuditResult): string { /* verbatim */ }
export function renderReposMd(slug: string, repoRef: string, description: string): string { /* verbatim */ }
// Move PrBodyInput type too
```

- [ ] **Step 3: Create `bootstrap-github.ts`**

Move all GitHub API call helpers (approx lines 449–607):

```typescript
// core/workflows/bootstrap-github.ts
// These are all private helpers — export them so bootstrap-project.ts can import them.
export async function ghJson<T>(args: string[], opts?: { /* ... */ }): Promise<T> { /* verbatim */ }
export async function getDefaultBranchSha(/* ... */): Promise<string> { /* verbatim */ }
export async function createBranch(input: CreateBranchInput): Promise<void> { /* verbatim */ }
export async function getRepoInfo(/* ... */): Promise<{ /* ... */ }> { /* verbatim */ }
export async function putFileOnBranch(input: { /* ... */ }): Promise<void> { /* verbatim */ }
export async function openPullRequest(input: { /* ... */ }): Promise<{ number: number }> { /* verbatim */ }
export async function applyLabels(input: { /* ... */ }): Promise<void> { /* verbatim */ }
export async function findExistingRegistrationPrs(/* ... */): Promise<{ /* ... */ }[]> { /* verbatim */ }
```

- [ ] **Step 4: Update `bootstrap-project.ts`**

`bootstrapProject`, `sanitiseSlug`, `parseRepoRef`, error classes, and interfaces stay. Replace with imports:

```typescript
import { summariseStack, renderProjectConfig, renderStackBlock, renderPrBody, renderClaudeBlock, renderReposMd } from './bootstrap-renderers.js';
import { ghJson, getDefaultBranchSha, createBranch, getRepoInfo, putFileOnBranch, openPullRequest, applyLabels, findExistingRegistrationPrs } from './bootstrap-github.js';
```

- [ ] **Step 5: Typecheck and test**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add core/workflows/bootstrap-project.ts core/workflows/bootstrap-renderers.ts core/workflows/bootstrap-github.ts
git commit -m "refactor: extract renderers and GitHub helpers from bootstrap-project.ts"
```

---

## Task 10: Split `slices/parallel-implement/workflow.ts` → wp-builder + helpers

**Files:**
- Create: `slices/parallel-implement/wp-builder.ts`
- Create: `slices/parallel-implement/parallel-helpers.ts`
- Modify: `slices/parallel-implement/workflow.ts`

- [ ] **Step 1: Confirm baseline**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 2: Create `parallel-helpers.ts`**

Move state tracking and concurrency utilities (lines ~88–202):

```typescript
// slices/parallel-implement/parallel-helpers.ts
export function recordWpIteration(/* ... */): void { /* verbatim */ }
export function getLastWpStatus(runId: string, wpId: string): 'ok' | 'failed' | 'in-progress' | null { /* verbatim */ }
export async function runWithConcurrencyCap<T, R>(/* ... */): Promise<R[]> { /* verbatim */ }
export function buildParallelPrBody(opts: { /* ... */ }): string { /* verbatim */ }
```

- [ ] **Step 3: Create `wp-builder.ts`**

Move single work-package execution (lines ~203–343):

```typescript
// slices/parallel-implement/wp-builder.ts
import { recordWpIteration, getLastWpStatus } from './parallel-helpers.js';

export async function runOneWpBuilder(opts: RunOneWpBuilderOptions): Promise<WpBuildPhaseResult> { /* verbatim */ }
// Move RunOneWpBuilderOptions, WpBuildPhaseResult types too
```

- [ ] **Step 4: Update `workflow.ts`**

`runParallelImplementWorkflow` and exported interfaces stay. Replace with imports:

```typescript
import { runWithConcurrencyCap, buildParallelPrBody, recordWpIteration, getLastWpStatus } from './parallel-helpers.js';
import { runOneWpBuilder } from './wp-builder.js';
```

- [ ] **Step 5: Typecheck and test**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add slices/parallel-implement/workflow.ts slices/parallel-implement/wp-builder.ts slices/parallel-implement/parallel-helpers.ts
git commit -m "refactor: extract wp-builder and helpers from parallel-implement/workflow.ts"
```

---

## Task 11: Split `slices/review/workflow.ts` → convergent review + helpers + audit

This is the largest file. Split into four focused modules.

**Files:**
- Create: `slices/review/convergent-review.ts`
- Create: `slices/review/review-spec.ts`
- Create: `slices/review/review-audit.ts`
- Modify: `slices/review/workflow.ts`

- [ ] **Step 1: Confirm baseline**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 2: Create `review-spec.ts`**

Move finding deduplication + spec builder (lines ~234–365):

```typescript
// slices/review/review-spec.ts
import type { ReviewerSlot } from '@goose-hub/core/db/repositories/project-review-settings.js';
import type { ReviewOutput } from '@goose-hub/skills/review/schema.js';

export const DEFAULT_MAX_REVIEW_ROUNDS = 3;
export interface FindingKey { /* verbatim */ }
export interface ReviewWaveResult { /* verbatim */ }
export interface DispatchReviewWaveOpts { /* verbatim */ }

export function toFindingKey(f: { /* ... */ }): FindingKey { /* verbatim */ }
export function findingKeyStr(k: FindingKey): string { /* verbatim */ }
export function deduplicateFindings(/* ... */): /* ... */ { /* verbatim */ }
export function extractChangedFilePaths(prDiff: string): string[] { /* verbatim */ }
export const DEFAULT_REVIEWER_SLOTS: ReviewerSlot[] = [ /* verbatim */ ];
export function buildReviewSpec(params: { /* ... */ }): /* ... */ { /* verbatim */ }
```

- [ ] **Step 3: Create `review-audit.ts`**

Move audit functions (lines ~937–1040):

```typescript
// slices/review/review-audit.ts
export function findDevRunId(events: { kind: string; payload: unknown }[]): string | undefined { /* verbatim */ }
export function externalIdAsNumber(externalId: string): number | undefined { /* verbatim */ }
export function startConvergentReviewAudit(input: { /* ... */ }): /* ... */ { /* verbatim */ }
export async function finalizeConvergentReviewAudit(/* ... */): Promise<void> { /* verbatim */ }
```

- [ ] **Step 4: Create `convergent-review.ts`**

Move `dispatchReviewWave` and `runConvergentReviewWorkflow` (lines ~367–935):

```typescript
// slices/review/convergent-review.ts
import {
  DEFAULT_MAX_REVIEW_ROUNDS,
  DEFAULT_REVIEWER_SLOTS,
  buildReviewSpec,
  deduplicateFindings,
  extractChangedFilePaths,
  toFindingKey,
  findingKeyStr,
  type DispatchReviewWaveOpts,
  type ReviewWaveResult,
} from './review-spec.js';
import { findDevRunId, externalIdAsNumber, startConvergentReviewAudit, finalizeConvergentReviewAudit } from './review-audit.js';
// ... rest of imports from original

function buildReviewComment(/* ... */): /* ... */ { /* verbatim — line 887 */ }

export async function dispatchReviewWave(opts: DispatchReviewWaveOpts): Promise<ReviewWaveResult> { /* verbatim */ }
export async function runConvergentReviewWorkflow(/* ... */): Promise</* ... */> { /* verbatim */ }
```

- [ ] **Step 5: Update `workflow.ts`**

`runReviewWorkflow`, `ReviewWorkflowDeps`, and private helpers `getPrDiff`/`getQaVerdict` (lines 84–213) stay. Replace moved code with imports:

```typescript
import {
  dispatchReviewWave,
  runConvergentReviewWorkflow,
} from './convergent-review.js';
export type { FindingKey, ReviewWaveResult, DispatchReviewWaveOpts } from './review-spec.js';
```

- [ ] **Step 6: Typecheck and test**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add slices/review/workflow.ts slices/review/convergent-review.ts slices/review/review-spec.ts slices/review/review-audit.ts
git commit -m "refactor: split review/workflow.ts into convergent-review, review-spec, review-audit"
```

---

## Self-Review

**Spec coverage check:**
- api.ts (621 LOC) → Task 1 ✓
- cli/index.ts (634 LOC) → Task 2 ✓
- github-labels.ts (562 LOC) → Task 3 ✓
- codex-cli.ts (571 LOC) → Task 4 ✓
- swarm.ts (519 LOC) → Task 5 ✓
- investigate/workflow.ts (485 LOC) → Task 6 ✓
- qa/workflow.ts (642 LOC) → Task 7 ✓
- fix-issue/workflow.ts (749 LOC) → Task 8 ✓
- bootstrap-project.ts (741 LOC) → Task 9 ✓
- parallel-implement/workflow.ts (713 LOC) → Task 10 ✓
- review/workflow.ts (1040 LOC) → Task 11 ✓
- dispatch.ts → excluded (separate agent) ✓
- mock-outputs.ts → excluded (fixture data, acceptable) ✓
- model-router.ts → excluded (449 LOC, below threshold for split) ✓

**All tasks are independent** — each can be executed by a separate subagent on a fresh worktree branch. Merge order does not matter as long as conflicts are resolved at merge time (no two tasks touch the same file).
