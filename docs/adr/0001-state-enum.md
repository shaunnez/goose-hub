---
id: "0001"
title: Typed state enum as a frozen const array
status: accepted
date: 2026-04-30
milestone: M1
---

## Context

Goose Hub needs a single source of truth for the 23 canonical factory states that map to GitHub labels. Multiple consumers need both type-safety (compile-time exhaustiveness) and runtime iteration (conflict resolution, CLI display, label installation).

## Decision

Represent states as a `as const` frozen array (`STATES`) rather than a TypeScript `enum` or plain string union. Export `StateName = (typeof STATES)[number]` for the type.

## Consequences

- `STATES.indexOf(label)` gives canonical ordering for conflict resolution without a separate rank map.
- Adding a state is a single-line edit; the type union updates automatically.
- Frozen array prevents accidental mutation at runtime.
- Iteration order is canonical order, which drives the "highest index wins" rule in the conflict resolver.
- TypeScript `enum` was rejected: numeric enums produce non-obvious JS values; string enums don't support `indexOf` ordering cleanly.
