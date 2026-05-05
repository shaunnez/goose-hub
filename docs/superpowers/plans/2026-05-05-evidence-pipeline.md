# Evidence Pipeline: SHA-pinned GitHub Comments with Inline Images

**Date:** 2026-05-05  
**Status:** Ready to implement  
**Scope:** `playwright-repro` (BEFORE) + `evidence-post` (AFTER) + UI

---

## Goal

When a bug is investigated and fixed, both the BEFORE (broken) and AFTER (fixed) states are captured as screenshots + GIF, pushed to a persistent `evidence/issue-<N>` branch, and posted as SHA-pinned GitHub comments with inline images. The Goose Hub UI renders the real images instead of local file paths.

---

## Architecture

```
investigate workflow
  └─ playwright-repro skill
       captures screenshots + GIF
       pushes → evidence/issue-<N> branch
       posts → GitHub comment (BEFORE)
       stores commentUrl in event payload

fix-issue workflow
  └─ evidence-post skill
       captures screenshots + GIF of fixed state
       pushes → evidence/issue-<N> branch (new commit)
       posts → GitHub comment (AFTER + references BEFORE)
       stores commentUrl in event payload
```

Branch strategy: dedicated `evidence/issue-<N>` branch per issue, never deleted. SHA-pinned URLs are immutable regardless of branch lifecycle. Never pushes to main.

GIF over WebM: GitHub embeds GIFs inline in issue comments; WebM only links. Convert via `ffmpeg` after Playwright run (~2s overhead).

---

## Changes

### 1. `core/tool-layer/bundles.ts`

Add to the `validate` bundle:

```ts
'Bash(ffmpeg*)',
'Bash(git checkout*)',
'Bash(gh issue comment*)',
```

---

### 2. `skills/playwright-repro/schema.ts`

- Add `githubUrl: z.string().url().optional()` to the screenshot item shape
- Rename `videoPath` → `gifPath`
- Add `commentUrl: z.string().url().optional()` at the top level

```ts
// screenshot item
z.object({
  path: z.string(),
  caption: z.string(),
  step: z.number(),
  githubUrl: z.string().url().optional(),  // ADD
})

// top-level fields
gifPath: z.string().nullable(),   // was videoPath
commentUrl: z.string().url().optional(),  // ADD
```

---

### 3. `skills/playwright-repro/config.ts`

Add `number` and `repo` to `PlaywrightReproContextSchema` and `contextAllowlist`:

```ts
workItem: z.object({
  title: z.string(),
  body: z.string(),
  reproSteps: z.string(),
  url: z.string().optional(),
  number: z.number(),    // ADD — for branch name + gh comment
  repo: z.string(),      // ADD — "owner/repo" e.g. "shaunnez/goose-hub"
}),

contextAllowlist: [
  ...existing,
  'workItem.number',
  'workItem.repo',
],
```

---

### 4. `slices/investigate/workflow.ts`

Pass `number` and `repo` into playwright-repro context:

```ts
workItem: {
  title: workItem.title,
  body: workItem.body,
  reproSteps: workItem.body,
  number: Number(workItem.externalId),  // ADD
  repo: workItem.repoRef,               // ADD — WorkItem.repoRef = "shaunnez/goose-hub"
},
```

Update `slices/investigate/slice.test.ts`: `makeWorkItem()` mock and context assertions to include `number` and `repo`.

---

### 5. `skills/playwright-repro/skill.md`

Extend the skill with steps 5–8 after the existing capture loop:

**Step 5: Convert WebM to GIF**

After the playwright run, find the `.webm` in `test-results/`. Convert:

```bash
ffmpeg -i <path-to-video.webm> \
  -vf "fps=8,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  /tmp/repro-<slug>/walkthrough.gif
```

If the WebM does not exist or ffmpeg fails, set `gifPath: null` and continue — do not abort.

**Step 6: Push to evidence branch**

From the worktree directory:

```bash
mkdir -p evidence/issue-<N>
# Write screenshots + GIF into evidence/issue-<N>/ using the Write tool
git checkout -b evidence/issue-<N>
git add evidence/issue-<N>/
git commit -m "evidence: before-state for issue #<N>"
git push origin evidence/issue-<N>
git rev-parse HEAD    # capture SHA
```

**Step 7: Build GitHub URLs**

For each screenshot `step-N.png`:
```
https://raw.githubusercontent.com/<repo>/<SHA>/evidence/issue-<N>/step-N.png
```

For GIF:
```
https://raw.githubusercontent.com/<repo>/<SHA>/evidence/issue-<N>/walkthrough.gif
```

These are the `githubUrl` values. URLs must use the commit SHA, never the branch name.

**Step 8: Post GitHub comment**

```bash
gh issue comment <N> --repo <repo> --body "## Before-state: #<N> <title>

![<caption-1>](https://raw.githubusercontent.com/<repo>/<SHA>/evidence/issue-<N>/step-1.png)
![<caption-2>](https://raw.githubusercontent.com/<repo>/<SHA>/evidence/issue-<N>/step-2.png)

![walkthrough](https://raw.githubusercontent.com/<repo>/<SHA>/evidence/issue-<N>/walkthrough.gif)

_Pinned to \`<SHA>\` · captured during investigation_"
```

Capture the returned comment URL for the `commentUrl` output field.

**Output additions:**
- Each screenshot: include `githubUrl`
- `gifPath`: worktree-relative path (`evidence/issue-<N>/walkthrough.gif`) or `null`
- `commentUrl`: URL returned by `gh issue comment`

---

### 6. `skills/evidence-post/schema.ts`

Rename `videoPath` → `gifPath` for consistency with playwright-repro.

---

### 7. `skills/evidence-post/config.ts`

Add `beforeCommentUrl` to context schema (optional — only present for `type:bug`):

```ts
workItem: z.object({
  number: z.number(),
  repo: z.string(),
  title: z.string(),
  beforeCommentUrl: z.string().url().optional(),  // ADD
}),
```

Add to `contextAllowlist`: `'workItem.beforeCommentUrl'`.

---

### 8. `skills/evidence-post/skill.md`

Add GIF conversion after Playwright run (same ffmpeg command as playwright-repro).

Add to the comment format: when `<beforeCommentUrl>` is present in context, include a BEFORE section:

```markdown
## Evidence for issue #<N>: <title>

### Before (investigation)
> See full capture: <beforeCommentUrl>

![Step 1 before](https://raw.githubusercontent.com/<repo>/<SHA>/evidence/issue-<N>/before-step-1.png)

### After (fix shipped — PR #<prNumber>)

![Step 1 after](https://raw.githubusercontent.com/<repo>/<SHA>/evidence/issue-<N>/step-1.png)

![walkthrough](https://raw.githubusercontent.com/<repo>/<SHA>/evidence/issue-<N>/walkthrough.gif)

_Pinned to `<SHA>` · PR #<prNumber>_
```

Note: evidence-post also pushes to `evidence/issue-<N>` branch (new commit on top of the BEFORE commit). File naming: prefix BEFORE screenshots `before-step-N.png` and AFTER `step-N.png` to avoid collisions.

Update output schema to use `gifPath` instead of `videoPath`.

---

### 9. `slices/fix-issue/workflow.ts`

Before calling evidence-post, look up the investigation event to get `beforeCommentUrl`:

```ts
import { eventStore } from '@goose-hub/core/event-stream/store.js';

// After implement skill runs, before evidence-post:
const investigationEvents = eventStore.replay({ workItemId: workItem.id });
const investigationComplete = investigationEvents
  .findLast((e) => e.kind === 'agent.investigation-complete');
const beforeCommentUrl =
  (investigationComplete?.payload as { playwrightRepro?: { commentUrl?: string } })
    ?.playwrightRepro?.commentUrl;

// Pass into evidence-post context:
context: {
  workItem: {
    number: Number(workItem.externalId),
    repo: workItem.repoRef,
    title: workItem.title,
    beforeCommentUrl,   // undefined if not a bug or investigation didn't run
  },
  ...rest
}
```

Update `slices/fix-issue/slice.test.ts` to cover the `beforeCommentUrl` lookup path.

---

### 10. UI: `apps/web/src/components/detail/components/PlaywrightCaptureSection.tsx`

**Screenshots:** prefer `githubUrl` over local path:

```tsx
<img
  src={shot.githubUrl ?? shot.path}
  alt={shot.caption}
  className="max-w-full rounded border border-line"
  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
/>
{shot.githubUrl == null && (
  <p className="text-[11px] text-fg-4">
    Saved to: <code className="font-mono">{shot.path}</code>
  </p>
)}
```

**Video → GIF:** replace `<video>` with `<img>`, rename field `videoPath` → `gifPath`:

```tsx
{repro.gifPath != null && (
  <div data-testid="playwright-capture-gif">
    <h3 ...>Walkthrough</h3>
    <img
      src={repro.gifPath}   // will be githubUrl once evidence branch is merged
      alt="bug walkthrough"
      className="max-w-full rounded border border-line"
    />
  </div>
)}
```

**Add GitHub link** when `commentUrl` is present:

```tsx
{repro.commentUrl != null && (
  <a href={repro.commentUrl} target="_blank" rel="noreferrer"
     className="text-[11px] text-blue-400 underline">
    View on GitHub →
  </a>
)}
```

Also update `apps/web/src/components/detail/components/PlaywrightCaptureSection.test.tsx` for the new fields.

---

## Test checklist

- `pnpm typecheck` passes
- `pnpm test` passes (all 105 test files)
- Manually trigger investigate on issue #446:
  - Branch `evidence/issue-446` appears on `shaunnez/goose-hub`
  - GitHub comment posted with inline screenshots + GIF
  - `playwright_capture` panel in UI shows real images + "View on GitHub" link
