# Server API Standards

> Claude: read this before touching any file in `apps/server/src/`.

## Folder Structure

Every feature in the server MUST be placed into one of the domain folders under `src/domains/`. Domains map to URL prefixes:

| Domain | URL prefix | Has repository? |
|--------|-----------|-----------------|
| `issues/` | `/projects/:slug/issues/**` | No (GitHub-sourced) |
| `milestones/` | `/projects/:slug/milestones/**`, `/projects/:slug/active-milestone` | Yes (SQLite `projectState`) |
| `inbox/` | `/inbox/**` | Yes (SQLite `inboxItems`) |
| `events/` | `/events` | No |
| `projects/` | `/projects`, `/health` | No |
| `webhooks/` | `/webhooks/**` | No |
| `workflows/` | `/projects/:slug/tick` | No |
| `costs/` | `/projects/:slug/costs/**`, `/projects/:slug/issues/:id/costs` | Reads only (writes from `core/cost`) |

Each domain folder contains:

```
domains/<name>/
  router.ts        ← Hono sub-router, HTTP parsing only
  service.ts       ← Business logic, validation, event emission
  repository.ts    ← Drizzle queries only (omit if no SQLite state)
  service.test.ts
  repository.test.ts  (if repository.ts exists)
```

## Shared Layer (`shared/`)

Cross-cutting utilities used by 2+ domains live in `shared/`.

| File | Contents |
|------|----------|
| `cache.ts` | `getCached<T>()`, `bustCache()`, `CACHE_KEY` |
| `middleware.ts` | `parseBody<T>()`, `Result<T>` type |
| `projects.ts` | `listProjects()`, `getProject()` |
| `source.ts` | `getSourceForSlug()` |

**Rule:** If a utility is only used by one domain, it stays inside that domain. Promote to `shared/` when a second domain needs it.

## Layer Contracts

Dependencies always flow **router → service → repository**. Never backwards.

### Router (`router.ts`)
- HTTP parsing only: read params, parse body with `parseBody<T>()`, return JSON
- No DB calls, no business logic, no `eventStore` calls directly

```ts
router.post('/:slug/something', async (c) => {
  const body = await parseBody<{ value: string }>(c);
  if (!body.ok) return body.error;
  const result = await service.doThing(c.req.param('slug'), body.data.value);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 400 | 404);
});
```

### Service (`service.ts`)
- Business logic only: validate inputs, call source/repository/eventStore
- Never receives Hono `Context` — takes plain typed arguments
- Returns `Result<T>`: `{ ok: true; data: T }` or `{ ok: false; error: string; status: number }`

```ts
export async function doThing(slug: string, value: string): Promise<Result<{ ok: true }>> {
  if (!value.trim()) return { ok: false, error: 'value is required', status: 400 };
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  return { ok: true, data: { ok: true } };
}
```

### Repository (`repository.ts`)
- Drizzle queries only: no business logic, no event emission
- Exports named async functions, no class wrappers

## Import Rules

- Domain files import shared utilities via the `#shared/*` subpath alias —
  e.g. `import { parseBody } from '#shared/middleware.js'`. Resolved by the
  `imports` field in `apps/server/package.json`. Never use `'../../shared/*'`.
- Cross-package imports use `@goose-hub/<name>/*` (e.g. `@goose-hub/core/...`).
- Intra-domain imports stay relative (`./service.js`, `./repository.js`).
- `server.ts` is the only file that imports from multiple domains.
- Domains **never** import from other domains. Cross-domain coordination
  goes through `#shared/dispatch.js`.
- `index.ts` is the entry point only — no logic, no exports.

Greppable invariant for review:
```sh
grep -rn "from ['\"]\\.\\./\\.\\./shared" apps/server/src/   # must be 0 hits
```

## Dynamic Imports

Static imports are the default. `await import(...)` is reserved for the
following four cases — each occurrence must carry a one-line comment naming
its case:

1. **Cross-package boundary at runtime path.** Loading code that lives outside
   any workspace package (e.g. `slices/`) and is resolved via
   `import.meta.url` so worktree-relative paths stay correct.
2. **Runtime-resolved path.** Loading a module whose absolute path depends on
   user input or per-project config (e.g. each project's `project.config.ts`
   under `target-projects/<slug>/`).
3. **Lazy fallback for an optional dependency.** Tolerating a missing or
   environment-gated module (rare; document the fallback inline).
4. **Test stub injection.** A DI parameter whose default is the static import
   and whose override is supplied dynamically by tests.

If a dynamic import does not match one of these, refactor it to static.

## Body Parsing

Always use `parseBody<T>()` from `#shared/middleware.js`. Never write inline `try/catch` for JSON parsing.

```ts
const body = await parseBody<{ title: string }>(c);
if (!body.ok) return body.error;  // returns 400 automatically
```

## Test Coverage Requirements

| What | Where | Pattern |
|------|-------|---------|
| Service business logic | `<domain>/service.test.ts` | Mock `getSourceForSlug`, `eventStore`, repository — no HTTP |
| Repository queries | `<domain>/repository.test.ts` | Mock `db` with vitest |
| HTTP contracts (non-trivial) | `<domain>/router.test.ts` | `app.request()` with mocked service |

## Adding a New Route

1. Which domain does this URL belong to? Pick the matching domain folder.
2. Add business logic to `service.ts` (write failing test first).
3. Add Drizzle query to `repository.ts` if DB is needed.
4. Add the route handler to `router.ts` (HTTP only).
5. No changes to `server.ts` unless adding a new domain.

## Adding a New Domain

1. Create `src/domains/<name>/` with `router.ts`, `service.ts`, and optionally `repository.ts`.
2. Register the router in `src/server.ts` with `app.route('/prefix', <name>Router)`.
3. Add an entry to the domain table above.
