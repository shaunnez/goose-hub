---
id: "0002"
title: Explicit adjacency-list transition table
status: accepted
date: 2026-04-30
milestone: M1
---

## Context

Legal state transitions need to be enforced at the point of any write action (M2+). The question was whether to derive transitions from state metadata, compute them dynamically, or declare them explicitly.

## Decision

Declare transitions as a static `Record<StateName, readonly StateName[]>` adjacency list in `transitions.ts`. Expose `legalTargets(from)` and `isLegalTransition(from, to)` as the public interface.

## Consequences

- The full transition graph is readable in one place; auditable by humans and agents without running code.
- New states require a corresponding entry; TypeScript's `Record<StateName, ...>` enforces exhaustiveness at compile time.
- `needs-review → rejected` is explicitly included to cover "human explicitly cancelled" (section 9.2) — a non-obvious edge that would be invisible in a computed approach.
- The M2 write path and any future orchestrator workflow call `isLegalTransition` before applying a state change; illegal transitions are rejected at that layer, not silently dropped.
