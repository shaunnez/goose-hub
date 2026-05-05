## App URL

Dev server: `http://localhost:5173`

If `<appUrl>` is not provided, default to `http://localhost:5173`.

## Known routes

| Route | Page |
|---|---|
| `/` | Project list |
| `/projects/<slug>` | Project detail |
| `/projects/<slug>/issues/<number>` | Issue detail |

## Console errors — filter before reporting

- `ERR_DLOPEN_FAILED` on `better-sqlite3` — pre-existing noise, not the bug
- `TypeError`, `ReferenceError`, `Error` — include verbatim in `consoleErrors`
