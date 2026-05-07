# slices/label-installer

Idempotent factory label installer. Closes M12.03 (#306).

## What it does

Provides a programmatic API to install the canonical `factory:*` label set onto
any GitHub repository the caller has write access to.

## Vertical surfaces touched

- **Shared definitions**: `core/bootstrap/labels.ts`
  - `Label` — TypeScript interface `{ name, color, description }`
  - `FACTORY_LABELS: Label[]` — canonical label set (single source of truth)

- **Core lib**: `core/bootstrap/label-installer.ts`
  - `installLabels(repoRef, token, fetch?)` — reconciles the repo label set
  - `InstallResult` — `{ created, updated, skipped, errors }`
  - `InstallError` — `{ name, message }`

- **Refactored script**: `scripts/install-labels.ts`
  - CLI wrapper; imports `FACTORY_LABELS` from `core/bootstrap/labels.ts`
  - No longer duplicates the label list

## Algorithm

1. GET `/repos/{owner}/{repo}/labels?per_page=100` — paginate all existing labels.
2. For each canonical label:
   - absent → POST (create)
   - present but color/description differ → PATCH (update)
   - present and identical → skip
3. Return `InstallResult` with `created`, `updated`, `skipped`, and any `errors`.

Labels not in the canonical set are left untouched (never deleted).

## Usage

```ts
import { installLabels } from '@goose-hub/core/bootstrap/label-installer.js';

const result = await installLabels('owner/repo', process.env.GITHUB_TOKEN!);
console.log(result);
// { created: 50, updated: 0, skipped: 0, errors: [] }
```

## Running the tests

```bash
pnpm test slices/label-installer/slice.test.ts
```

No live GitHub API required — all tests use injected fetch mocks.
