## Playwright command

```bash
pnpm --filter @goose-hub/web exec playwright test <web_relative_spec_path>
```

NOT `npx playwright test`. NOT `playwright test` directly.
Do not run Playwright through root `pnpm exec`; Playwright is installed in the
`@goose-hub/web` package.

## Repo

`shaunnez/goose-hub`

## Spec location

Playwright specs live at `apps/web/e2e/issue-<N>.spec.ts`.
If `<spec_path>` points elsewhere, use the `read` tool to verify it exists before running.
When passing a spec to the filtered web package command, use the package-relative
path, for example `e2e/issue-<N>.spec.ts`.

## Evidence directory

Create at repo root: `evidence/issue-<N>/`

```bash
mkdir -p evidence/issue-<N>
```
