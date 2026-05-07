# bootstrap

Bootstrap wizard UI for adding a new project to Factory's roster. Closes #308 (M12.07).

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

1. **Repository** — user types `owner/repo`. The wizard validates the format
   client-side and calls `POST /api/projects/bootstrap/preview` to confirm
   the server can reach the repo with its configured token. The browser
   never collects or sends a GitHub token.
2. **Stack** — server-detected stack summary (runtime, package manager,
   commands). Read-only.
3. **CLAUDE.md** — preview (`action: 'create'`) or unified diff
   (`action: 'update'`) shown in a read-only textarea. When the existing
   CLAUDE.md already has every required section (`action: 'ok'`), the wizard
   shows a confirmation message instead of an empty editor.
4. **Labels** — list of canonical Factory labels that will be installed on
   the target repo (colour swatch + name + description per label).
5. **Webhook** — copy-pasteable instructions for configuring a GitHub
   webhook at `https://github.com/<owner/repo>/settings/hooks/new`. Mentions
   `ngrok` for local development.
6. **Open Registration PR** — single button calls
   `POST /api/projects/bootstrap/run`, displays the resulting PR URL on
   success.

## Server contract

Two endpoints under the `bootstrap` server domain
(`apps/server/src/domains/bootstrap/`):

- `POST /projects/bootstrap/preview { repoRef }` — returns
  `BootstrapPreviewDto { slug, defaultBranch, stack, audit, labelsToInstall }`.
  The preview endpoint is **read-only**: it runs stack detection +
  CLAUDE.md audit + reports the canonical label set, but does NOT mutate
  GitHub state, install labels, or open a PR.
- `POST /projects/bootstrap/run { repoRef, slug? }` — invokes the
  `bootstrapProject` workflow end-to-end. Returns `BootstrapRunDto` with
  the registration PR URL.

The split keeps the destructive `/run` step deliberate: the wizard's
"Open Registration PR" button is the only call site.

## Mocking the workflow

The Playwright e2e (`apps/web/e2e/bootstrap-wizard.spec.ts`) drives the
wizard through every step against a server booted with
`MOCK_BOOTSTRAP=true`. Both endpoints short-circuit to deterministic
fixtures — no GitHub calls, no real labels installed, no PR opened.

## State machine

`lib/wizard-state.ts` exports a pure 6-step state machine
(`WIZARD_STEPS`, `nextStep`, `prevStep`, `stepIndex`, `stepLabel`) plus
`isValidRepoRef(...)`. Tests in `slice.test.ts` cover every transition.

The wizard component holds `WizardState` in `useState`; resetting the
modal happens automatically on close (so re-opening the wizard always
starts at step 1).
