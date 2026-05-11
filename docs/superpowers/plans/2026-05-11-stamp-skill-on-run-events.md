# Stamp Skill on All Run Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stamp `skill` into the payload of every event emitted for a run so `extractRunMeta` can resolve the run label from whichever event arrives first, eliminating "(Unknown) Run" during loading.

**Architecture:** Currently `extractRunMeta` in the frontend only reads `skill` from five lifecycle event kinds (`agent.run-started`, `agent.spawned`, `agent.model-selected`, `agent.run-completed`, `agent.run-failed`). All other events — `tool.stdout-truncated`, `tool.timeout`, and hook-posted events (`agent.tool-call`, `agent.tool-result`, `agent.decision-summary-live`, `agent.verify-command`) — carry no `skill`. When one of these arrives before a lifecycle event the run group label is "(Unknown)". The fix stamps `skill` into every server-side payload and widens `extractRunMeta` to read it from any event.

**Tech Stack:** TypeScript, Vitest (unit tests), Node.js event stream, React (frontend)

---

## File Map

| File | Change |
|------|--------|
| `core/agent-runtime/claude-cli.ts` | Add `skill: spec.skill` to `tool.stdout-truncated` and `tool.timeout` payloads |
| `core/agent-runtime/codex-cli.ts` | Same as above, plus the two early `agent.run-failed` payloads that currently omit `skill` |
| `apps/server/src/domains/events/service.ts` | Extract `skill` from the already-resolved `run-started` event and include it in `agent.tool-call`, `agent.tool-result`, `agent.decision-summary-live`, `agent.verify-command` payloads |
| `apps/web/src/components/detail/lib/timeline.ts` | Widen `extractRunMeta` to read `payload.skill` from **any** event, not just the five lifecycle kinds |
| `apps/web/src/components/detail/components/TimelineSection.test.ts` | Add tests: run group resolves skill from non-lifecycle events |
| `apps/server/src/domains/events/service.test.ts` | Assert `skill` field appears in tool-call / tool-result / decision-summary-live / verify-command events when run-started carries one |

---

## Task 1: Widen `extractRunMeta` on the frontend

**Files:**
- Modify: `apps/web/src/components/detail/lib/timeline.ts:165-225`
- Test: `apps/web/src/components/detail/components/TimelineSection.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `describe('groupEvents — run-group metadata')` block in `TimelineSection.test.ts`:

```typescript
it('resolves skill from any event payload, not just lifecycle events', () => {
  const events: AgentEventDto[] = [
    // tool-call arrives first, carries skill; run-started has no skill
    { ...makeRunEvent(1, 'run-abc', 'agent.tool-call'), payload: { skill: 'implement' } },
    makeRunEvent(2, 'run-abc', 'agent.run-started'),
    makeRunEvent(3, 'run-abc', 'agent.run-completed'),
  ];
  const result = groupEvents(events);
  expect(result).toHaveLength(1);
  if (result[0].kind === 'run-group') {
    expect(result[0].skill).toBe('implement');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/shaunnesbitt/projects/goose-hub
pnpm --filter @goose-hub/web test TimelineSection --run
```

Expected: FAIL — `expected null to be 'implement'`

- [ ] **Step 3: Widen `extractRunMeta`**

In `apps/web/src/components/detail/lib/timeline.ts`, change the loop body inside `extractRunMeta`. Currently `skill` is only set inside `if (ev.kind === 'agent.run-started') { ... }` etc. Replace with a generic fallback that reads `payload.skill` from ANY event:

```typescript
// Before the per-kind checks, pick up skill from any event that carries it.
// This covers hook-posted events (tool-call, tool-result, decision-summary-live,
// verify-command) that arrive before agent.run-started.
if (skill == null && p?.skill != null) skill = p.skill as string;

if (ev.kind === 'agent.run-started') {
  if (startedAt == null) startedAt = ev.createdAt;
} else if (ev.kind === 'agent.run-completed') {
  if (endedAt == null) endedAt = ev.createdAt;
} else if (ev.kind === 'agent.run-failed') {
  if (endedAt == null) endedAt = ev.createdAt;
} else if (ev.kind === 'retrospective.completed') {
  if (endedAt == null) endedAt = ev.createdAt;
} else if (ev.kind === 'prd.approved' || ev.kind === 'prd.rejected') {
  if (endedAt == null) endedAt = ev.createdAt;
} else if (ev.kind === 'grill.question-posted' || ev.kind === 'grill.completed') {
  if (endedAt == null) endedAt = ev.createdAt;
} else if (ev.kind === 'decompose.completed') {
  if (endedAt == null) endedAt = ev.createdAt;
}
```

The full replacement for `extractRunMeta`'s inner loop (lines 181–221 in the current file):

```typescript
for (const item of items) {
  if (item.kind !== 'event') continue;
  const ev = item.event;
  const p = ev.payload as { skill?: string } | null;

  const ms = new Date(ev.createdAt).getTime();
  if (ms < earliestMs) {
    earliestMs = ms;
    earliestIso = ev.createdAt;
  }
  if (ms > latestMs) {
    latestMs = ms;
    latestIso = ev.createdAt;
  }

  if (personaId == null && ev.personaId != null) personaId = ev.personaId;

  // Pick up skill from any event that carries it in payload.
  if (skill == null && p?.skill != null) skill = p.skill as string;

  if (ev.kind === 'agent.run-started') {
    if (startedAt == null) startedAt = ev.createdAt;
  } else if (ev.kind === 'agent.run-completed') {
    if (endedAt == null) endedAt = ev.createdAt;
  } else if (ev.kind === 'agent.run-failed') {
    if (endedAt == null) endedAt = ev.createdAt;
  } else if (ev.kind === 'retrospective.completed') {
    if (endedAt == null) endedAt = ev.createdAt;
  } else if (ev.kind === 'prd.approved' || ev.kind === 'prd.rejected') {
    if (endedAt == null) endedAt = ev.createdAt;
  } else if (ev.kind === 'grill.question-posted' || ev.kind === 'grill.completed') {
    if (endedAt == null) endedAt = ev.createdAt;
  } else if (ev.kind === 'decompose.completed') {
    if (endedAt == null) endedAt = ev.createdAt;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @goose-hub/web test TimelineSection --run
```

Expected: all tests PASS

- [ ] **Step 5: Run full web test suite**

```bash
pnpm --filter @goose-hub/web test --run
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/detail/lib/timeline.ts \
        apps/web/src/components/detail/components/TimelineSection.test.ts
git commit -m "feat(timeline): resolve skill from any event payload in extractRunMeta"
```

---

## Task 2: Stamp `skill` on `claude-cli.ts` mid-run events

**Files:**
- Modify: `core/agent-runtime/claude-cli.ts`

- [ ] **Step 1: Add `skill` to `tool.stdout-truncated` payload**

Find the `tool.stdout-truncated` appendEvent call (~line 256) and change its payload:

```typescript
// Before
payload: { runId },

// After
payload: { runId, skill: spec.skill },
```

- [ ] **Step 2: Add `skill` to `tool.timeout` payload**

Find the `tool.timeout` appendEvent call (~line 273) and change its payload:

```typescript
// Before
payload: { runId },

// After
payload: { runId, skill: spec.skill },
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @goose-hub/server typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add core/agent-runtime/claude-cli.ts
git commit -m "feat(claude-cli): stamp skill on stdout-truncated and timeout events"
```

---

## Task 3: Stamp `skill` on `codex-cli.ts` mid-run events

**Files:**
- Modify: `core/agent-runtime/codex-cli.ts`

- [ ] **Step 1: Add `skill` to `tool.stdout-truncated` payload**

Find the `tool.stdout-truncated` appendEvent call in `codex-cli.ts` (~line 367) and change:

```typescript
// Before
payload: { runId },

// After
payload: { runId, skill: spec.skill },
```

- [ ] **Step 2: Add `skill` to `tool.timeout` payload**

Find the `tool.timeout` appendEvent call (~line 384) and change:

```typescript
// Before
payload: { runId },

// After
payload: { runId, skill: spec.skill },
```

- [ ] **Step 3: Add `skill` to the early `agent.run-failed` payloads**

There are two `agent.run-failed` appendEvent calls in the `child.on('close')` handler that currently have `{ runId, exitCode: code }` without `skill` (lines ~401 and ~416). Update both:

```typescript
// Before (both occurrences)
payload: { runId, exitCode: code },

// After (both occurrences)
payload: { runId, skill: spec.skill, exitCode: code },
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @goose-hub/server typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add core/agent-runtime/codex-cli.ts
git commit -m "feat(codex-cli): stamp skill on mid-run and early-failure events"
```

---

## Task 4: Stamp `skill` on hook-posted events in `service.ts`

**Files:**
- Modify: `apps/server/src/domains/events/service.ts`
- Test: `apps/server/src/domains/events/service.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `service.test.ts` inside the `recordToolCall` describe block and equivalent blocks for the other functions:

```typescript
it('includes skill in payload when run-started carries one', () => {
  const runId = 'run-skill-test';
  // seed a run-started event with skill
  eventStore.appendEvent({
    projectId: 'proj',
    workItemId: 'wi-1',
    kind: 'agent.run-started',
    payload: { skill: 'implement', runId },
    runId,
  });

  const calls: AppendEventInput[] = [];
  vi.spyOn(eventStore, 'appendEvent').mockImplementation((input) => {
    calls.push(input);
    return { id: 99, projectId: 'proj', workItemId: 'wi-1', kind: input.kind, payload: input.payload, createdAt: new Date().toISOString() };
  });

  recordToolCall({ tool_name: 'Bash', run_id: runId });
  const arg = calls[0];
  expect((arg.payload as Record<string, unknown>).skill).toBe('implement');
});
```

Add equivalent tests for `recordToolResult`, `recordDecisionSummary`, and `recordVerifyCommand`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @goose-hub/server test service --run
```

Expected: FAIL — `expected undefined to be 'implement'`

- [ ] **Step 3: Extract and forward `skill` in each `record*` function**

In `apps/server/src/domains/events/service.ts`, update each of the four `record*` functions. The pattern is identical — extract `skill` from the `run-started` event and merge it into the payload. Example for `recordToolCall`:

```typescript
export function recordToolCall(payload: ToolCallHookPayload): RecordToolCallResult {
  const runId = typeof payload.run_id === 'string' ? payload.run_id : null;
  let projectId = 'unknown';
  let workItemId: string | null = null;
  let skill: string | null = null;
  if (runId != null) {
    const startEvent = eventStore.replay({ runId }).find((e) => e.kind === 'agent.run-started');
    if (startEvent != null) {
      projectId = startEvent.projectId;
      workItemId = startEvent.workItemId;
      const p = startEvent.payload as { skill?: string } | null;
      if (p?.skill != null) skill = p.skill;
    }
  }
  eventStore.appendEvent({
    projectId,
    workItemId,
    kind: 'agent.tool-call',
    payload: skill != null ? { ...payload, skill } : payload,
    runId,
  });
  return { ok: true };
}
```

Apply the same `skill` extraction pattern to `recordToolResult`, `recordDecisionSummary`, and `recordVerifyCommand`. Each has the same `startEvent` lookup already — just add the `skill` extraction and payload merge.

For `recordDecisionSummary`, the payload is `normalisedPayload` — merge skill into it:

```typescript
eventStore.appendEvent({
  projectId,
  workItemId,
  kind: 'agent.decision-summary-live',
  payload: skill != null ? { ...normalisedPayload, skill } : normalisedPayload,
  runId,
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @goose-hub/server test service --run
```

Expected: all tests PASS

- [ ] **Step 5: Run full server test suite**

```bash
pnpm --filter @goose-hub/server test --run
```

Expected: all tests PASS

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @goose-hub/server typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/domains/events/service.ts \
        apps/server/src/domains/events/service.test.ts
git commit -m "feat(events/service): stamp skill on hook-posted events from run-started context"
```

---

## Self-Review

**Spec coverage:**
- `claude-cli.ts` mid-run events → Task 2 ✓
- `codex-cli.ts` mid-run events + early failures → Task 3 ✓
- Hook-posted events via HTTP → Task 4 ✓
- Frontend `extractRunMeta` widened → Task 1 ✓

**Placeholder scan:** No TBDs. All code is shown in full.

**Type consistency:**
- `payload.skill` is `string | null` throughout; the `p?.skill` optional-chain pattern is consistent with existing usage in `extractRunMeta`.
- `skill != null ? { ...payload, skill } : payload` pattern is safe — never widens the type, only adds a field.

**Edge cases covered:**
- Run with no `run-started` in DB (e.g., cross-project orphan) → skill stays null, label stays `(Unknown)` — correct behaviour, no regression.
- Hook posts arrive before `run-started` is in DB (race) → `startEvent` is null → skill not forwarded → still resolves to null. This race window is narrow (milliseconds) and the fix closes it for the 99% case where `run-started` is already persisted.
