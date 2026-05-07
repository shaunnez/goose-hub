# slices/bootstrap-wizard

End-to-end UI for adding a new project to Factory's roster (M12.07, issue #308).

The wizard wraps the existing `bootstrapProject` workflow (M12.04, slice
`slices/bootstrap-project/`) so the human can drive it from the web UI
instead of the CLI.

## Vertical surfaces touched

- **Server domain**: `apps/server/src/domains/bootstrap/`
  - `router.ts` — `POST /projects/bootstrap/preview`, `POST /projects/bootstrap/run`
  - `service.ts` — `previewBootstrapService`, `runBootstrapService` (DI-friendly)
  - `service.test.ts`, `router.test.ts`
- **Web feature**: `apps/web/src/components/bootstrap/`
  - `components/BootstrapWizard.tsx` — 6-step modal
  - `components/BootstrapWizard.test.tsx` — DOM tests with mocked api
  - `lib/wizard-state.ts` — pure step machine + repoRef validation
  - `slice.test.ts`, `README.md`
- **Web hook-up**: `apps/web/src/components/settings/components/SettingsPage.tsx`
  - "Add Project" `+` button next to the reload button on the Settings page
- **Web shared lib**: `apps/web/src/lib/api.ts` adds
  `previewBootstrap()` + `runBootstrap()` helpers; `lib/types.ts` adds
  `BootstrapPreviewDto` + `BootstrapRunDto`.
- **Top-level slice manifest**: `slice.test.ts` (this folder) asserts the
  public surface contract.
- **Playwright e2e**: `apps/web/e2e/bootstrap-wizard.spec.ts` walks the
  wizard end-to-end against a server booted with `MOCK_BOOTSTRAP=true`.

The slice does **not** import from any other slice, and re-uses the core
workflow through its public interfaces (`bootstrapProject`, `parseRepoRef`,
`sanitiseSlug`, `summariseStack`).

## Server endpoint design

Two endpoints, separated for safety:

- **`POST /projects/bootstrap/preview`** — read-only.
  - Validates `repoRef` shape (`parseRepoRef`).
  - Calls `GET /repos/:owner/:repo` to confirm the server can reach the
    repo with its `GITHUB_TOKEN` and to read the default branch.
  - Runs `detectStack(<cloneRoot>/<repo>)` against any local checkout the
    server can see (falls back to `unknown` if absent — the human can edit
    the scaffold before merging the registration PR).
  - Runs `auditClaudeMd(...)` to compute the create-or-diff payload.
  - Returns the canonical `FACTORY_LABELS` set as the
    `labelsToInstall` preview. **No** label mutations occur here.
- **`POST /projects/bootstrap/run`** — destructive.
  - Calls `bootstrapProject(...)` from `core/workflows/bootstrap-project.ts`
    end-to-end (creates labels on the target repo, opens the registration
    PR on `shaunnez/goose-hub`).
  - Returns the resulting PR URL and label install counts.

The split keeps the destructive call site explicit. The wizard uses
`/preview` to populate steps 2-4 and only calls `/run` when the human
clicks the "Open Registration PR" button on the final step.

## Token handling

The GitHub token is **always** server-held (`process.env.GITHUB_TOKEN`).
The browser never collects, stores, or transmits a token. Both endpoints
return 500 if the server lacks a token — this surfaces as the wizard's
error banner so the human can fix their env.

## MOCK_BOOTSTRAP for tests

When the server starts with `MOCK_BOOTSTRAP=true`, both endpoints
short-circuit to deterministic fixture payloads — no GitHub calls, no
real labels installed, no PR opened. The Playwright e2e test boots the
server with this flag set and walks every wizard step.

## Idempotency

Underlying idempotency lives in `bootstrapProject` (slice
`bootstrap-project`). Re-running `/run` for the same `repoRef` returns
`status: 'idempotent-skip'` and the existing PR URL — the wizard's
result panel displays both.

## Running the tests

```bash
# Slice manifest (this file)
pnpm vitest run slices/bootstrap-wizard/slice.test.ts

# Server domain
pnpm vitest run apps/server/src/domains/bootstrap/

# Web component + state machine
pnpm vitest run apps/web/src/components/bootstrap/

# End-to-end (requires the dev server)
MOCK_BOOTSTRAP=true pnpm --filter @goose-hub/web test:e2e bootstrap-wizard.spec.ts
```
