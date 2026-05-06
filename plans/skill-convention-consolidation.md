# Skill convention consolidation

**Owner:** human-directed (not a Factory issue — touches the governance perimeter via a tiny CLAUDE.md tweak and a new ADR).
**Branch:** `claude/review-project-docs-CohEx` (already open as PR #537 — add commits to it).
**Estimated touch:** ~30 file renames, 4 caller refactors, 1 loader change, 1 ADR, 3 test fixture updates, 2 doc tweaks. Single session.

---

## 1. Background (read this first)

Goose Hub today has **two parallel skill-loading conventions** and **two parallel loaders**. They are functionally split, not chronologically ordered — the "newer" pair is not an upgrade of the "legacy" one, just a parallel implementation that grew up alongside it.

| Aspect | Legacy (12 skills) | Newer (5 skills) |
|---|---|---|
| Prompt file | `skill.md` | `prompt.md` |
| Config file | `config.ts` | `skill.config.ts` |
| Loader | `core/agent-runtime/read-prompt.ts` (`readPromptWithContext()`) | Three+ ad-hoc `readFileSync(.../prompt.md)` loaders, plus dynamic CLI |
| Project-overlay support | **Yes** — appends `target-projects/<slug>/agent-context/<skillName>.md` if present | **No** |
| Config import | Static `import config from '...config.js'` | Dynamic `await import('...skill.config.js')` |

**Skills currently on legacy** (12): `advise-on-plan`, `evidence-post`, `implement`, `investigate`, `playwright-repro`, `qa`, `resolve-conflict`, `retrospective-deep`, `retrospective-light`, `review`, `spec-author`. (That's 11 — the 12th is the 5 vs 17 split below; let the pre-flight grep be the source of truth.)

**Skills currently on newer** (5): `bug-enhance`, `echo-test`, `echo-test-holdout`, `repo-match`, `triage`.

**Real overlays in use today** (legacy-only, confirmed): `target-projects/goose-hub-self/agent-context/{implement,evidence-post,investigate,qa,spec-author,playwright-repro,advise-on-plan}.md`.

## 2. Decision (already made — do not re-litigate)

**Take the legacy loader (it has the better feature — overlays). Take the newer file names (they read better).** Concretely:

1. Rename every skill's prompt to `prompt.md` and its config to `skill.config.ts`.
2. Update `read-prompt.ts` to read `prompt.md`.
3. Refactor the 4 ad-hoc loaders to call `readPromptWithContext()` so overlays work everywhere — a side effect of consolidation, not the headline.
4. Update every static `import` to use the new `skill.config.js` path.
5. Delete duplication; one loader, one convention.

This was reasoned through in the conversation that produced this plan; the trade-offs are summarised in the new ADR (§7 below).

## 3. Pre-flight verification (do this before touching anything)

Run from repo root. Confirm the numbers match this plan. If they don't, stop and re-scope.

```bash
# Skills on each convention (expect 12 legacy, 5 newer; total 17 skill dirs)
ls skills/ | grep -v -E '^(index\.ts|package\.json)$'
for d in skills/*/; do echo "$(basename $d): $(ls $d | grep -E '^(skill|prompt|config)' | tr '\n' ' ')"; done

# Every place that reads skill.md or prompt.md (expect ~5 production refs + ~5 test refs)
grep -rn "readFileSync.*skill\.md\|readFileSync.*prompt\.md\|'skill\.md'\|'prompt\.md'" \
  --include="*.ts" --include="*.tsx" .

# Every static config import (expect 2: advisor.ts, resolve-conflict/workflow.ts)
grep -rn "@goose-hub/skills/.*/config\.js\|@goose-hub/skills/.*/skill\.config\.js" \
  --include="*.ts" .

# Every ad-hoc loader (expect 4: triage-batch, inbox/enhance, cli/index, resolve-conflict/workflow)
grep -rn "readFileSync(join(skillsRoot\|readFileSync(join(REPO_ROOT, 'skills'" \
  --include="*.ts" .

# Overlay files in use today (expect 7 under goose-hub-self)
find target-projects -path "*agent-context/*.md"
```

Establish a green test baseline before any change:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

If anything is red on `main`/the current branch tip, fix the baseline first OR document which failures are pre-existing. **Do not start renames on a red tree** — you'll lose the ability to attribute regressions.

## 4. Step-by-step execution

Do these in order. Commit at each numbered checkpoint so a bad step is easy to revert.

### Step 4.1 — Rename the 12 legacy skills' files (one commit)

For each of the 12 legacy skills (the actual list comes from your pre-flight grep), use `git mv`:

```bash
for s in advise-on-plan evidence-post implement investigate playwright-repro qa \
         resolve-conflict retrospective-deep retrospective-light review spec-author; do
  git mv "skills/$s/skill.md" "skills/$s/prompt.md"
  git mv "skills/$s/config.ts" "skills/$s/skill.config.ts"
done
```

The 5 already-newer skills (`triage`, `repo-match`, `bug-enhance`, `echo-test`, `echo-test-holdout`) are untouched.

**Verify:** `for d in skills/*/; do echo "$(basename $d): $(ls $d | grep -E '^(skill|prompt|config)' | tr '\n' ' ')"; done` — every skill dir should show `prompt.md skill.config.ts schema.ts ...`.

Commit: `refactor(skills): rename 12 legacy skills' files to prompt.md + skill.config.ts`

### Step 4.2 — Update the canonical loader and its test (one commit)

**File: `core/agent-runtime/read-prompt.ts`**
- Line 9 (comment): `Looks for base prompt at: skills/<skillName>/skill.md` → `prompt.md`
- Line 19 (code): `'skill.md'` → `'prompt.md'`

**File: `core/agent-runtime/read-prompt.test.ts`**
- Line 11 (fixture write): change the `'skill.md'` literal to `'prompt.md'`
- Anything else that hardcodes `skill.md` in this file — update.

Run `pnpm test core/agent-runtime/read-prompt.test.ts` to confirm green.

Commit: `refactor(read-prompt): migrate canonical loader to prompt.md`

### Step 4.3 — Update static config imports (one commit)

**File: `core/agent-runtime/advisor.ts`** line 1:
```diff
- import advisorConfig from '@goose-hub/skills/advise-on-plan/config.js';
+ import advisorConfig from '@goose-hub/skills/advise-on-plan/skill.config.js';
```

**File: `slices/resolve-conflict/workflow.ts`** line 18:
```diff
- import config from '@goose-hub/skills/resolve-conflict/config.js';
+ import config from '@goose-hub/skills/resolve-conflict/skill.config.js';
```

Re-run the pre-flight grep for `@goose-hub/skills/.*/config\.js`. Should return zero hits.

Commit: `refactor(skills): update static config imports to skill.config.js`

### Step 4.4 — Fold the 4 ad-hoc loaders into `readPromptWithContext()` (one commit)

This is the consolidation step. Each ad-hoc reader gets replaced with a `readPromptWithContext(skillName, projectSlug)` call so overlays work for triage / repo-match / bug-enhance / resolve-conflict too.

**File: `apps/server/src/domains/workflows/triage-batch.ts`**
- Delete the local `readPrompt()` function (currently around lines 19–21).
- Replace `readPrompt('triage')` and `readPrompt('repo-match')` (around lines 91–92) with `readPromptWithContext('triage', projectSlug)` and `readPromptWithContext('repo-match', projectSlug)`. **The function must already have access to the project slug** — verify; if not, thread it through the call signature.
- Add `import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';`
- Drop the now-unused `readFileSync`, `join`, and `skillsRoot` imports if nothing else uses them.

**File: `apps/server/src/domains/inbox/enhance.ts`** (around line 14)
- Same treatment — replace the local `readFileSync(join(skillsRoot, 'bug-enhance', 'prompt.md'), 'utf8')` with `readPromptWithContext('bug-enhance', projectSlug)`. Project slug must be in scope; thread through if needed.

**File: `slices/resolve-conflict/workflow.ts`** (line 25)
- Replace the local read-helper with `readPromptWithContext('resolve-conflict', projectSlug)`.
- Update its test at `slices/resolve-conflict/slice.test.ts:278–282`: the mock currently filters on `skill.md`. Either filter on `prompt.md`, or — better — switch the test to mock `readPromptWithContext` directly (the cleaner change long-term).

**File: `apps/cli/src/index.ts`** (lines 265–273)
- The CLI is the one caller without a project slug (it's a dev tool). Either:
  - **Option A (recommended):** add a `--project=<slug>` CLI flag and pass it through to `readPromptWithContext()`. Default to `''` (no overlay) when omitted.
  - **Option B (minimum):** leave the CLI's direct `prompt.md` read in place and document it as the sole exception. Justification: dev tooling, not an orchestrator path.

Pick A unless it surfaces unexpected complexity. If A, also update line 269 (path string) and the import.

Verify ad-hoc loaders are gone:
```bash
grep -rn "readFileSync(join(skillsRoot\|readFileSync(join(REPO_ROOT, 'skills'" --include="*.ts" .
# Expected: zero (or one if you chose Option B for the CLI)
```

Commit: `refactor(skills): consolidate ad-hoc prompt loaders onto readPromptWithContext`

### Step 4.5 — Update test fixtures and assertion strings (one commit)

These are tests that include skill paths as **example data** (not file reads), so they don't break — but they should be brought into the new naming for consistency.

- `skills/retrospective-light/slice.test.ts:17` — `targetPath: 'skills/implement/skill.md'` → `'skills/implement/prompt.md'`
- `apps/server/src/domains/workflows/retro-batch.test.ts:127` — `'skills/qa/skill.md'` → `'skills/qa/prompt.md'`
- `skills/review/slice.test.ts` — multiple references to `skill.md` (lines ~250, 313, 396–399). Three categories:
  - Lines 250, 313: human-readable `suggestion`/`description` strings — update to the new file name.
  - Lines 396–399: `readFileSync(join(import.meta.dirname, 'skill.md'), ...)` — this reads review's **own** prompt; after step 4.1's rename, this must change to `'prompt.md'`.

Re-run `pnpm test`. Should be green.

Commit: `test: align test fixtures and review's own prompt-read with prompt.md naming`

### Step 4.6 — Doc updates (one commit)

**File: `docs/PLAN.md` §6 (around lines 210–217)** — the layout sketch shows `triage/config.ts` and `triage/skill.md`. Update to:
```
│   │   ├── skill.config.ts             # SkillConfig (toolBundles, modelPin, freshContext, role, contextSchema)
│   │   ├── prompt.md                   # versioned system prompt; ends with [decision] footer
│   │   ├── schema.ts                   # Zod output schema
```

**File: `CLAUDE.md`** — find the bullet under "Hard rules to remember" that currently reads:
> Skills are versioned. Every skill in `skills/<name>/` has three required files: a Markdown prompt, a Zod output schema (`schema.ts`), and a TypeScript config (role, context schema, budgets). Two file-name conventions currently coexist …

Replace the dual-convention paragraph with:
> Skills are versioned. Every skill in `skills/<name>/` has three required files: `prompt.md` (Markdown instructions), `schema.ts` (Zod output schema), and `skill.config.ts` (role, context schema, budgets). Inline prompts in code fail review.

**File: `CONTEXT.md`** — the "Prompt and Context Architecture" section already says `prompt.md`. Verify; no change expected. Add a one-line update under "Resolved Decisions" referencing the new ADR (§7 below).

**File: `README.md`** — if it lists ADR numbers under "Standards & ADRs", append the new ADR.

Commit: `docs: align PLAN/CLAUDE/CONTEXT with the consolidated prompt.md + skill.config.ts convention`

### Step 4.7 — Write the ADR (one commit)

Create `docs/adr/0022-skill-file-convention-consolidation.md`. Use the template in §7 below verbatim, fill in the date and any specifics.

Commit: `docs(adr): 0022 — consolidate on prompt.md + skill.config.ts + readPromptWithContext`

## 5. Verification

After every commit, but mandatory before push:

```bash
pnpm typecheck   # must be green
pnpm lint        # must be green
pnpm test        # must be green
```

Smoke test the orchestrator path manually if possible:
- Trigger one triage run via the CLI or a test issue, watch the event log for `agent.run-completed`.
- Trigger one investigate run and confirm the `agent-context/investigate.md` overlay still appends to the prompt (look at the rendered system prompt in the event payload, or add a temporary log line in `readPromptWithContext` that's removed before push).

If anything fails: do **not** push. Debug, fix, commit. Pushing red is worse than holding the change.

## 6. Push and PR update

```bash
git push origin claude/review-project-docs-CohEx
```

Add a comment to PR #537 (use `mcp__github__add_issue_comment` with the PR number) summarising the new commits:

> Follow-up: skill convention consolidation (steps 4.1–4.7 of `plans/skill-convention-consolidation.md`). All 17 skills now use `prompt.md` + `skill.config.ts`. The 4 ad-hoc prompt loaders fold into `readPromptWithContext()`, so per-project overlays under `target-projects/<slug>/agent-context/<skill>.md` now work for triage, repo-match, bug-enhance, and resolve-conflict (previously only the legacy-side skills had them). New ADR: `docs/adr/0022-skill-file-convention-consolidation.md`.

Do **not** open a separate PR. This work belongs on top of the governance refresh because both touch the same docs.

## 7. ADR template — `docs/adr/0022-skill-file-convention-consolidation.md`

```markdown
# ADR 0022 — Skill file convention consolidation

**Status:** Accepted
**Date:** <fill in>
**Milestone:** M11 (mid-milestone refactor; not gated by an issue)

## Context

Goose Hub had two parallel skill-loading conventions running in production:

| | Legacy (12 skills) | Newer (5 skills) |
|---|---|---|
| Prompt file | `skill.md` | `prompt.md` |
| Config file | `config.ts` | `skill.config.ts` |
| Loader | `core/agent-runtime/read-prompt.ts` (`readPromptWithContext`) | Three ad-hoc `readFileSync(.../prompt.md)` callers + dynamic CLI |
| Per-project overlay | Supported (`target-projects/<slug>/agent-context/<skill>.md`) | Not supported |

The split was functional, not chronological — the newer pair grew up alongside the legacy pair because three callers (`triage-batch.ts`, `inbox/enhance.ts`, the CLI) each re-implemented prompt reading instead of routing through the canonical loader. New skills inherited the file naming of their caller, not of any decided standard.

This produced three concrete problems:
1. Per-project overlays only worked for orchestrator-side skills. Triage, repo-match, bug-enhance had no overlay path even though the feature would be useful for them.
2. CLAUDE.md, PLAN.md §6, and CONTEXT.md disagreed about which convention is canonical.
3. Three ad-hoc `readFileSync` callers meant any future change to prompt loading (caching, project-context format, etc.) had four places to land instead of one.

## Decision

Standardise on **`prompt.md` + `skill.config.ts`** for file names and on **`readPromptWithContext()`** as the single loader.

Rationale: file-name choice is purely cosmetic, and the newer naming is more self-describing (`prompt.md` is unambiguous; `skill.config.ts` matches the `<thing>.config.ts` ecosystem convention). Loader choice is functional, and the legacy loader has the overlay capability we want to preserve and extend.

### Migration (executed in PR #537 follow-up commits)

1. Rename `skill.md` → `prompt.md` and `config.ts` → `skill.config.ts` for all 12 legacy skills.
2. Update `core/agent-runtime/read-prompt.ts` to read `prompt.md`.
3. Update the two static `import config from '@goose-hub/skills/<name>/config.js'` sites (`core/agent-runtime/advisor.ts`, `slices/resolve-conflict/workflow.ts`) to `skill.config.js`.
4. Replace the four ad-hoc readers (`apps/server/src/domains/workflows/triage-batch.ts`, `apps/server/src/domains/inbox/enhance.ts`, `slices/resolve-conflict/workflow.ts`, and the CLI) with calls to `readPromptWithContext(skillName, projectSlug)`. The CLI gains a `--project=<slug>` flag (defaults to no overlay) so it can drive the same loader.

### Consequences

**Positive:**
- Per-project overlays now work for every skill, not just orchestrator-side ones.
- One loader, one set of file names, one mental model.
- Adding a future capability to skill loading (e.g. cached prompts, signed prompts, or remote fetch) is a single-file change in `read-prompt.ts`.

**Trade-offs:**
- 24 file renames touch every legacy skill simultaneously. Cherry-picking around this commit is fiddly.
- The CLI gains a `--project` flag that didn't exist; documented in `apps/cli/README.md` as part of this change.

### Alternatives considered

- **Standardise on the legacy file names** (`skill.md` + `config.ts`). Rejected: the newer names are objectively more readable and only 5 skills would have to change, but the cost of the migration is dominated by the loader consolidation, not the renames. Doing both at once costs no extra and ends with the better names.
- **Keep both conventions, document them.** Rejected: that's where we already are. The code-level cost of two parallel loaders (overlay-feature gap, three-way drift surface) was the actual problem; documenting it doesn't fix it.
- **Add overlay support to the ad-hoc loaders instead of consolidating.** Rejected: that would leave four loaders implementing the overlay rule, three of which would inevitably drift from the canonical one in `read-prompt.ts`.

### Cross-references

- CLAUDE.md "Hard rules to remember" — single skill-files paragraph
- PLAN.md §6 — repo layout reflects new naming
- CONTEXT.md "Prompt and Context Architecture" — already documents `prompt.md`; this ADR is the resolution of the convention split it implicitly assumed
- ADR 0015 (target-projects workspace package) — overlay path resolution depends on `targetProjectsRoot`, unchanged by this ADR
```

## 8. Out-of-scope (do not do these)

- **Do not** introduce caching, signing, or remote fetch in `read-prompt.ts`. Those are future enhancements, separate ADRs.
- **Do not** change overlay file naming or directory layout. The `target-projects/<slug>/agent-context/<skillName>.md` path is unchanged. Renaming the skill prompt file does not affect the overlay file name (the overlay key is the skill name, not the file name).
- **Do not** rename schemas or any other skill files. Only the prompt and config files change names.
- **Do not** touch `MISSION.md` or `FACTORY_RULES.md`. CLAUDE.md gets a one-paragraph tightening; that's the only governance file change beyond what PR #537 already has.
- **Do not** open a new PR. This goes onto `claude/review-project-docs-CohEx` as additional commits.

## 9. If you get stuck

If the pre-flight numbers don't match (more skills than expected, an unexpected loader, an overlay file pointing somewhere weird): stop, write a comment on PR #537 describing what you found, do not improvise. The plan's premise is the file count above; if reality has moved, the human should re-decide.

If `pnpm test` is red after step 4.4 with errors that look like "project slug undefined" — that's the threading issue mentioned in step 4.4. The fix is in the caller (give it the slug), not in `readPromptWithContext`.

If a skill's overlay file does not exist (`readPromptWithContext` returns just the base prompt), that is **expected** — the loader is overlay-optional by design. Do not add an overlay to make a test pass.
