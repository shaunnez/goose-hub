## Playwright command

```bash
pnpm --filter @goose-hub/web exec playwright test <web-package-relative-spec-path>
```

NOT `npx playwright test`. NOT `playwright test` directly.
Do not run Playwright through root `pnpm exec`; Playwright is installed in the
`@goose-hub/web` package.

## Repo

`shaunnez/goose-hub`

## Spec location

Playwright specs live at `apps/web/e2e/issue-<N>.spec.ts`.
If `<spec_path>` points elsewhere, use the `read` tool to verify it exists before running.
The context `<specPath>` and all terminal JSON fields remain repo-root paths,
for example `apps/web/e2e/issue-<N>.spec.ts`.

Only the workflow-owned Playwright invocation may convert that repo-root path to
the filtered web package's package-relative argument, for example
`e2e/issue-<N>.spec.ts`. Do not report package-relative paths back in JSON.

## Evidence directory

Create at repo root: `evidence/issue-<N>/`

```bash
mkdir -p evidence/issue-<N>
```
