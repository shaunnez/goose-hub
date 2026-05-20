# Issue Close Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a PR is merged and auto-closes a GitHub issue, automatically add `factory:done` label and tick all unchecked acceptance-criteria checkboxes in the issue body.

**Architecture:** A single GitHub Actions workflow fires on `pull_request: [closed]` when merged. A `actions/github-script` step parses the PR body for `Closes/Fixes/Resolves #N` patterns, then for each matched issue makes two GitHub API calls: add `factory:done` label, and patch the issue body to replace `- [ ]` with `- [x]`. Operations are idempotent — re-runs are safe.

**Tech Stack:** GitHub Actions YAML, `actions/github-script@v7` (Octokit built-in), no Node dependencies required.

---

## File Map

| File | Change |
|------|--------|
| `.github/workflows/issue-close.yml` | Create — the full workflow |

No TypeScript changes. No pnpm changes. This is a pure GitHub Actions addition.

---

### Task 1: Create the issue-close workflow

**Files:**
- Create: `.github/workflows/issue-close.yml`

The workflow must:
1. Fire only when a PR is **merged** (not just closed)
2. Parse the PR body for closing keywords (`closes`, `fixes`, `resolves` — case-insensitive) followed by `#N`
3. For each matched issue number (same-repo only — skip `owner/repo#N` patterns):
   a. Add label `factory:done` (idempotent — GitHub returns 200 whether or not label already exists)
   b. Fetch the issue body, replace all `- [ ]` with `- [x]`, PATCH the body back (skip if body is unchanged)
4. Log each action so the workflow run is auditable

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/issue-close.yml`:

```yaml
name: Issue close automation

on:
  pull_request:
    types: [closed]

jobs:
  close-issues:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    permissions:
      issues: write

    steps:
      - name: Label and tick issues closed by this PR
        uses: actions/github-script@v7
        with:
          script: |
            const body = context.payload.pull_request.body ?? '';
            const owner = context.repo.owner;
            const repo = context.repo.repo;

            // Match: closes/fixes/resolves #N (same-repo only, not owner/repo#N)
            const pattern = /(?:closes|fixes|resolves)\s+#(\d+)/gi;
            const issueNumbers = [];
            let match;
            while ((match = pattern.exec(body)) !== null) {
              issueNumbers.push(parseInt(match[1], 10));
            }

            if (issueNumbers.length === 0) {
              console.log('No closing references found in PR body.');
              return;
            }

            console.log(`Found closing references for issues: ${issueNumbers.join(', ')}`);

            for (const issueNumber of issueNumbers) {
              // 1. Add factory:done label (idempotent).
              try {
                await github.rest.issues.addLabels({
                  owner,
                  repo,
                  issue_number: issueNumber,
                  labels: ['factory:done'],
                });
                console.log(`#${issueNumber}: added factory:done label`);
              } catch (err) {
                console.error(`#${issueNumber}: failed to add label — ${err.message}`);
              }

              // 2. Tick checkboxes in the issue body.
              try {
                const { data: issue } = await github.rest.issues.get({
                  owner,
                  repo,
                  issue_number: issueNumber,
                });
                const originalBody = issue.body ?? '';
                const tickedBody = originalBody.replace(/- \[ \]/g, '- [x]');
                if (tickedBody === originalBody) {
                  console.log(`#${issueNumber}: no unchecked boxes, skipping body update`);
                } else {
                  await github.rest.issues.update({
                    owner,
                    repo,
                    issue_number: issueNumber,
                    body: tickedBody,
                  });
                  console.log(`#${issueNumber}: ticked checkboxes in issue body`);
                }
              } catch (err) {
                console.error(`#${issueNumber}: failed to tick checkboxes — ${err.message}`);
              }
            }
```

- [ ] **Step 2: Validate YAML syntax**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/issue-close.yml'))" && echo "YAML valid"
```

Expected: `YAML valid`.

- [ ] **Step 3: Verify the workflow appears to CI**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && cat .github/workflows/issue-close.yml | grep "name:" | head -5
```

Expected: `name: Issue close automation` and `name: Label and tick issues closed by this PR`.

- [ ] **Step 4: Commit**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && git add .github/workflows/issue-close.yml && git commit -m "feat(ci): auto-label factory:done and tick checkboxes on PR merge"
```

---

### Task 2: Manual end-to-end verification

GitHub Actions cannot be unit-tested locally without `act` (a heavyweight dependency). Verify by opening a test PR.

- [ ] **Step 1: Create a test issue**

On the repo, create a GitHub issue with body:
```
Test issue for close automation.

## Acceptance Criteria
- [ ] First criterion
- [ ] Second criterion
```

Note the issue number (e.g. `#99`).

- [ ] **Step 2: Create a test PR that closes the issue**

Create a branch, push a trivial commit, open a PR with body:
```
Test PR.

Closes #99
```

- [ ] **Step 3: Merge the PR and verify**

After merging:
1. Go to issue `#99` — it should now have label `factory:done`.
2. The issue body should now show `- [x] First criterion` and `- [x] Second criterion`.
3. The workflow run (Actions tab → "Issue close automation") should show logs for `#99`.

- [ ] **Step 4: Verify idempotency**

Trigger the workflow again (or merge another PR closing the same issue number). Confirm:
- No duplicate `factory:done` label added
- No error in the workflow log
- Body not double-ticked (already `- [x]` stays `- [x]`)

---

## Self-Review

**Spec coverage:**
- Auto-adds `factory:done` on PR merge — Task 1 ✓
- Ticks checkboxes in issue body — Task 1 ✓
- Fires only on merge (not on close/abandon) — `if: github.event.pull_request.merged == true` ✓
- Idempotent — label add is idempotent on GitHub; checkbox replace is a no-op if already ticked ✓
- Auditable — console.log per action ✓
- Does not fail the workflow if one issue fails — try/catch per issue ✓

**Placeholder scan:** No TBDs. All code complete.

**Closing keyword patterns supported:**
- `Closes #42` ✓
- `closes #42` (case-insensitive) ✓
- `Fixes #42` ✓
- `Resolves #42` ✓
- Cross-repo `owner/repo#42` — intentionally excluded (regex requires `#N` not preceded by `/`) ✓

**What this does NOT handle:**
- Issues closed manually (not via PR) — out of scope; handle via `goose milestone-sweep`
- Multi-repo closures — out of scope for M1
- The `factory:done → factory:archived` transition — that's the milestone sweep's job
