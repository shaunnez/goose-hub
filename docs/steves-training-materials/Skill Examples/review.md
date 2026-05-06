# Work Review — Post-Implementation Analysis via Grok 4

Review completed work using xAI's Grok 4 (fallback: Grok 4.1 fast with reasoning). Acts as a sub-agent with full codebase access. Provides a structured scorecard with specific improvement suggestions.

**Arguments:** `$ARGUMENTS` - Scope of review (e.g., "branch", "last commit", "staged", or specific file paths). Defaults to all branch changes vs main.

---

## STEP 1: Determine Review Scope

Parse `$ARGUMENTS` to determine scope:
- Blank / "branch" → `git diff main...HEAD`
- "recent" / "last commit" → `git diff HEAD~1`
- "staged" → `git diff --staged`
- File paths → read those files + their diffs

Also run:
- `git log --oneline -20` for branch history
- `git log --stat -5` for recent change details

---

## STEP 2: Gather Codebase Context (Sub-Agent Deep Dive)

### Modified Files
For every file in the diff, read the FULL current version. The reviewer needs complete context.

### Test Files
For each modified file, search for corresponding test files:
- Python: `tests/test_*.py`, `*_test.py`
- TypeScript: `__tests__/*.test.ts`, `*.spec.ts`
- If no tests exist for a modified file, note the path in context as a testing gap

### Related Files
- Files that import from modified files (use Grep to find `from <module> import` or `import ... from`)
- Base classes, parent components, shared utilities used by modified code
- Pydantic models, schemas, type definitions referenced in changes

### Project Rules
- Read `CLAUDE.md` — the reviewer will flag violations

---

## STEP 3: Build Context File

Write all gathered context to `/tmp/review_context.json`:

```json
{
  "diff": "<git diff output>",
  "claude_md": "<CLAUDE.md contents>",
  "git_log": "<git log output>",
  "files": [{"path": "...", "content": "..."}],
  "test_files": [{"path": "...", "content": "..."}],
  "related_files": [{"path": "...", "content": "..."}]
}
```

Truncate individual files to 500 lines if needed. Aim for 10-30 files total.

---

## STEP 4: Execute Review

```bash
python3 .claude/skills/review/scripts/review_work.py \
  --context-file /tmp/review_context.json \
  --scope <recent|branch|staged>
```

---

## STEP 5: Present Results

Show the review with:
- Header: `## Work Review Results`
- Model used (5.3 or 5.2 fallback)
- Full structured review with scorecard
- Highlight any bugs, security issues, or scores below 3
- Offer to implement HIGH priority suggestions immediately
