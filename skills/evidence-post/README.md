# skills/evidence-post

Runs the slice's Playwright spec on the PR commit, captures screenshots and a continuous WebM walkthrough to `evidence/issue-<N>/`, commits those artefacts to the PR branch, and posts a comment on the linked issue with the screenshots embedded inline via `raw.githubusercontent.com` URLs **pinned to the PR head commit SHA**.

The capture pattern was proven by the smoke test on issue #217. This is its productionisation as a Factory skill.

## Why this is a Factory skill, not a CI workflow

Per ADR 0011 §4 and FACTORY_RULES rule 26: posting evidence is a product workflow, not a CI concern. Wrapping it in a skill keeps it in the runtime layer with a tool allowlist, schema-validated output, and decision-summary discipline — the same shape as `skills/playwright-repro/`.

## When this skill runs

- M7 supervised dev workflow, after the implementation skill ships the slice and the PR is open
- Before any QA/Review (M8) so the posted comment is canonical project state on GitHub by the time a holdout reads the issue
- Best-effort: a failure here must not block PR open or the state transition. The wiring is the responsibility of `core/orchestrator/workflows/fix-issue.ts` (separate issue, deferred until #183 lands).

## Inputs

`EvidencePostContextSchema`:

| Field | Type | Description |
|---|---|---|
| `workItem.number` | `number` | Issue number to comment on |
| `workItem.repo` | `string` | `owner/repo`, e.g. `shaunnez/goose-hub` |
| `workItem.title` | `string` | Issue title (used in the comment header) |
| `workItem.beforeCommentUrl` | `string` (optional URL) | Permalink to the BEFORE-state comment from `playwright-repro` (`type:bug` only) |
| `prNumber` | `number` | Pull request number |
| `prHeadSha` | `string` (≥ 7 chars) | Head commit SHA — every raw URL pins to this SHA |
| `specPath` | `string` | Repo-root/worktree-root relative path to the Playwright spec to run |

## Outputs

`EvidencePostSchema`:

| Field | Type | Description |
|---|---|---|
| `screenshots` | `Screenshot[]` | Repo-root/worktree-root relative paths under `evidence/issue-<N>/` |
| `screenshots[].path` | `string` | e.g. `evidence/issue-233/step-1.png` |
| `screenshots[].caption` | `string` | What the screenshot shows |
| `screenshots[].step` | `number` (integer) | Ordinal step in the walkthrough |
| `screenshots[].githubUrl` | `string` (optional URL) | SHA-pinned `raw.githubusercontent.com` URL once pushed |
| `gifPath` | `string \| null` | Repo-root/worktree-root relative GIF path, or `null` |
| `commentUrl` | `string` (URL) | Permalink to the posted comment |
| `commitSha` | `string` (≥ 7 chars) | SHA the raw URLs pin to |
| `decisionSummaries` | `DecisionSummary[]` | Canonical decision-summary record |

## Tool allowlist

`validate` bundle: Factory read/search/file tools plus evidence helpers for Playwright invocation, evidence I/O, commit, and push. The skill does not include unrestricted shell access.

## Comparison strategy (v1)

After-only. For `type:bug` issues, the BEFORE state already exists from `skills/playwright-repro/` (M6) — the comment can reference those artefacts when present. For `type:feature` and `type:chore`, the after-capture stands on its own.

Worktree-based dual-run (BEFORE on `main`, AFTER on PR) is out of scope. File a separate enhancement when after-only proves limiting.

## SHA pinning

Every URL into the repo MUST pin to the evidence-branch commit SHA, never the branch name. Branch URLs break the moment the branch is deleted (or moves). SHA URLs are immutable.

```md
![<caption>](https://raw.githubusercontent.com/<repo>/<sha>/evidence/issue-<N>/step-1.png)
![walkthrough](https://raw.githubusercontent.com/<repo>/<sha>/evidence/issue-<N>/walkthrough.gif)
```

## Operational gotchas (from #217 smoke test)

- Pin the `playwright-core` version + the browser bundle as a unit. The browser ABI must match `playwright-core`.
- Default to `localhost:5173` or `page.setContent()` with inline HTML — external URLs may be sandboxed off in some run environments.
- Set `{ video: 'on' }` in the spec config so video records continuously across screenshot points.

## Context allowlist

| Key | Included |
|---|---|
| `workItem.number` | yes |
| `workItem.repo` | yes |
| `workItem.title` | yes |
| `workItem.beforeCommentUrl` | yes |
| `prNumber` | yes |
| `prHeadSha` | yes |
| `specPath` | yes |
