# State Flow Integration & E2E Tests

**Date:** 2026-05-03  
**Status:** Approved for implementation

---

## Problem

Unit tests pass but the pipeline breaks end-to-end. The `context-assembly` bug (dotted-path allowlist stripping the work item from every implement invocation) is proof: all unit tests were green, real run was broken. We need tests that prove the dispatch chain, state transitions, and UI pipeline work as a whole.

---

## Scope

Two layers:

1. **Integration tests (C = A + B)** — Node/Vitest, no browser, agents mocked at the runtime level
2. **Playwright e2e test** — real browser, server running in mock-agent mode, full UI pipeline visible

---

## Layer A + B: Integration Tests

### What they cover

**Layer A — Workflow state paths** (each workflow in isolation, agents mocked):

| Scenario | Start state | End state |
|---|---|---|
| Triage: feature/chore | factory:triaging | factory:dev-ready |
| Triage: bug | factory:triaging | factory:investigating |
| Triage: research | factory:triaging | factory:research-pending |
| Fix-issue: happy path (medium priority) | factory:dev-ready | factory:approved |
| Fix-issue: failure (implement invalid output) | factory:dev-ready | factory:needs-human |
| Fix-issue: advisor proceed (high priority) | factory:dev-ready | factory:approved |
| Fix-issue: advisor revise (high priority) | factory:dev-ready | factory:approved |
| Fix-issue: advisor abort (high priority) | factory:dev-ready | factory:needs-human |
| Investigate: happy path | factory:investigating | factory:investigation-complete |
| Investigate: failure | factory:investigating | factory:needs-human |

**Layer B — Full dispatch chain** (webhook HTTP → dispatch → workflow → state):

| Scenario | Webhook label | Final state verified |
|---|---|---|
| Triaging dispatch | factory:triaging | transitionState chain matches triage |
| Dev-ready dispatch | factory:dev-ready | transitionState chain matches fix-issue |
| Investigating dispatch | factory:investigating | transitionState chain matches investigate |
| Full chore pipeline | factory:triaging → factory:dev-ready (chained) | factory:approved |

### File location

`apps/server/src/domains/workflows/state-flows.test.ts`

This is a single file covering both layers. Layer B uses Hono's `app.request()` pattern (same as `handler.test.ts`).

### Mock strategy

All agents mocked via injectable deps or `vi.mock`. No real GitHub API calls. No file system writes. No git worktree creation.

```
ClaudeCliRuntime.run() → vi.mock → returns preset TriageOutput / RepoMatchOutput / ImplementOutput / InvestigateOutput
StateSource → vi.fn() object with all methods (transitionState, setLabelInGroup, comment, getItem, listOpenWork)
openPR → vi.fn() → returns { prNumber: 99, prUrl: 'https://github.com/test/pull/99', branch: 'factory/run-id' }
createWorktree → vi.fn() → returns '/mock/worktree'
cleanupWorktree → vi.fn()
```

### What each test asserts

For state-path tests, assert in order:
1. `transitionState` called with the exact `(externalId, from, to)` sequence — use `toHaveBeenNthCalledWith`
2. `setLabelInGroup` called with correct type and priority
3. `comment` called on failure paths
4. `eventStore.appendEvent` called with expected `kind` values in order
5. No extra `transitionState` calls (verify call count)

For dispatch chain tests (Layer B):
1. POST `/webhook` with valid HMAC signature and `issues.labeled` payload
2. Wait for dispatch to settle (the dispatch functions are fire-and-forget; use `await vi.waitFor(...)`)
3. Assert the same `transitionState` sequence as Layer A

### Helper factories (shared in the file)

```typescript
makeWorkItem(overrides?: Partial<WorkItem>): WorkItem
makeMockSource(): StateSource (all methods as vi.fn())
makeTriageOutput(type: 'feature'|'bug'|'research'): TriageOutput
makeRepoMatchOutput(): RepoMatchOutput
makeImplementOutput(): ImplementOutput
makeInvestigateOutput(): InvestigateOutput
signWebhookPayload(body: string, secret: string): string
```

---

## Layer: Playwright E2E Test

### Goal

Watch the full pipeline run in a real browser. From creating a chore in the inbox, through triage and implement, all the way to `factory:approved` (or mocked QA/review gates) — with agent events visible in the Timeline.

### Mock agent mode

Add `MOCK_AGENTS=true` env var support to `ClaudeCliRuntime`:

```typescript
// core/agent-runtime/claude-cli.ts — in run():
if (process.env.MOCK_AGENTS === 'true') {
  return resolveMockOutput(spec);
}
```

`resolveMockOutput(spec: AgentSpec): AgentResult` lives in `core/agent-runtime/mock-outputs.ts`. It returns preset valid outputs for each skill:

| Skill | Preset output |
|---|---|
| `triage` | `{ type: 'chore', priority: 'p3', reasoning: 'e2e fixture', decisionSummaries: [{step:'classify', summary:'Classified as chore for e2e'}] }` |
| `repo-match` | `{ candidates: [{repo: 'shaunnez/goose-hub', confidence: 95, evidence: 'name match', tier: 1}], decisionSummaries: [] }` |
| `implement` | `{ plan: 'E2E mock plan', filesWritten: [{path: 'e2e-mock.ts', reason: 'e2e fixture'}], testsWritten: [], prUrl: 'https://github.com/shaunnez/goose-hub/pull/999', evidenceSpecPath: null, confidence: 'high', decisionSummaries: [{step:'implement', summary:'Mock implementation for e2e test'}] }` |
| `investigate` | `{ findings: 'E2E mock findings', keyFiles: [], confidence: 'high', openQuestions: [], decisionSummaries: [{step:'investigate', summary:'Mock investigation for e2e test'}] }` |
| `qa` | `{ verdict: 'pass', tier: 'functional', criteriaResults: [], decisionSummaries: [{step:'qa', summary:'Mock QA pass for e2e test'}] }` |
| `review` | `{ verdict: 'approved', feedback: null, decisionSummaries: [{step:'review', summary:'Mock review approval for e2e test'}] }` |

The mock also emits the same `agent.run-started` / `agent.run-completed` events as the real runtime so the timeline UI populates correctly.

Mock `openPR` is handled separately: add `MOCK_AGENTS=true` guard in the dispatch layer to skip real git push and return a canned PR result. Or inject via a separate env `MOCK_OPEN_PR=true`. Either is fine.

### Playwright config change

Add a second playwright config `apps/web/playwright-e2e-pipeline.config.ts` that:
- Inherits from `playwright.config.ts` 
- Adds `MOCK_AGENTS: 'true'` and `MOCK_OPEN_PR: 'true'` to the server's webServer env
- Points `testDir` to `./e2e/pipeline/`

This keeps mock mode isolated from the existing happy-path tests.

### Test file

`apps/web/e2e/pipeline/state-flow.spec.ts`

Two test scenarios in one `describe`:

**Scenario 1: Chore pipeline (triaging → approved)**

```
beforeAll:
  1. Find/create "E2E Pipeline" GitHub milestone (same pattern as happy-path.spec.ts)
  2. Set active milestone via POST /projects/{slug}/active-milestone

test body:
  1. Navigate to /projects/goose-hub-self/inbox
  2. Click Capture button, fill title "[E2E Pipeline] Chore {timestamp}"
  3. Submit capture modal
  4. Inbox shows new item
  5. Click Promote on the item
  6. Select project = goose-hub-self
  7. Click Next → confirm Promote
  8. Navigate to /projects/goose-hub-self
  9. Select "E2E Pipeline" milestone in milestone-selector
  10. Issue card appears in triaging column (state = factory:triaging)
  11. Click issue card → detail page
  12. Navigate to Timeline tab
  13. POST /projects/goose-hub-self/tick (trigger triage batch via server API)
  14. Wait for timeline to show agent.run-started event
  15. Wait for timeline to show agent.triage-complete event  
  16. Wait for label to change to factory:dev-ready (poll issue card or state badge)
  17. Wait for timeline to show fix-issue agent.run-started event (triggered by dev-ready webhook)
  18. Wait for timeline to show agent.implement-complete event
  19. Wait for timeline to show pr.opened event
  20. Wait for state to reach factory:approved (M7 path skips QA/review)
  21. Verify PR link visible in right rail or timeline

afterAll:
  - Close created GitHub issue
  - Close milestone (if we created it)
```

**Scenario 2: Bug pipeline (triaging → investigating)**

```
beforeAll: reuse same milestone

test body:
  1. Create GitHub issue directly via API with labels: factory:triaging, type:bug, schedule:current, etc.
  2. Navigate to dashboard, select milestone
  3. Issue appears in triaging column
  4. POST /projects/{slug}/tick to run triage
  5. Triage mock returns type=bug → state moves to factory:investigating
  6. Wait for Timeline to show agent.triage-complete
  7. Wait for state badge to show factory:investigating
  8. Wait for investigate agent run to start (triggered by investigating webhook)
  9. Wait for agent.investigation-complete event in timeline
  10. State reaches factory:investigation-complete
  
  (factory:investigation-complete → factory:dev-ready is currently a manual step;
   the test verifies the pipeline gets to investigation-complete correctly)
```

### Timing / polling strategy

All "wait for" steps use `expect.poll()` or `page.waitForSelector()` with 30s timeouts. The mock agents complete in milliseconds so transitions should fire within 2–3 seconds.

For state changes that happen server-side (label transitions), the UI updates via the SSE event stream. Use:
```typescript
await expect(page.getByTestId('state-badge')).toHaveText('factory:dev-ready', { timeout: 30_000 });
```

### Gate mocking (M8 QA/review)

For the chore pipeline scenario, once M8 is merged, the path will be:
`factory:in-progress → factory:needs-qa → factory:needs-review → factory:approved`

The mock QA and review skills return `verdict: 'pass'` and `verdict: 'approved'` respectively, so the pipeline completes automatically without human gates. The Playwright test just waits for `factory:approved` with a longer timeout.

---

## File inventory

| File | Purpose |
|---|---|
| `apps/server/src/domains/workflows/state-flows.test.ts` | Integration tests (Layer A + B) |
| `core/agent-runtime/mock-outputs.ts` | Preset skill outputs for MOCK_AGENTS mode |
| `core/agent-runtime/claude-cli.ts` | Add MOCK_AGENTS short-circuit |
| `apps/web/playwright-e2e-pipeline.config.ts` | Playwright config with MOCK_AGENTS=true |
| `apps/web/e2e/pipeline/state-flow.spec.ts` | Playwright e2e pipeline test |

---

## Acceptance criteria

- [ ] `state-flows.test.ts` covers all 10 state-path scenarios (Layer A) and 4 dispatch-chain scenarios (Layer B)
- [ ] Each test asserts `transitionState` calls in exact order with `toHaveBeenNthCalledWith`
- [ ] `MOCK_AGENTS=true` makes `ClaudeCliRuntime.run()` return preset outputs without spawning the CLI
- [ ] Playwright scenario 1 completes from inbox capture → `factory:approved` with all agent events visible in the timeline
- [ ] Playwright scenario 2 completes from `factory:triaging` → `factory:investigation-complete`
- [ ] No real GitHub API calls in integration tests; real API calls only in Playwright setup/teardown (same pattern as `happy-path.spec.ts`)
- [ ] `pnpm test` still passes (integration tests are co-located with existing workflow tests)
- [ ] `pnpm playwright test --config apps/web/playwright-e2e-pipeline.config.ts` runs both Playwright scenarios
