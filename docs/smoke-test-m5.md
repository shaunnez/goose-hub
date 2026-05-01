# M5 Smoke Test Runbook

Verifies the full M5 pipeline end-to-end: issue filed → webhook → triage → labels → comment → UI.

## Prerequisites

- Local stack running: `pnpm dev` (server on :3001, web on :5173)
- `GITHUB_TOKEN` and `GITHUB_WEBHOOK_SECRET` set in `.env`
- `ngrok` or similar tunnel exposing `:3001` to the internet, with the webhook registered at `https://github.com/shaunnez/goose-hub/settings/hooks`

## Manual steps

### 1. File a new issue

Go to https://github.com/shaunnez/goose-hub/issues and file a new issue with:
- Title: `[smoke] M5 test issue`
- Body: anything descriptive

Note the issue number `N`.

### 2. Verify webhook received (within 3s)

Check server logs for:
```
webhook: dispatched slug=goose-hub-self
```

### 3. Verify triage complete (within 60s)

```bash
pnpm tsx scripts/smoke-test-m5.ts <N>
```

The script polls GitHub and the local event store until all checks pass or it times out.

### 4. Verify override flow

Open `http://localhost:5173/projects/goose-hub-self/items/<N>`.
In the Triage section, select `shaunnez/goose-hub` from the dropdown and click "Set repo".
The repo should show with a blue "(confirmed)" label.

## Automated verifier

```bash
ISSUE_NUMBER=<N> pnpm tsx scripts/smoke-test-m5.ts
```

Exit 0 = all checks pass. Exit 1 = failure with description.
