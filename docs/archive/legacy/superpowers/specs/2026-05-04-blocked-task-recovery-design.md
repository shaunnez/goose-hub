# Blocked Task Recovery Design

**Date:** 2026-05-04  
**Status:** Approved

## Problem

`factory:needs-human` is a terminal state with no outgoing transitions. Once a task escalates there, the human has no UI path to send it back into the pipeline. The banner says "Human intervention required" but offers no guidance on what to do or why the escalation happened.

## Solution

Two changes:

1. Add recovery transitions out of `factory:needs-human` in the state machine.
2. Upgrade the `GatePendingBanner` for this state to show the escalation reason and action buttons.

## State Machine Changes

Add four outgoing transitions from `factory:needs-human`:

- `factory:triaging` — start over from scratch
- `factory:dev-ready` — re-queue for agent development
- `factory:needs-qa` — re-run QA (skip dev)
- `factory:rejected` — close the issue

Files changed:

- `core/state-machine/transitions.ts` — authoritative definition
- `apps/web/src/lib/transitions.ts` — browser mirror (UI uses this to filter the Transition popover)

The server-side `transitionIssue` service already delegates to `isLegalTransition` from core; no server changes needed.

## Banner Changes (`GatePendingBanner.tsx`)

### Escalation reason

When `state === 'factory:needs-human'`, the banner fetches events via `useQuery`:

```ts
const { data: events = [] } = useQuery({
  queryKey: ['events', projectSlug, id],
  queryFn: () => fetchEvents(projectSlug, id),
  enabled: state === 'factory:needs-human' && !!projectSlug && !!id,
});
```

Finds the last `agent.decision-summary` event. Renders `payload.summary` (string) or falls back to `JSON.stringify(payload).slice(0, 120)`. If no event found or fetch fails, reason is silently absent — buttons still render.

### Action buttons

```ts
'factory:needs-human': {
  sendToTriage: 'factory:triaging',
  sendToDev: 'factory:dev-ready',
  sendToQA: 'factory:needs-qa',
  reject: 'factory:rejected',
},
```

Rendered in right side of banner matching existing button pattern. Labels: **Triage**, **Dev**, **QA**, **Reject**.

### Colour

`needs-human` uses danger red (`--danger`) instead of warning yellow — it is a harder stop than a gate-pending state.

## Data Flow

```
DetailPage
  └─ GatePendingBanner(state, projectSlug, id, onTransitioned)
       ├─ useQuery → fetchEvents → finds last agent.decision-summary → reason excerpt
       └─ on button click → transitionState(projectSlug, id, state, target)
            └─ success → onTransitioned() → invalidates ['issue'] + ['issues'] caches
```

## Error Handling

| Failure | Behaviour |
|---|---|
| Event fetch fails | Reason excerpt absent; buttons still render |
| No `agent.decision-summary` found | No excerpt; no error shown |
| `payload` has no `.summary` field | Fallback: `JSON.stringify(payload).slice(0, 120)` |
| Transition call fails | Existing `error` state in banner shows message |

## Testing

- `core/state-machine/transitions.test.ts` — assert all four recovery targets are legal from `needs-human`; assert no other outgoing targets added accidentally
- `GatePendingBanner` unit test:
  - Mock events API returning a `decision-summary` event — assert excerpt renders
  - Mock events returning empty — assert buttons still render, no crash
  - Assert all 4 buttons render for `needs-human` state
  - Assert `transitionState` called with correct target on click
- `TransitionButton` existing tests — assert `needs-human` no longer triggers "No transitions" path

## Files Touched

| File | Change |
|---|---|
| `core/state-machine/transitions.ts` | Add 4 outgoing from `needs-human` |
| `apps/web/src/lib/transitions.ts` | Mirror same 4 targets |
| `apps/web/src/components/detail/components/GatePendingBanner.tsx` | Fetch + reason excerpt + 4 action buttons + danger colour |
| Tests for all three above | New/updated assertions |
