# Red Team Audit — Adversarial Plan & Code Review via Grok 4

Launch an adversarial red team audit using xAI's Grok 4 (fallback: Grok 4.1 fast with reasoning). Acts as a sub-agent with full codebase access.

**Arguments:** `$ARGUMENTS` - What to audit (e.g., "review the plan", "audit my changes", "red team the auth refactor"). Leave blank for auto-detect.

---

## STEP 1: Determine Audit Mode

Check what's available to audit:

1. Check if `.claude/plans/` has any plan files
2. Check if there are uncommitted git changes (`git diff` and `git diff --staged`)
3. If `$ARGUMENTS` specifies a mode, use that

Set mode to `plan`, `diff`, or `both`.

---

## STEP 2: Gather Codebase Context (Sub-Agent Deep Dive)

**This is NOT a blind diff review.** You must gather deep context so Codex can review as if it's inside the codebase.

### Required context gathering:

**a) Plan content** (if mode = plan or both):
- Read all `.md` files in `.claude/plans/`

**b) Code changes** (if mode = diff or both):
- Run `git diff` (unstaged changes)
- Run `git diff --staged` (staged changes)
- Run `git log --oneline -10` (recent history)

**c) Modified files — READ THE FULL FILES:**
For every file path that appears in the diff:
- Read the complete current file
- Read files that import from the modified file (search with Grep)
- Read the corresponding test file if one exists
- Read any Pydantic models, schemas, or types referenced

**d) Architecture context:**
- Read `CLAUDE.md` (project rules are LAW for the audit)
- Read any relevant config files (`backend/app/core/models.py`, etc.)

**e) Dependency chain:**
- If new imports are added, read those source files
- If API routes change, read the router definitions
- If DB models change, read relevant migration files

### Target: 10-30 relevant files for a typical audit.

---

## STEP 3: Build Context File

Write gathered context to `/tmp/red_team_context.json` as a JSON object:

```json
{
  "plan": "concatenated plan file contents",
  "diff": "git diff output",
  "staged_diff": "git diff --staged output",
  "claude_md": "CLAUDE.md contents",
  "git_log": "git log output",
  "architecture": "architecture section from CLAUDE.md",
  "files": [
    {"path": "relative/path.py", "content": "file contents (max 500 lines each)"}
  ]
}
```

---

## STEP 4: Execute Audit

```bash
python3 .claude/skills/red-team/scripts/red_team_audit.py \
  --context-file /tmp/red_team_context.json \
  --mode <plan|diff|both>
```

---

## STEP 5: Present Results

Show the audit results with:
- Header: `## Red Team Audit Results`
- Model used (5.3 or 5.2 fallback)
- Full structured audit output
- Your priority ranking of the findings
- Clear guidance on what MUST be fixed vs. what's advisory
- If REJECT verdict: strongly warn before any further implementation
