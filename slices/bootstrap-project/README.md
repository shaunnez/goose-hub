# slices/bootstrap-project

End-to-end project bootstrap workflow. Closes M12.04 (#307).

## What it does

Given an `owner/repo` ref, runs the four bootstrap building blocks (M12.01–03)
and opens a registration PR against `shaunnez/goose-hub` so a human can review
and merge to admit the project into Factory's roster.

## Vertical surfaces touched

- **Workflow**: `core/workflows/bootstrap-project.ts`
  - `bootstrapProject(input, deps?)` — the entry point.
  - `BootstrapInput`, `BootstrapResult`, `BootstrapDeps` — public types.
  - Helpers: `sanitiseSlug`, `parseRepoRef`, `summariseStack`,
    `renderProjectConfig`, `renderPrBody`.
- **Tests**: this directory's `slice.test.ts`.
- **No UI / DB / app changes** — the workflow is a stateless orchestrator.

The workflow imports from existing core modules (no cross-slice imports):

- `core/bootstrap/stack-detector.ts` — Step 1
- `core/bootstrap/claude-md-auditor.ts` — Step 2
- `core/bootstrap/label-installer.ts` — Step 3

## Algorithm

1. Validate `repoRef` and resolve `slug` (override or sanitised repo name).
2. **Idempotency check**: GET
   `https://api.github.com/repos/shaunnez/goose-hub/pulls?head=shaunnez:bootstrap/<slug>&state=all`
   and filter results by exact `head.ref` match. If any PR exists (open OR
   closed/merged), return `status: 'idempotent-skip'` without making any
   mutating calls — labels are not installed, no branch is created.
3. **Step 1**: `detectStack(<cloneRoot>/<repo>)` → `StackInfo`.
4. **Step 2**: `auditClaudeMd(<cloneRoot>/<repo>, stackInfo)` → `AuditResult`
   (`create` / `update` / `ok`).
5. **Step 3**: `installLabels(<repoRef>, token, fetch)` on the *target* repo.
6. **Step 4**: render `target-projects/<slug>/project.config.ts` content (in
   memory).
7. **Step 5**: open the registration PR on `shaunnez/goose-hub`:
   - GET the default branch SHA.
   - Create `refs/heads/bootstrap/<slug>` from that SHA.
   - PUT `target-projects/<slug>/project.config.ts` to the new branch via
     the Contents API.
   - Open the PR titled `Bootstrap: <owner>/<repo>` against the default
     branch.
   - POST `factory:bootstrap-pr` to the PR's `/issues/<n>/labels` endpoint.

We do **not** add the target repo's CLAUDE.md to the goose-hub registration
PR. The audit's create/diff content is rendered into the PR body so the human
can copy it across to the target repo. Adding CLAUDE.md to a goose-hub PR
would not be a governance violation per se (root CLAUDE.md is allowed under
the bootstrap-pr exception), but doing so on every project bootstrap would
overwrite goose-hub's own CLAUDE.md with the target's — which is wrong.

## PR creation mechanic

We use the GitHub Contents API + the Refs API rather than cloning goose-hub
locally and pushing. Trade-offs:

- **Pro**: workflow runs from any host with a token; no local checkout
  required; no subprocess management.
- **Pro**: the file write is atomic from GitHub's perspective (one commit per
  PUT) and trivially mockable in tests via `fetch`.
- **Con**: the Contents API is limited to a few files per PR. For bootstrap
  we only ever push one file (`project.config.ts`), so this isn't a real
  constraint today. If we later need to push many files, switch to the
  lower-level Git Data API (blobs → tree → commit → ref).

## Idempotency contract

A "registration PR" is identified solely by its head branch name
(`bootstrap/<slug>`). If that branch has *ever* been used in a PR — open,
closed, or merged — we treat the project as already registered and decline to
create a new PR. To re-bootstrap a project, supply a different `slug`
override.

## Governance hygiene

This slice does **not** create any governance file in this PR. The scaffold
content is generated at *runtime* (when `bootstrapProject` is invoked) and
lives only on the bootstrap branch we push to GitHub. Tests use
mocked `writeFile`/`mkdir` so no `target-projects/<slug>/` directories appear
on disk during the test suite. The new `factory:bootstrap-pr` exception
governance check (PR #583) will allow the PRs the workflow opens, since they
*add* (not modify) governance files and carry the bootstrap label.

## Usage

```ts
import { bootstrapProject } from '@goose-hub/core/workflows/bootstrap-project.js';

const result = await bootstrapProject({
  repoRef: 'octo/widgets',
  token: process.env.GITHUB_TOKEN!,
  cloneRoot: '/tmp/factory-clones',
});
console.log(result);
// { status: 'created', registrationPrUrl: '...', slug: 'widgets', ... }
```

## Running the tests

```bash
pnpm vitest run slices/bootstrap-project/slice.test.ts
```

No live GitHub calls are made — all tests inject a mock `fetch`.
