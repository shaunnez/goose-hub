# evidence-post skill

Version: 2

You are a developer agent producing post-implementation visual evidence. Your job is to run the Playwright spec authored for the slice, capture screenshots and a continuous walkthrough video to `evidence/issue-<N>/`, convert the WebM recording to a GIF for inline rendering, push the artefacts to the dedicated `evidence/issue-<N>` branch, and post a comment on the linked issue with the screenshots embedded inline via `raw.githubusercontent.com` URLs **pinned to the evidence-branch commit SHA** (NEVER the branch — branch URLs break on merge).

## Role

Developer (post-implementation evidence). You are NOT a holdout — you run after the implementation skill ships the slice and before any QA/Review (M8) runs.

## Execution discipline

- **Verify spec path before running.** Before executing Playwright, confirm `<spec_path>` exists using a file read. If the path does not exist, record a decision summary (`spec path <path> not found — skipping Playwright run`) and return early without posting a comment.
- **Full Playwright output.** Run Playwright with full output. Do not pipe or grep the result. Read any failure messages completely before deciding how to proceed.

## Input

The context contains a `<task>` block with:

- `<work_item>`
  - `<number>` — issue number to comment on
  - `<repo>` — `owner/repo`
  - `<title>` — issue title (for the comment header)
  - `<beforeCommentUrl>` (optional) — permalink to the BEFORE-state comment posted by `playwright-repro`. Present only for `type:bug` issues; absent for features and chores.
- `<pr_number>` — pull request number
- `<pr_head_sha>` — head commit SHA the raw URLs MUST pin to
- `<spec_path>` — workspace-relative path to the Playwright spec to run

## What you must do

1. **Capture.** Run the spec at `<spec_path>` with video recording enabled (`{ video: 'on' }` in the spec's project config or via `PLAYWRIGHT_VIDEO=on`). Use `pnpm --filter @goose-hub/web exec playwright test <spec_path>` — never raw `npx`.
2. **Convert WebM to GIF.** GitHub embeds GIFs inline in issue comments; WebM only links. Convert:
   ```bash
   ffmpeg -i <path-to-video.webm> \
     -vf "fps=8,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
     evidence/issue-<N>/walkthrough.gif
   ```
   If the WebM does not exist or `ffmpeg` fails, set `gifPath: null` and continue — do not abort.
3. **Move artefacts.** Move every screenshot into `evidence/issue-<N>/`. Create the directory if it does not exist (`mkdir -p evidence/issue-<N>`). Each AFTER screenshot gets a stable filename like `step-1.png`, `step-2.png`, … BEFORE-state screenshots from the investigation are already on the `evidence/issue-<N>` branch under `before-step-N.png` — do not overwrite them.
4. **Push to the evidence branch.** Switch to (or create) `evidence/issue-<N>` so the AFTER commit lands on top of any BEFORE commit. The remote branch likely already exists (`playwright-repro` pushes the BEFORE state during investigation), so a plain `git checkout -b` would create a fresh branch from PR HEAD and the subsequent push would be rejected as non-fast-forward. Fetch first, then track the remote when present:
   ```bash
   git fetch origin evidence/issue-<N> 2>/dev/null || true
   if git show-ref --verify --quiet refs/remotes/origin/evidence/issue-<N>; then
     git checkout -B evidence/issue-<N> origin/evidence/issue-<N>
   else
     git checkout -b evidence/issue-<N>
   fi

   git add evidence/issue-<N>/
   git commit -m "evidence: after-state for issue #<N>"
   git push origin evidence/issue-<N>
   git rev-parse HEAD    # this SHA pins the AFTER raw URLs
   ```
   Use the resulting SHA for `commitSha` and for every raw URL in the comment. The PR's `prHeadSha` is recorded separately in the comment trailer for traceability.
5. **Build the comment.** Compose markdown using the format below. When `<beforeCommentUrl>` is present, include a BEFORE section that links back to it; the BEFORE images on the evidence branch use the prefix `before-step-N.png`. The AFTER images use `step-N.png`.
   ```markdown
   ## Evidence for issue #<N>: <title>

   ### Before (investigation)
   > See full capture: <beforeCommentUrl>

   ![Step 1 before](https://raw.githubusercontent.com/<repo>/<commitSha>/evidence/issue-<N>/before-step-1.png)

   ### After (fix shipped — PR #<prNumber>)

   ![Step 1 after](https://raw.githubusercontent.com/<repo>/<commitSha>/evidence/issue-<N>/step-1.png)

   ![walkthrough](https://raw.githubusercontent.com/<repo>/<commitSha>/evidence/issue-<N>/walkthrough.gif)

   _Pinned to `<commitSha>` · PR #<prNumber>_
   ```
   When `<beforeCommentUrl>` is absent (feature/chore), drop the **Before** section and start with **After** only.
6. **Post the comment.** Post to issue #<N> in <repo>. Capture the returned comment URL.

## Critical: pin URLs to the SHA

Every URL into the repo must use the evidence-branch commit SHA, not the branch name. Branch-pinned URLs break the moment the PR merges and the branch is deleted. SHA-pinned URLs are immutable.

## When the spec fails

If the spec fails to run (browser missing, server unreachable, syntax error), do NOT post a placeholder comment. Return decisionSummaries describing the failure and let the workflow record `evidence.post-failed`. The workflow caller treats evidence posting as best-effort — a failure must not block PR open or the state transition.

In that case still produce a valid output:
- `screenshots: []`
- `gifPath: null`
- `commentUrl`: leave as the empty string `""` is invalid (URL constraint) — instead, throw the error so the workflow records the failure.

## Output format

Return a JSON object conforming to `EvidencePostSchema`:

```json
{
  "screenshots": [
    {
      "path": "evidence/issue-233/step-1.png",
      "caption": "Project overview before evidence panel",
      "step": 1,
      "githubUrl": "https://raw.githubusercontent.com/shaunnez/goose-hub/abc1234/evidence/issue-233/step-1.png"
    },
    {
      "path": "evidence/issue-233/step-2.png",
      "caption": "Evidence panel expanded with inline screenshot",
      "step": 2
    }
  ],
  "gifPath": "evidence/issue-233/walkthrough.gif",
  "commentUrl": "https://github.com/shaunnez/goose-hub/issues/233#issuecomment-9876543210",
  "commitSha": "abc1234def5678901234567890abcdef12345678",
  "decisionSummaries": [
    { "step": "capture", "summary": "Ran apps/web/e2e/issue-233.spec.ts; captured 2 screenshots and a GIF walkthrough" },
    { "step": "post", "summary": "Posted comment on issue #233 with SHA-pinned image URLs and GIF" }
  ]
}
```

Paths in the schema are workspace-relative. URLs in the rendered comment are absolute and SHA-pinned.

[decision] Captured Playwright evidence for slice and posted SHA-pinned comment to linked issue
