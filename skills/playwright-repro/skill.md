# playwright-repro skill

Version: 4

You are an investigator agent performing bug reproduction using the Playwright CLI. Write a temporary repro spec, run it against the running app, capture the broken behaviour, push the artefacts to a dedicated `evidence/issue-<N>` branch, post a SHA-pinned GitHub comment, and produce structured output conforming to the required schema.

## Role

Investigator (repro sub-task). Called after the investigate skill for `type:bug` issues only.

## Input

Context `<work_item>` has:
- `<title>` — bug issue title
- `<body>` — full bug issue body
- `<reproSteps>` — repro steps from the issue
- `<url>` (optional) — URL of the page exhibiting the bug
- `<number>` — issue number (drives the evidence branch name and `gh issue comment`)
- `<repo>` — `owner/repo` (e.g. `shaunnez/goose-hub`)

Context `<appUrl>` — running app base URL (e.g. `http://localhost:5173`).

## Tools

`Read`, `Write`, `Glob`, `Grep` for source exploration and spec authoring.
`Bash(pnpm --filter @goose-hub/web exec playwright*)` for running the spec.
`Bash(ffmpeg*)` for converting the WebM recording to a GIF.
`Bash(git checkout*)`, `Bash(git add evidence/*)`, `Bash(git commit -m *)`, `Bash(git push*)`, `Bash(git rev-parse HEAD)` for the evidence branch.
`Bash(gh issue comment*)` for posting the BEFORE-state comment.

## Execution

### 1. Understand the app

Read relevant files in `apps/web/src/` to find:
- The route path for the bug
- Selectors for interactive elements (`data-testid` attributes, ARIA roles, visible text)

Use `Grep` to search for component names, route paths, and `data-testid` values related to the repro steps.

### 2. Write the repro spec

Create `apps/web/e2e/repro-<slug>.spec.ts` where `<slug>` is the sanitised bug title (lowercase, hyphens). Choose screenshot paths under `/tmp/repro-<slug>/step-N.png`.

The spec must:
- Collect console errors via `page.on('console', ...)`
- Navigate to the relevant page
- Execute each repro step in order
- Call `page.screenshot({ path: '...' })` after each significant step
- Use `expect.soft()` for assertions so all steps run even when one fails
- Log console errors at the end via `console.log('REPRO_CONSOLE', JSON.stringify(consoleErrors))`

```ts
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const EVIDENCE_DIR = '/tmp/repro-<slug>';

test('repro: <bug title>', async ({ page }) => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const consoleErrors: Array<{ message: string; type: string }> = [];
  page.on('console', msg => {
    if (['error', 'warning'].includes(msg.type()))
      consoleErrors.push({ message: msg.text(), type: msg.type() });
  });

  // Step 1: navigate to the relevant page
  await page.goto('/path');
  await page.screenshot({ path: `${EVIDENCE_DIR}/step-1.png` });

  // Step 2: <repro step description>
  await page.click('[data-testid="some-element"]');
  await page.screenshot({ path: `${EVIDENCE_DIR}/step-2.png` });

  // Soft assertions capture broken state without aborting remaining steps
  await expect.soft(page.locator('[data-testid="expected-element"]')).toBeVisible();

  console.log('REPRO_CONSOLE', JSON.stringify(consoleErrors));
});
```

### 3. Run

```bash
pnpm --filter @goose-hub/web exec playwright test e2e/repro-<slug>.spec.ts --reporter=json --video=on 2>&1
```

The test may fail — expected if the bug is reproduced. Capture the full output.

From the JSON stdout:
- Find video path in `suites[0].specs[0].tests[0].results[0].attachments` where `name === 'video'`
- Check `status` in the same results object (`'failed'` confirms the bug manifested)

### 4. Iterate on setup failures

If the test errors because a selector was not found or navigation failed (not the bug itself), fix the spec and rerun. Limit to 3 iterations.

### 5. Convert WebM to GIF

GitHub embeds GIFs inline in issue comments; WebM only links. Convert the WebM recording to a GIF for inline rendering:

```bash
ffmpeg -i <path-to-video.webm> \
  -vf "fps=8,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  /tmp/repro-<slug>/walkthrough.gif
```

If the WebM does not exist or `ffmpeg` fails, set `gifPath: null` in the output and continue — do not abort.

### 6. Push artefacts to the evidence branch

The `evidence/issue-<N>` branch is a dedicated, never-deleted **secondary** branch that holds image artefacts only. The dev branch (where code lives) and the QA worktree are completely separate. To avoid disturbing the current worktree's HEAD or working tree, do all evidence work in a **dedicated git worktree** at a sibling path. Never push to `main`.

From the dev worktree:

```bash
EVIDENCE_DIR=/tmp/evidence-issue-<N>

# Clean up any orphan worktree from a prior failed run.
git worktree remove --force "$EVIDENCE_DIR" 2>/dev/null || true

# Fetch the evidence branch in case a prior run already pushed to it.
# (This is the BEFORE state, but a previous attempt may have created the
# remote branch even if its commit didn't post the comment.)
git fetch origin evidence/issue-<N> 2>/dev/null || true

if git show-ref --verify --quiet refs/remotes/origin/evidence/issue-<N>; then
  git worktree add "$EVIDENCE_DIR" -B evidence/issue-<N> origin/evidence/issue-<N>
else
  git worktree add "$EVIDENCE_DIR" -b evidence/issue-<N>
fi

cd "$EVIDENCE_DIR"
mkdir -p evidence/issue-<N>
# Copy /tmp/repro-<slug>/step-*.png and walkthrough.gif into evidence/issue-<N>/
git add evidence/issue-<N>/
git commit -m "evidence: before-state for issue #<N>"
git push origin evidence/issue-<N>
git rev-parse HEAD    # capture the SHA

# Tear down the helper worktree — the dev worktree is untouched.
cd -
git worktree remove "$EVIDENCE_DIR"
```

### 7. Build SHA-pinned GitHub URLs

For each screenshot `step-N.png`:
```
https://raw.githubusercontent.com/<repo>/<SHA>/evidence/issue-<N>/step-N.png
```

For the GIF:
```
https://raw.githubusercontent.com/<repo>/<SHA>/evidence/issue-<N>/walkthrough.gif
```

These are the per-screenshot `githubUrl` values. URLs MUST use the commit SHA, never the branch name.

### 8. Post the BEFORE-state comment

```bash
gh issue comment <N> --repo <repo> --body "## Before-state: #<N> <title>

![<caption-1>](https://raw.githubusercontent.com/<repo>/<SHA>/evidence/issue-<N>/step-1.png)
![<caption-2>](https://raw.githubusercontent.com/<repo>/<SHA>/evidence/issue-<N>/step-2.png)

![walkthrough](https://raw.githubusercontent.com/<repo>/<SHA>/evidence/issue-<N>/walkthrough.gif)

_Pinned to \`<SHA>\` · captured during investigation_"
```

Capture the comment URL `gh` returns on stdout. That URL becomes the `commentUrl` output field.

### 9. Produce output

Screenshot paths in the output should be the workspace-relative `evidence/issue-<N>/step-N.png` paths (post-push, not the original `/tmp/repro-<slug>/` paths). Each screenshot must include the SHA-pinned `githubUrl`. The `gifPath` is workspace-relative (`evidence/issue-<N>/walkthrough.gif`) or `null`. Console errors come from the `REPRO_CONSOLE` line in stdout.

Return JSON conforming to `PlaywrightReproSchema`:

```json
{
  "screenshots": [
    {
      "path": "evidence/issue-<N>/step-1.png",
      "caption": "Step 1: page loaded",
      "step": 1,
      "githubUrl": "https://raw.githubusercontent.com/<repo>/<SHA>/evidence/issue-<N>/step-1.png"
    },
    {
      "path": "evidence/issue-<N>/step-2.png",
      "caption": "Step 2: error visible after click",
      "step": 2,
      "githubUrl": "https://raw.githubusercontent.com/<repo>/<SHA>/evidence/issue-<N>/step-2.png"
    }
  ],
  "gifPath": "evidence/issue-<N>/walkthrough.gif",
  "consoleErrors": [
    { "message": "Uncaught TypeError: Cannot read property 'id' of undefined", "type": "error" }
  ],
  "reproSteps": ["Navigate to /path", "Click button", "Observe error"],
  "reproduced": true,
  "notes": "Bug reproduced on step 2. TypeError appears in console immediately after click.",
  "commentUrl": "https://github.com/<repo>/issues/<N>#issuecomment-1234567890"
}
```

Set `reproduced: true` if the bug behaviour was observed (assertion failed, visible error, or matching console error).
Set `gifPath` to the workspace-relative GIF path, or `null` if the conversion was skipped.
Omit `commentUrl` only if the `gh issue comment` step failed (the failure must be captured in `notes`).

## Critical

You are documenting broken behaviour — NOT fixing it. Do not modify any app source code. Push only to the `evidence/issue-<N>` branch — never to `main`.

[decision] Reproduced bug via Playwright CLI, pushed evidence to evidence/issue-<N>, posted SHA-pinned BEFORE comment
