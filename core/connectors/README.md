# core/connectors

External-system adapters. Each subdirectory wraps one external API behind a narrow interface that slices and workflows depend on. Connectors own retry, timeout, and error-shape contracts so workflow code stays oblivious to transport details.

## Subdirectories

| Dir | Purpose |
|---|---|
| `github/` | Open a PR (`open-pr.ts`) and merge a PR (`merge-pr.ts`) via the GitHub REST API. Defines `MergeConflictError` so callers can dispatch the resolve-conflict workflow when GitHub returns HTTP 405. See `github/README.md`. |

## Adding a new connector

1. New directory under `core/connectors/<name>/`.
2. Each public function takes its `token`/credentials as input — never read process env directly.
3. Throw typed errors (subclass `Error` with a discriminating `name`); never return `null`/`undefined` to signal failure.
4. Include a `slice.test.ts` exercising the happy path and the documented failure paths with a mocked `fetch`.
5. Add a `README.md` in the new connector folder.
