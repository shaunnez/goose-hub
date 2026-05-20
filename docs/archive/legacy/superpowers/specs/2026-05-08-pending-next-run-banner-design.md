# Pending Next Run Banner

**Date:** 2026-05-08  
**Status:** Approved

## Problem

After a Factory agent run completes, the work item transitions to an auto-trigger state (e.g. `factory:grilling`, `factory:needs-qa`). There is a gap — sometimes seconds, sometimes longer — between the previous run ending and the next one starting. During this gap the timeline shows nothing live and the user has no indication that something is about to happen.

## Solution

A thin informational banner rendered at the top of the detail panel (same slot as `GatePendingBanner`) that reads:

> **Next run pending · write-prd**

Shown only during the gap: state is an auto-trigger state AND no run is currently live.

## Constants

Add to `apps/web/src/lib/constants.ts`:

```ts
export const PENDING_NEXT_RUN_STATES: Record<string, string> = {
  'factory:triaging':     'triage',
  'factory:grilling':     'grill-me',
  'factory:prd-drafting': 'write-prd',
  'factory:decomposing':  'decompose-issues',
  'factory:dev-ready':    'implement',
  'factory:in-progress':  'implement',
  'factory:needs-qa':     'qa',
  'factory:needs-fix':    'fix-issue',
  'factory:retrospecting':'retrospective',
};
```

No overlap with `GATE_STATES` — they cover disjoint state sets.

## Component: `PendingNextRunBanner`

**File:** `apps/web/src/components/detail/components/PendingNextRunBanner.tsx`

**Props:** `{ state?: string; projectSlug?: string; id?: string }`

**Logic:**

1. If `state` not in `PENDING_NEXT_RUN_STATES` → return null (skip fetch entirely)
2. `useQuery(fetchEvents, { refetchInterval: 5000 })` — same pattern as `GatePendingBanner`
3. Compute `isLive`: scan events for the last `agent.run-started`; if any terminal event (`agent.run-completed`, `agent.run-failed`, `grill.question-posted`, `grill.completed`, `decompose.completed`, `retrospective.completed`, `prd.drafted`) appears after it → not live. If no `agent.run-started` at all → not live.
4. If `isLive` → return null (timeline already shows active run)
5. Render banner

**Visual:**
- Same structural layout as `GatePendingBanner` (thin horizontal strip, `border-b`)
- Colour: muted/neutral (not warning yellow, not danger red) — `text-fg-3 border-fg-3/20 bg-fg-3/5`
- Icon: `Clock` (lucide-react, size 14)
- Text: `"Next run pending · {skillName}"`
- No action buttons

## Placement in DetailPage

```tsx
<GatePendingBanner state={item?.state} ... />
<PendingNextRunBanner state={item?.state} projectSlug={slug} id={id} />
```

`GatePendingBanner` renders null for auto-trigger states; `PendingNextRunBanner` renders null for gate states. Only one is ever visible.

## Testing

- Unit: `computeIsLive(events)` helper tested in isolation — cases: no events, live run, completed run, failed run
- Component: renders for auto-trigger state with completed-run events; hides when live run events present; hides for gate states

## Out of Scope

- SSE-driven live updates (polling at 5s is sufficient for this gap indicator)
- Estimated time-to-start
- Cancellation
