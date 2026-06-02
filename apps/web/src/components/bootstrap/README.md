# bootstrap

Bootstrap wizard UI for adding a local-db project to Factory's roster.

## Structure

```
bootstrap/
  components/
    BootstrapWizard.tsx       — multi-step modal that drives the bootstrap flow
    BootstrapWizard.test.tsx  — DOM-level component tests (mocked api)
  lib/
    wizard-state.ts           — pure step-machine + repo-ref validation
  slice.test.ts
  README.md
```

## Entry point

The "Add Project" button on the **Settings** page opens the wizard
(`apps/web/src/components/settings/components/SettingsPage.tsx`).

## Steps

1. **Source** — user chooses local-only, GitHub code, Jira import,
   Bitbucket PR integration, or an advanced combination.
2. **Config** — server renders the exact `project.config.ts` that will be
   written, including local-db source integrations and required env var names.
3. **Create** — single button calls
   `POST /api/projects/bootstrap/local-project/create` and writes
   `target-projects/<slug>/project.config.ts` locally.

## Server contract

The local creation flow uses two endpoints under the `bootstrap` server domain
(`apps/server/src/domains/bootstrap/`):

- `POST /projects/bootstrap/local-project/preview` — returns
  `LocalProjectCreationPreviewDto { slug, configPath, config, requiredEnvVars }`.
  The preview endpoint is read-only and does not inspect GitHub or import
  provider issues.
- `POST /projects/bootstrap/local-project/create` — writes the previewed
  config locally and returns `LocalProjectCreationRunDto`.

The older GitHub PR bootstrap endpoints still exist for PR-based registration,
but the Settings wizard no longer forces GitHub inspection as the only way to
create a project.

## Mocking the workflow

Component tests mock `previewLocalProjectCreation` and `createLocalProject` so
the wizard can exercise each source mode without touching provider APIs or the
filesystem.

## State machine

`lib/wizard-state.ts` exports a pure 3-step state machine
(`WIZARD_STEPS`, `nextStep`, `prevStep`, `stepIndex`, `stepLabel`) plus
`isValidRepoRef(...)`. Tests in `slice.test.ts` cover every transition.

The wizard component holds `WizardState` in `useState`; resetting the
modal happens automatically on close (so re-opening the wizard always
starts at step 1).
