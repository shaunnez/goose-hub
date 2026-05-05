## Playwright config

Read `apps/web/playwright.config.ts` before writing any spec. It defines:
- `webServer` auto-start (do NOT manually start the dev server in the spec)
- Base URL: `http://localhost:5173`

## Known routes

| Route | Page |
|---|---|
| `/` | Project list |
| `/projects/<slug>` | Project overview |
| `/projects/<slug>/issues` | Issue board |
| `/projects/<slug>/issues/<number>` | Issue detail |

## Spec filename

`apps/web/e2e/issue-<number>.spec.ts`
No spaces. No non-ASCII. No slashes in the filename portion.
