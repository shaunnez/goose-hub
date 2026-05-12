# Investigation Phase-Group Per Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `groupByPhase` so each investigation run gets its own collapsible "Investigation" phase-group instead of all investigation runs being merged into one.

**Architecture:** Scout `runId`s are structured as `${parentRunId}:scout:${scoutName}:${idx}` (swarm.ts:227). This prefix relationship is the canonical link between a scout run-group and its parent investigation run-group. `groupByPhase` currently ignores this and buckets every investigation-related run-group into one phase. The fix splits the grouping: find anchor investigation run-groups (skill `investigate*` but not `scout-*` or `wave2-*`), attach child scouts by runId prefix, produce one `phase-group` per anchor. Orphaned scouts (anchor not yet emitted — live run case) fall into a best-effort group.

**Tech Stack:** TypeScript, Vitest

---

## File Map

| File | Change |
|------|--------|
| `apps/web/src/components/detail/lib/timeline.ts` | Modify `groupByPhase` and add `isAnchorInvestigationRunGroup` helper |
| `apps/web/src/components/detail/lib/timeline.test.ts` | Add multi-run test case |

---

### Task 1: Add failing test for multi-run scenario

**Files:**
- Modify: `apps/web/src/components/detail/lib/timeline.test.ts`

- [ ] **Step 1: Add the failing test**

Append this new `it` block inside the existing `describe('groupEvents — phase grouping', ...)` block in `timeline.test.ts`:

```typescript
it('creates separate phase-groups for two independent investigation runs', () => {
  // Run A: parentRunId = 'run-A'
  // Run B: parentRunId = 'run-B'
  const events: AgentEventDto[] = [
    // Run A — investigate anchor
    makeEvent(1, 'agent.run-started', 'run-A', {
      payload: { skill: 'investigate' },
    }),
    makeEvent(2, 'agent.investigation-complete', 'run-A'),
    makeEvent(3, 'agent.run-completed', 'run-A'),
    // Run A — scout (runId follows ${parentRunId}:scout:${name}:${idx} pattern)
    makeEvent(4, 'agent.run-started', 'run-A:scout:code-path:0', {
      payload: { skill: 'scout-code-path' },
    }),
    makeEvent(5, 'swarm.scout-completed', 'run-A:scout:code-path:0', {
      payload: { scoutName: 'scout-code-path', findingsCount: 3 },
    }),
    makeEvent(6, 'agent.run-completed', 'run-A:scout:code-path:0'),
    // Unrelated state event between runs
    makeEvent(7, 'state.transitioned', null),
    // Run B — investigate anchor
    makeEvent(8, 'agent.run-started', 'run-B', {
      payload: { skill: 'investigate' },
    }),
    makeEvent(9, 'agent.investigation-complete', 'run-B'),
    makeEvent(10, 'agent.run-completed', 'run-B'),
    // Run B — scout
    makeEvent(11, 'agent.run-started', 'run-B:scout:pattern:1', {
      payload: { skill: 'scout-pattern' },
    }),
    makeEvent(12, 'swarm.scout-completed', 'run-B:scout:pattern:1', {
      payload: { scoutName: 'scout-pattern', findingsCount: 1 },
    }),
    makeEvent(13, 'agent.run-completed', 'run-B:scout:pattern:1'),
  ];

  const items = groupEvents(events);
  const phaseGroups = items.filter((i) => i.kind === 'phase-group');

  // Two separate phase-groups, one per investigation run
  expect(phaseGroups).toHaveLength(2);

  type PhaseGroup = Extract<(typeof items)[number], { kind: 'phase-group' }>;

  const groupA = phaseGroups.find(
    (g) => (g as PhaseGroup).items.some((c) => c.kind === 'run-group' && c.runId === 'run-A'),
  ) as PhaseGroup | undefined;
  const groupB = phaseGroups.find(
    (g) => (g as PhaseGroup).items.some((c) => c.kind === 'run-group' && c.runId === 'run-B'),
  ) as PhaseGroup | undefined;

  expect(groupA).toBeDefined();
  expect(groupB).toBeDefined();

  // Run A's scout is only in group A
  expect(
    groupA!.items.some((c) => c.kind === 'run-group' && c.runId === 'run-A:scout:code-path:0'),
  ).toBe(true);
  expect(
    groupB!.items.some((c) => c.kind === 'run-group' && c.runId === 'run-A:scout:code-path:0'),
  ).toBe(false);

  // Run B's scout is only in group B
  expect(
    groupB!.items.some((c) => c.kind === 'run-group' && c.runId === 'run-B:scout:pattern:1'),
  ).toBe(true);
  expect(
    groupA!.items.some((c) => c.kind === 'run-group' && c.runId === 'run-B:scout:pattern:1'),
  ).toBe(false);

  // state.transitioned is outside both phase-groups
  const stateItem = items.find(
    (i) => i.kind === 'event' && i.event.kind === 'state.transitioned',
  );
  expect(stateItem).toBeDefined();
});
```

- [ ] **Step 2: Run the new test to confirm it fails**

```bash
cd /Users/shaunnesbitt/projects/goose-hub
pnpm --filter web vitest run apps/web/src/components/detail/lib/timeline.test.ts 2>&1 | tail -30
```

Expected: FAIL — `expected 1 to equal 2` (currently produces one merged phase-group).

---

### Task 2: Fix `groupByPhase` in `timeline.ts`

**Files:**
- Modify: `apps/web/src/components/detail/lib/timeline.ts:142-178`

The fix introduces a concept of "anchor" investigation run-groups (the main `investigate` skill run) vs "child" run-groups (scouts, wave2 agents). Anchors are identified by their `skill`. Children are linked to anchors by `runId` prefix.

- [ ] **Step 1: Replace the two functions `isInvestigationRunGroup` and `groupByPhase`**

In `timeline.ts`, replace lines 142–178 (the `isInvestigationRunGroup` function and `groupByPhase` function) with:

```typescript
function isAnchorInvestigationRunGroup(item: RenderItem): boolean {
  if (item.kind !== 'run-group') return false;
  // The main investigate synthesizer — not a scout or wave2 child
  if (item.skill == null) return false;
  return item.skill.startsWith('investigate') &&
    !item.skill.startsWith('scout-') &&
    !item.skill.startsWith('wave2-');
}

function isChildInvestigationRunGroup(item: RenderItem): boolean {
  if (item.kind !== 'run-group') return false;
  if (item.skill?.startsWith('scout-')) return true;
  if (item.skill?.startsWith('wave2-')) return true;
  // Fallback: run-group whose items include swarm.* events (covers heartbeats etc.)
  return item.items.some(
    (child) => child.kind === 'event' && child.event.kind.startsWith('swarm.'),
  );
}

function groupByPhase(items: RenderItem[]): RenderItem[] {
  const anchors = items.filter(isAnchorInvestigationRunGroup);
  const children = items.filter(isChildInvestigationRunGroup);

  // No investigation events at all — nothing to group
  if (anchors.length === 0 && children.length === 0) return items;

  // Build one phase-group per anchor, attaching children by runId prefix.
  // Children whose runId starts with `${anchor.runId}:` belong to that anchor.
  const claimedChildRunIds = new Set<string>();
  const phaseGroups: Array<{ anchor: RenderItem; children: RenderItem[] }> = anchors.map(
    (anchor) => {
      const anchorRunId = (anchor as Extract<RenderItem, { kind: 'run-group' }>).runId;
      const ownChildren = children.filter((child) => {
        const childRunId = (child as Extract<RenderItem, { kind: 'run-group' }>).runId;
        return childRunId.startsWith(`${anchorRunId}:`);
      });
      for (const c of ownChildren) {
        claimedChildRunIds.add((c as Extract<RenderItem, { kind: 'run-group' }>).runId);
      }
      return { anchor, children: ownChildren };
    },
  );

  // Orphaned children (no matching anchor yet — live run still in progress)
  const orphans = children.filter(
    (c) => !claimedChildRunIds.has((c as Extract<RenderItem, { kind: 'run-group' }>).runId),
  );

  // Build the phase-group RenderItems
  function makePhaseGroup(anchorItem: RenderItem, childItems: RenderItem[]): RenderItem {
    const all = [...childItems, anchorItem];
    const starts = all
      .map((i) => (i.kind === 'run-group' ? i.startedAt : null))
      .filter((s): s is string => s != null);
    const ends = all
      .map((i) => (i.kind === 'run-group' ? (i.endedAt ?? i.lastEventAt) : null))
      .filter((s): s is string => s != null);
    return {
      kind: 'phase-group',
      phase: 'investigation',
      label: 'Investigation',
      items: all,
      startedAt: starts.length > 0 ? starts.reduce((a, b) => (a < b ? a : b)) : null,
      endedAt: ends.length > 0 ? ends.reduce((a, b) => (a > b ? a : b)) : null,
    };
  }

  // Orphans with no anchor get their own best-effort phase-group
  function makeOrphanPhaseGroup(orphanItems: RenderItem[]): RenderItem {
    const starts = orphanItems
      .map((i) => (i.kind === 'run-group' ? i.startedAt : null))
      .filter((s): s is string => s != null);
    const ends = orphanItems
      .map((i) => (i.kind === 'run-group' ? (i.endedAt ?? i.lastEventAt) : null))
      .filter((s): s is string => s != null);
    return {
      kind: 'phase-group',
      phase: 'investigation',
      label: 'Investigation',
      items: orphanItems,
      startedAt: starts.length > 0 ? starts.reduce((a, b) => (a < b ? a : b)) : null,
      endedAt: ends.length > 0 ? ends.reduce((a, b) => (a > b ? a : b)) : null,
    };
  }

  // All investigation-related run-groups to remove from the flat list
  const investigationRunIds = new Set<string>([
    ...anchors.map((a) => (a as Extract<RenderItem, { kind: 'run-group' }>).runId),
    ...children.map((c) => (c as Extract<RenderItem, { kind: 'run-group' }>).runId),
  ]);

  const flatWithout = items.filter((item) => {
    if (item.kind !== 'run-group') return true;
    return !investigationRunIds.has(item.runId);
  });

  // Insert phase-groups at the position of their earliest member in the original list
  // Strategy: find the first index (in `items`) of any member of the group, use that slot.
  const result: RenderItem[] = [...flatWithout];

  const allPhaseGroups: RenderItem[] = [
    ...phaseGroups.map(({ anchor, children: c }) => makePhaseGroup(anchor, c)),
    ...(orphans.length > 0 ? [makeOrphanPhaseGroup(orphans)] : []),
  ];

  // For each phase-group, find the earliest position its members occupied in `items`
  // and splice into `result` at the equivalent position after removals.
  // Simplest correct approach: sort phase-groups by their startedAt, then insert
  // in sorted order into `result` (which is already sorted by effectiveTimestamp).
  // `result` is sorted descending (newest first) by effectiveTimestamp from groupEvents.
  const sortedPhaseGroups = [...allPhaseGroups].sort((a, b) => {
    const aT = a.kind === 'phase-group' && a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const bT = b.kind === 'phase-group' && b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return bT - aT; // descending, newest first
  });

  // Find insertion index: insert each phase-group before the first item in `result`
  // that is older (smaller timestamp) than the phase-group's startedAt.
  for (const pg of sortedPhaseGroups) {
    const pgTime =
      pg.kind === 'phase-group' && pg.startedAt ? new Date(pg.startedAt).getTime() : 0;
    let insertIdx = result.findIndex((item) => effectiveTimestamp(item) < pgTime);
    if (insertIdx === -1) insertIdx = result.length;
    result.splice(insertIdx, 0, pg);
  }

  return result;
}
```

- [ ] **Step 2: Run all timeline tests**

```bash
cd /Users/shaunnesbitt/projects/goose-hub
pnpm --filter web vitest run apps/web/src/components/detail/lib/timeline.test.ts 2>&1 | tail -40
```

Expected: all 5 tests PASS.

- [ ] **Step 3: Run full typecheck**

```bash
cd /Users/shaunnesbitt/projects/goose-hub
pnpm --filter web tsc --noEmit 2>&1 | head -40
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/detail/lib/timeline.ts \
        apps/web/src/components/detail/lib/timeline.test.ts
git commit -m "fix(timeline): group investigation events per-run, not globally

Scout runIds follow the \`\${parentRunId}:scout:...\` prefix convention.
Use that to attach each scout run-group to its parent investigation
anchor, producing one phase-group per investigation run instead of one
merged group across all runs."
```

---

## Self-Review

**Spec coverage:**
- [x] Each investigation run gets its own phase-group — covered by Task 2's `groupByPhase` rewrite + Task 1's multi-run test
- [x] Scouts attach to correct parent via runId prefix — covered
- [x] Orphaned scouts (live in-progress run with no anchor yet) — covered by orphan path → `makeOrphanPhaseGroup`
- [x] Existing single-run tests still pass — no removals to existing test cases
- [x] `state.transitioned` remains outside phase-groups — the `flatWithout` filter preserves non-investigation items

**Placeholder scan:** None found. All code is complete.

**Type consistency:**
- `isAnchorInvestigationRunGroup` and `isChildInvestigationRunGroup` both guard `item.kind !== 'run-group'` before accessing `item.skill` / `item.runId`
- The cast `as Extract<RenderItem, { kind: 'run-group' }>` is used consistently after the kind guard
- `effectiveTimestamp` is reused from the existing export — not redefined
- `makePhaseGroup` and `makeOrphanPhaseGroup` return `RenderItem` matching the `phase-group` variant

**Edge cases verified:**
- Zero investigation runs → `anchors.length === 0 && children.length === 0` → returns `items` unchanged
- All scouts, no anchor yet (live run mid-flight) → all go to orphan group
- Single investigation run → one phase-group (same as before, existing tests pass)
- Two runs → two phase-groups (new test)
