## Playwright command

```bash
pnpm --filter=@goose-hub/web exec playwright test <spec_path>
```

NOT `npx playwright test`. NOT `playwright test` directly.

## Repo

`shaunnez/goose-hub`

## Spec location

Playwright specs live at `apps/web/e2e/issue-<N>.spec.ts`.
If `<spec_path>` points elsewhere, use the `read` tool to verify it exists before running.

## Evidence directory

Create at repo root: `evidence/issue-<N>/`

```bash
mkdir -p evidence/issue-<N>
```
