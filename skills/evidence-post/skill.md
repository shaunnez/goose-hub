# evidence-post skill

Version: 1

You are a developer agent producing post-implementation visual evidence. Your job is to run the Playwright spec authored for the slice, capture screenshots and a continuous walkthrough video to `evidence/issue-<N>/`, commit those artefacts to the PR branch, and post a comment on the linked issue with the screenshots embedded inline via `raw.githubusercontent.com` URLs **pinned to the PR head commit SHA** (NEVER the branch — branch URLs break on merge).

## Role

Developer (post-implementation evidence). You are NOT a holdout — you run after the implementation skill ships the slice and before any QA/Review (M8) runs.

## Input

The context contains a `<task>` block with:

- `<work_item>`
  - `<number>` — issue number to comment on
  - `<repo>` — `owner/repo`
  - `<title>` — issue title (for the comment header)
- `<pr_number>` — pull request number
- `<pr_head_sha>` — head commit SHA the raw URLs MUST pin to
- `<spec_path>` — workspace-relative path to the Playwright spec to run

## What you must do

1. **Capture.** Run the spec at `<spec_path>` with video recording enabled (`{ video: 'on' }` in the spec's project config or via `PLAYWRIGHT_VIDEO=on`). Use `pnpm --filter @goose-hub/web exec playwright test <spec_path>` — never raw `npx`.
2. **Move artefacts.** Move every screenshot and the WebM video into `evidence/issue-<N>/`. Create the directory if it does not exist (`mkdir -p evidence/issue-<N>`). Each screenshot gets a stable filename like `step-1.png`, `step-2.png`, …
3. **Commit and push.** `git add evidence/issue-<N>/`, commit with message `evidence: capture for issue #<N>` (single line, no body), push to the PR branch.
4. **Build the comment.** Compose markdown with:
   - A header line: `## Evidence for issue #<N>: <title>`
   - One inline image per screenshot: `![<caption>](https://raw.githubusercontent.com/<repo>/<commitSha>/evidence/issue-<N>/<filename>.png)`
   - A video link (NOT embedded — GitHub renders WebM inline only on the file blob page): `[walkthrough.webm](https://github.com/<repo>/blob/<commitSha>/evidence/issue-<N>/walkthrough.webm)` if a video was captured
   - A trailer line: `Pinned to <commitSha> · PR #<prNumber>`
5. **Post the comment.** Post to issue #<N> in <repo>. Capture the returned comment URL.

## Critical: pin URLs to the SHA

Every URL into the repo must use `<pr_head_sha>`, not the branch name. Branch-pinned URLs break the moment the PR merges and the branch is deleted. SHA-pinned URLs are immutable.

## When the spec fails

If the spec fails to run (browser missing, server unreachable, syntax error), do NOT post a placeholder comment. Return decisionSummaries describing the failure and let the workflow record `evidence.post-failed`. The workflow caller treats evidence posting as best-effort — a failure must not block PR open or the state transition.

In that case still produce a valid output:
- `screenshots: []`
- `videoPath: null`
- `commentUrl`: leave as the empty string `""` is invalid (URL constraint) — instead, throw the error so the workflow records the failure.

## Output format

Return a JSON object conforming to `EvidencePostSchema`:

```json
{
  "screenshots": [
    { "path": "evidence/issue-233/step-1.png", "caption": "Project overview before evidence panel", "step": 1 },
    { "path": "evidence/issue-233/step-2.png", "caption": "Evidence panel expanded with inline screenshot", "step": 2 }
  ],
  "videoPath": "evidence/issue-233/walkthrough.webm",
  "commentUrl": "https://github.com/shaunnez/goose-hub/issues/233#issuecomment-9876543210",
  "commitSha": "abc1234def5678901234567890abcdef12345678",
  "decisionSummaries": [
    { "step": "capture", "summary": "Ran apps/web/e2e/issue-233.spec.ts; captured 2 screenshots and a 12 s WebM walkthrough" },
    { "step": "post", "summary": "Posted comment on issue #233 with SHA-pinned image URLs and video link" }
  ]
}
```

Paths in the schema are workspace-relative. URLs in the rendered comment are absolute and SHA-pinned.

[decision] Captured Playwright evidence for slice and posted SHA-pinned comment to linked issue
