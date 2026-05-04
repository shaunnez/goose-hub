# Persona Attribution & Goosey Spy Names

**Date:** 2026-05-04  
**Status:** Approved

## Problem

Persona identity is currently invisible at the work-item level. The Roster tab is a standalone page with no connection to task detail, timeline, or kanban. Events carry no persona attribution — `personaId` exists on `AgentSpec` during a run but is never written to the event store. There is no human-readable name for any persona slot.

## Goal

Surface persona identity throughout the UI so it is obvious which agent did what, using persistent goosey spy codenames.

---

## Data Layer

### New table: `personaNames`

```sql
personaNames (
  id          integer  PRIMARY KEY AUTOINCREMENT,
  projectId   text     NOT NULL,
  role        text     NOT NULL,
  slotIndex   integer  NOT NULL,
  codename    text     NOT NULL,
  UNIQUE (projectId, role, slotIndex)
)
```

Populated by `selectPersona()` on first slot creation. Authoritative codename registry — exists before any run completes.

### `events` table migration

Add nullable column: `personaId text`. Old rows null; new rows carry the `projectId/role/index` string.

### `personaStats` unchanged

Codename resolved via JOIN with `personaNames` when serving the roster API.

---

## Codename Generation

30 goosey spy codenames, assigned by `(total_slots_ever_created mod 30)` at slot creation time:

```
Grey Honker    Iron Beak      Silent Wing    Dark Feather   Swift Migrant
Bold Gosling   Shadow Flock   Crimson Plume  Frost Gaggle   Night Wader
Copper Bill    Ashen Glide    Storm Preen    Jade Gander    Onyx Quill
Tundra Drift   Ember Waddle   Cobalt Flap    Phantom Crest  Rogue Pinion
Silver Down    Marsh Glider   Arctic Honk    Dusk Preen     Gilded Wing
Sable Gosling  Steel Migrate  Amber Feather  Mossy Beak     Velvet Flock
```

Initials: first letter of each word — `Grey Honker` → `GH`, `Marsh Glider` → `MG`.

Display format: `"Grey Honker (DEV)"` — codename + uppercase role abbreviation.

Role abbreviations:

| Role | Abbrev |
|------|--------|
| triager | TRG |
| developer | DEV |
| qa | QA |
| reviewer | REV |
| investigator | INV |
| decomposer | DEC |
| prd-writer | PRD |
| researcher | RSR |
| retrospector | RET |
| griller | GRL |

---

## Server Changes

### `selectPersona()` — `core/agent-runtime/select-persona.ts`

Return type changes from `string` to `{ personaId: string; codename: string }`.

On first slot creation: generate codename from list (count of existing `personaNames` rows mod 30), insert into `personaNames` with `slotIndex` matching the round-robin index. Subsequent calls for the same slot return the stored codename.

### `AppendEventInput` + `AgentEvent` — `core/event-stream/store.ts`

Add `personaId?: string | null` to both interfaces. `appendEvent()` writes it to the DB column. `replay()` includes it in returned rows.

### `claude-cli.ts` — `core/agent-runtime/claude-cli.ts`

`spec.personaId` already exists on `AgentSpec`. Pass it to every `appendEvent()` call in the run: `agent.run-started`, `agent.run-completed`, `agent.run-failed`, and all intermediate events (logs, tool calls).

### `AgentEventDto` — `apps/web/src/lib/types.ts`

Add `personaId?: string | null`.

### Roster API — `apps/server/src/domains/roster/`

`listPersonas()` JOINs `personaStats` with `personaNames` on parsed `(projectId, role, index)` from `personaName` field. `PersonaStatDto` gains `codename: string`.

### `WorkItemDto` — `apps/web/src/lib/types.ts`

Add `lastPersonaId?: string | null`. Server computes this as the `personaId` from the most recent `agent.run-started` event for that `workItemId`. The work items list endpoint (`apps/server/src/domains/work-items/`) must include this field in the DTO mapping — one subquery per work item, or a batch lookup keyed by workItemId.

---

## Frontend Changes

### Persona map hook

```ts
// usePersonaMap(): Record<personaId, { codename: string; role: string }>
```

Built from `PersonaStatDto[]` returned by `fetchRoster()`. Loaded at page level and passed as prop to timeline and board. No new API endpoint.

### Timeline — `apps/web/src/components/detail/`

- `RenderItem` run-group type gains `personaId?: string`
- `extractRunMeta()` reads `personaId` from the `agent.run-started` event
- `RunGroupWrapper` accepts `personaMap` + `personaId`; run group header renders:

  ```
  Marsh Glider (INV) · Investigator Run · Live · running for 12s
  ```

### Kanban cards — `apps/web/src/components/board/components/IssueCard.tsx`

`IssueCard` receives persona map. When `item.lastPersonaId` is set, render initials chip at bottom-right (replacing the `$—` cost placeholder stub):

```
[MG]  ← tooltip: "Marsh Glider (INV)"
```

### Issue detail — `apps/web/src/components/detail/components/OverviewSection.tsx`

Add "Last agent" row in sidebar showing `"Marsh Glider (INV)"` resolved from persona map + `item.lastPersonaId`.

### Roster page — `apps/web/src/components/roster/components/RosterPage.tsx`

`PersonaCard` replaces `persona.personaName` (raw ID) display with `persona.codename`. Role label already comes from the `RoleGroup` header above.

---

## Out of Scope

- Clicking a persona name to navigate to the Roster drill-in (future)
- Persona-aware routing changes (M9 adds stats weighting; this design is display-only)
- Backfilling codenames onto existing `personaStats` rows with no `personaNames` entry (old rows show raw ID as fallback)
