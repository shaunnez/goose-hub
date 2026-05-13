# core/connectors

External-system adapters. Each subdirectory wraps one external API behind a narrow interface that slices and workflows depend on. Connectors own retry, timeout, and error-shape contracts so workflow code stays oblivious to transport details.

## Subdirectories

| Dir | Purpose |
|---|---|
| `github/` | Open a PR (`open-pr.ts`) and merge a PR (`merge-pr.ts`) via the GitHub REST API. Defines `MergeConflictError` so callers can dispatch the resolve-conflict workflow when GitHub returns HTTP 405. See `github/README.md`. |

## Top-level adapters

| File | Purpose |
|---|---|
| `bitbucket.ts` (M14.03 / #323) | Read-only Bitbucket Cloud connector — `getFile`, `searchCode`, `listPullRequests`, plus `getRepoMetadata` / `listWorkspaceRepos` used by the matcher. Reads `BITBUCKET_USER` / `BITBUCKET_APP_PASSWORD` (HTTP Basic). Constructor throws if either is unset. Also exports `parseBitbucketCloneUrl` for SSH + HTTPS URL parsing. |
| `bitbucket-matcher.ts` (M14.04 / #326) | Repo-matching adapter — `matchRepo(issue, connector)` returns the top-3 Bitbucket candidates ranked by project-key overlap, keyword similarity, and prior selections. Score `>= 0.7` is auto-selected; lower confidence surfaces the choices via `factory:gate-pending`. Sticky behaviour: prior selections persist in a self-bootstrapping `bitbucket_repo_matches` SQLite table (no drizzle migration). |

## Adding a new connector

1. New directory under `core/connectors/<name>/`.
2. Each public function takes its `token`/credentials as input — never read process env directly.
3. Throw typed errors (subclass `Error` with a discriminating `name`); never return `null`/`undefined` to signal failure.
4. Include a `slice.test.ts` exercising the happy path and the documented failure paths with a mocked `fetch`.
5. Add a `README.md` in the new connector folder.
