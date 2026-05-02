# Server API Architecture Design

**Date:** 2026-05-02
**Status:** Approved

## Problem

`apps/server/src/index.ts` is 540 lines containing 23 routes, inline DB calls, repeated body-parse boilerplate (8×), and business logic mixed into route handlers. This blocks testability (can't unit-test a service without spinning up Hono), makes feature velocity slow (adding a route means navigating a 540-line file), and provides no conventions for contributors to follow.

## Goals

- All three in equal measure: testability, new feature velocity, long-term maintainability
- A `STANDARDS.md` guide file (mirroring `apps/web/STANDARDS.md`) that Claude reads before touching any server file

## Chosen Approach: Domain Modules

Split by domain, each owning its routes, service logic, and DB access. A thin shared layer holds connectors and utilities. No horizontal layers.

## Folder Structure

```
apps/server/src/
  index.ts                         ← entry point only: dotenv + serve()
  server.ts                        ← Hono app factory, registers all domain routers, exported for tests
  domains/
    issues/
      router.ts                    ← Hono sub-router: /projects/:slug/issues/**
      service.ts                   ← transition, comment, set-label, set-milestone, repo-override, fake-run, triage, events, comments
    milestones/
      router.ts                    ← /projects/:slug/milestones/**, /projects/:slug/active-milestone
      service.ts                   ← activate, read, cache bust
      repository.ts                ← Drizzle queries for projectState table (absorbs active-milestone.ts)
    inbox/
      router.ts                    ← /inbox/**
      service.ts                   ← create, list, promote
      repository.ts                ← Drizzle queries for inboxItems (moved out of index.ts)
    events/
      router.ts                    ← GET /events SSE stream
    projects/
      router.ts                    ← GET /projects, GET /health
    webhooks/
      router.ts                    ← POST /webhooks/github
      handler.ts                   ← github.ts content moves here (verifyGitHubSignature, handleGitHubWebhook)
    workflows/
      router.ts                    ← POST /projects/:slug/tick
      triage-batch.ts              ← unchanged, re-homed from src/workflows/triage-batch.ts
  shared/
    middleware.ts                  ← parseBody<T>(), errorHandler
    cache.ts                       ← unchanged (getCached, bustCache) + CACHE_KEY moved here from index.ts
    source.ts                      ← unchanged (getSourceForSlug)
    projects.ts                    ← unchanged (listProjects, getProject)
```

**Rules:**
- Domains with no SQLite state (issues, events, projects, webhooks, workflows) have no `repository.ts` — do not create empty files
- `server.ts` is the only file that imports from multiple domains
- No domain imports from another domain — violations are architecture errors
- `shared/` is the only cross-domain import target
- `active-milestone.ts` is deleted after its logic moves to `domains/milestones/repository.ts`
- `webhooks/github.ts` is deleted after its logic moves to `domains/webhooks/handler.ts`

## Layer Contracts

Dependency direction: **router → service → repository**. Each layer has one job. Dependencies never flow upward.

### Router

HTTP only. Parses params and body, calls the service, returns JSON. No business logic, no DB calls, no `eventStore` calls.

```ts
// Example: domains/issues/router.ts
router.post('/:id/transition', async (c) => {
  const body = await parseBody<{ from: string; to: string }>(c);
  if (!body.ok) return body.error;
  const result = await issueService.transition(c.req.param('slug'), c.req.param('id'), body.data);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status);
});
```

### Service

Business logic only. Validates inputs, calls source/repository/eventStore, returns a typed `Result<T, { error: string; status: number }>`. Never receives a Hono `Context` — takes plain typed arguments only. This is what makes services unit-testable without HTTP.

```ts
// Example: domains/issues/service.ts
export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export async function transition(slug: string, id: string, body: { from: string; to: string }): Promise<Result<{ ok: true; from: string; to: string }>>
```

### Repository

Drizzle queries only. No business logic, no event emission. Returns domain types, not raw DB rows. Exported as named functions — no class wrappers.

```ts
// Example: domains/inbox/repository.ts
export async function listInboxItems(): Promise<InboxItem[]>
export async function insertInboxItem(item: NewInboxItem): Promise<InboxItem>
export async function deleteInboxItem(id: number): Promise<void>
export async function getInboxItem(id: number): Promise<InboxItem | null>
```

### Shared Middleware

The 8× repeated body-parse boilerplate becomes one utility in `shared/middleware.ts`:

```ts
export async function parseBody<T>(c: Context): Promise<
  | { ok: true; data: T }
  | { ok: false; error: Response }
>
```

On parse failure, logs a warning and returns `{ ok: false, error: c.json({ error: 'invalid request body' }, 400) }`. Callers return `body.error` directly.

## Data Flow

```
HTTP request
  → router: parse slug/id/body via parseBody<T>()
  → service: validate business rules, call source/repository/eventStore
  → repository (if DB): Drizzle query, return domain type
  → service: emit event, bust cache, build response
  → router: c.json(result.data) or c.json({ error }, status)
```

The `source` (GitHub StateSource) and `eventStore` are imported directly by service files — they are shared infrastructure, not injected. This is acceptable given the single-user, local-first nature of Goose Hub.

## Testing Conventions

| Layer | What to test | How |
|-------|-------------|-----|
| `service.ts` | Business logic, validation, event emission | Mock `getSourceForSlug`, `eventStore`, `repository` — no Hono, no HTTP |
| `repository.ts` | Drizzle queries | Real in-memory SQLite (same pattern as existing `active-milestone.test.ts`) |
| `router.ts` | HTTP contract (status codes, body shape) | `app.request()` with mocked service — only for non-trivial HTTP behaviour |
| `shared/middleware.ts` | Body parse edge cases | Pure function, no mocks needed |

**Naming:** each domain gets one `*.test.ts` at the service layer as the primary slice test. Router tests live alongside their router as `router.test.ts` when the HTTP contract has meaningful edge cases (e.g., webhook signature verification).

**Coverage targets:** service layer must cover all validation branches and happy paths. Repository tests cover each exported function. The existing `index.test.ts` tests migrate to their respective domain test files.

## Migration Plan

All existing tests must pass after migration — no behaviour changes, pure structural move.

1. Create `shared/middleware.ts` with `parseBody<T>()`
2. Create `server.ts` as Hono app factory (initially delegates to existing `index.ts` logic)
3. Create each domain folder with `router.ts`, `service.ts`, and `repository.ts` (where applicable)
4. Move logic domain by domain: milestones → inbox → issues → events → projects → webhooks → workflows
5. Update `index.ts` to entry-point only
6. Delete `active-milestone.ts` and `webhooks/github.ts`
7. Write `apps/server/STANDARDS.md`
8. Add new service-layer tests for previously untested branches

## The Guide File

`apps/server/STANDARDS.md` mirrors `apps/web/STANDARDS.md`. It is read by Claude before touching any file in `apps/server/src/`. It encodes: folder structure, layer contracts, import rules, testing table, and decision flowchart for "where does this code go."
