# Failure-Modes Atlas — legacy bug workflow

Spots most likely to break when the bug workflow runs end-to-end against a real target repo. Compiled by reading `slices/investigate/`, `slices/fix-issue/`, `slices/qa/`, `slices/review/`, `core/workspaces/worktree.ts`, and the dispatch routing.

Use the pre-flight checklist at the bottom before running a dogfood seed.

> **Caveat:** specific line numbers drift as the code evolves. Treat them as anchors, not authority. When in doubt, grep the symbol named in *Where:*.

---

### 1. Worktree creation permission failure

- **Where:** `createWorktree()` in `core/workspaces/worktree.ts`
- **What can break:** `mkdir ~/.factory/workspaces/<runId>/` throws `EACCES` (permission denied) or `ENOSPC` (disk full); `git worktree add --detach` fails on filesystem error
- **Observable symptom:** Workflow halts immediately; no scout/agent events emitted
- **Detection in event stream:** `agent.run-failed` with "mkdir" / "worktree add" / "EACCES" / "ENOSPC" in the error message
- **Pre-flight:** verify `~/.factory/workspaces/` is writable and free space > 1 GB

### 2. Stale worktrees accumulate across retries

- **Where:** `finally` cleanup blocks in `slices/investigate/workflow.ts` and `slices/fix-issue/workflow.ts`
- **What can break:** Early-return paths on escalation can skip cleanup; over time `~/.factory/workspaces/` grows unbounded, future creates collide
- **Observable symptom:** Cascade of "worktree already exists" errors; orphan directories under `~/.factory/workspaces/`
- **Detection in event stream:** `agent.run-failed` with "already exists" + no preceding `cleanupWorktree` for the runId
- **Pre-flight:** `find ~/.factory/workspaces -maxdepth 1 -type d -mtime +0.5 | wc -l` should be 0. If not: `pnpm cleanup-worktrees`

### 3. Vitest JSON parser fails on malformed test output

- **Where:** `buildVerificationSummary()` in `slices/qa/verification-summary.ts` consumes a Vitest JSON reporter run
- **What can break:** Test runner crashes mid-output; JSON.parse fails; `testRun` is `null`; QA continues without ground-truth pass/fail counts
- **Observable symptom:** QA verdict made without test data; PR can pass QA while real tests fail
- **Detection in event stream:** `qa.verification-summary-built` with `testStatus: 'failed'` *and* missing structured `testRun`
- **Pre-flight:** run the target's test command yourself with `--reporter=json`, pipe through `jq .` to confirm well-formed JSON

### 4. Skill prompt file missing or contextAllowlist mismatch

- **Where:** `readPromptWithContext(skillName, projectSlug)` in `core/agent-runtime/read-prompt.ts`; `contextAllowlist` on each `SkillConfig`
- **What can break:** Per-project overlay missing, or context keys passed to `invokeSkill` not declared in the skill's `contextAllowlist` → PreToolUse hook denies tools, agent stalls
- **Observable symptom:** Agent hangs or fails before completing any tool call
- **Detection in event stream:** `tool.violation` events naming the disallowed key; `agent.run-failed` with "timeout" after zero useful tool calls
- **Pre-flight:** for each skill the workflow will run, grep `contextAllowlist` and reconcile against the keys the workflow actually passes

### 5. Zod schema validation fails on agent output

- **Where:** `outputSchema.safeParse()` inside `invokeSkill()` for QA, Review, Investigate, Implement
- **What can break:** Agent returns malformed JSON (enum mismatch, missing required `decisionSummaries`, extra fields); `safeParse` fails; workflow throws → `factory:needs-human`
- **Observable symptom:** `agent.run-failed` with a Zod issues array in the error message
- **Detection in event stream:** `agent.run-failed` carrying `error: '...invalid_enum_value...'` or similar
- **Pre-flight:** review the skill's `schema.ts` and confirm the prompt's example output matches every required field exactly; M19+ implement has `runWithEscalation` retry — confirm it's enabled if you rely on it

### 6. PR push fails (SSH, branch protection, or missing perms)

- **Where:** `slices/fix-issue/workflow.ts` after implement; `core/connectors/github/` (PR open)
- **What can break:** Missing SSH key in `~/.ssh/`, push protection requiring CODEOWNERS, missing token perms on the target repo
- **Observable symptom:** Workflow hangs in fix-issue; "Permission denied (publickey)" or "protected branch" errors
- **Detection in event stream:** `agent.run-failed` mentioning "ssh" / "publickey" / "protected"
- **Pre-flight:** `ssh -T git@github.com` returns the expected `Hi <user>!`; verify the target repo's branch-protection rules permit your bot/account to push and open PRs

### 7. Test command missing or `pnpm install` skipped

- **Where:** `prewarmWorktree()` in `core/workspaces/worktree.ts`; `projectConfig.stack.testCommand`
- **What can break:** If prewarm is skipped or `pnpm install` fails silently, `node_modules` is empty; test command exits non-zero with "module not found" or "command not found"
- **Observable symptom:** QA's `testStatus: 'failed'` but `testRun: null`; logs show resolution errors
- **Detection in event stream:** `qa.verification-summary-built` with `testStatus: 'failed'` and no `testRun`; preceding `agent.log` errors from install
- **Pre-flight:** in the target repo, run `pnpm install --frozen-lockfile && pnpm test` once locally and confirm it succeeds; verify `projectConfig.stack.testCommand` matches the actual script

### 8. Playwright browsers not installed / e2e port collision

- **Where:** `slices/investigate/workflow.ts` (playwright-repro section); the QA e2e command
- **What can break:** Chromium not installed → spawn fails; web/api dev servers bound to ports already in use → `EADDRINUSE`
- **Observable symptom:** "no Chrome found" or "EADDRINUSE" in the spawn error; investigation completes without a playwright repro artifact
- **Detection in event stream:** `evidence.playwright-repro-skipped` with a reason other than "high-confidence-static-ui-bug"; `agent.run-failed` with skill `playwright-repro`
- **Pre-flight:** `pnpm --filter @goose-hub/web exec playwright install chromium --with-deps`; check that the ports the project uses are free (`lsof -i :<port>`)

### 9. Label state-source dispatch doesn't fire

- **Where:** `dispatchForLabel()` in `apps/server/src/shared/dispatch-routing.ts`
- **What can break:** GitHub webhook misconfigured/disabled, server not running, or label changed but webhook delivery rejected — workflow never starts
- **Observable symptom:** Issue label is set but no event stream activity for >5 minutes
- **Detection in event stream:** Gap with no new events after a state transition; check GitHub *Settings → Webhooks → Recent deliveries* for failed pushes
- **Pre-flight:** confirm the server is reachable from GitHub (or that you'll trigger dispatch manually via CLI); send a test webhook from the GitHub UI and watch server logs

### 10. Symbol index stale or missing (degrades silently)

- **Where:** `ensureSymbolIndexFresh()` in `slices/investigate/workflow.ts`
- **What can break:** Index DB stale/missing → freshness check warns but continues; Wave-1 scouts get empty hints; findings less focused
- **Observable symptom:** Investigation still completes but takes longer and produces broad findings; QA confidence lower
- **Detection in event stream:** `agent.log` warn `"symbol-index: freshness check failed"`; `symbol-index.lookup` event with empty `consumerHintCounts`
- **Pre-flight:** `pnpm symbol-index` to (re)build; verify mtime < 12 h

### 11. PR diff fetch returns empty string

- **Where:** `getPrDiff()` in `slices/qa/qa-helpers.ts` (also used in review)
- **What can break:** PR number not recorded in event stream, or PR deleted between fix-issue and QA → diff empty → QA can't verify code
- **Observable symptom:** QA verdict made on no-diff basis; vague findings; possible "fail" with reason "no diff to assess"
- **Detection in event stream:** `qa.verification-summary-built` with `diffCharCount: 0`; `agent.decision-summary` mentioning unable to fetch diff
- **Pre-flight:** after fix-issue completes, confirm `pr.opened` event exists in the work item's stream and the PR URL resolves

### 12. Advisor 'revise' re-spawn exhausts turn budget

- **Where:** Advisor revise branch in `slices/fix-issue/workflow.ts`; turn budget from `SKILL_BUDGETS` in `core/agent-runtime/budgets.ts`
- **What can break:** First implement uses most of its turn budget exploring; re-spawn on `verdict: 'revise'` starts fresh on the same budget; runs out of turns; falls into needs-human
- **Observable symptom:** Two sequential `agent.run-started` for `implement`; second hits maxTurns; transition to needs-human with "budget exhausted"
- **Detection in event stream:** Pair of `agent.run-started skill=implement` followed by `agent.run-failed` and `state.transitioned → factory:needs-human`
- **Pre-flight:** for high/critical priority items, confirm `SKILL_BUDGETS.implement.maxTurns` is generous enough (≥40) or that escalation policy is enabled

### 13. Worktree deleted between fix-issue and QA

- **Where:** Implicit dependency — QA reads files from the dev's worktree
- **What can break:** Manual cleanup or a parallel reconcile job deletes the worktree after PR open but before QA starts; QA's `workspaceDir` is null; test capture disabled; QA passes on code-review-only
- **Observable symptom:** QA verdict made without running tests; `verificationSummary.testStatus: 'skipped'` with reason "no workspace"
- **Detection in event stream:** Large time gap between `agent.implement-complete` and `qa.completed`; `qa.verification-summary-built` with `testStatus: 'skipped'` and a "no workspace" reason
- **Pre-flight:** don't run `pnpm cleanup-worktrees` while a workflow is mid-flight; verify no cron is reaping worktrees with open PRs

---

## Pre-flight checklist

Before running a dogfood seed end-to-end, walk through these. Most are one-liners.

```bash
# 1. Disk + worktree dir
df -h ~/.factory/ | awk 'NR==2 {gsub("%","",$5); exit ($5 > 80)}'  || echo "WARN: >80% used"
test -w ~/.factory/workspaces || mkdir -p ~/.factory/workspaces

# 2. Stale worktrees
find ~/.factory/workspaces -maxdepth 1 -type d -mtime +0.5 2>/dev/null | head -5

# 3. SSH push works
ssh -T git@github.com 2>&1 | head -1

# 4. GitHub webhook recent deliveries green (manual: repo → Settings → Webhooks)

# 5. Target repo build/test works standalone
( cd <target-repo> && pnpm install --frozen-lockfile && pnpm test --reporter=json > /tmp/dogfood-test.json )
jq '.success' /tmp/dogfood-test.json   # expect true

# 6. Playwright browsers
pnpm --filter @goose-hub/web exec playwright install chromium --with-deps

# 7. Symbol index fresh
pnpm symbol-index   # rebuilds if stale

# 8. Server reachable + project loaded
curl -s http://localhost:3001/projects | jq '.[].slug' | grep goose-hub-self
```

When you actually run a seed, watch:

```bash
# Tail the event stream for the work item
curl -N "http://localhost:3001/events?projectId=goose-hub-self&workItemId=<issue-number>" \
  | grep --line-buffered -E '"kind":"(state.transitioned|agent\.run-(started|completed|failed)|qa\.|tool\.violation|agent\.budget-exceeded)"'
```

After the run, regardless of outcome:

```bash
pnpm dogfood record <run-id> \
  --completion=<reached-terminal|stalled|failed:<node>[:<reason>]> \
  --truth-pass=<true|false> \
  --qa-correct=<true|false> \
  --hygiene-clean=<true|false>

pnpm dogfood runs:summary
```
