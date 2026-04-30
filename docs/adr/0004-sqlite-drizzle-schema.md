---
id: "0004"
title: SQLite via Drizzle ORM for local operational state
status: accepted
date: 2026-04-30
milestone: M1
---

## Context

Goose Hub needs to persist operational state (active milestone per project, event log, governance audit trail) locally. The system is single-user, local-first, and must not require external infrastructure.

## Decision

Use SQLite (via `better-sqlite3`) with Drizzle ORM for schema definition and migrations. Three tables in M1:

- `project_state` — one row per project, tracks active milestone and last tick timestamp.
- `events` — append-only log of all factory events; indexed on `(project_id, created_at)` for timeline queries.
- `governance_audit` — log of PR governance checks (factory:bootstrap-pr rule enforcement).

## Consequences

- Zero external dependencies; the DB file lives alongside the repo. No Docker, no server.
- Drizzle provides typed queries and schema-driven migrations without the overhead of a full ORM.
- `events` is intentionally append-only — no updates or deletes. Queries always filter by `project_id` and time range; the composite index supports this.
- Additional tables (`work_items`, `budgets`, etc.) are added in later milestones via new migration files; existing schema is never altered destructively.
- `core/db/` is built in M1 but has no live consumer until M2 (the server needs the events table for the timeline panel). This is intentional — schema migrations are easier to get right before any surface code depends on them.
