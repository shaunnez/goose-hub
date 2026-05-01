---
name: advance-milestone
description: >
  Advance Goose Hub to the next Factory milestone. Use when starting a new milestone,
  creating the next milestone, or when told "start next milestone", "advance milestone",
  "move to M<N>", "create milestone M<N>". Updates CLAUDE.md, creates GitHub milestone,
  re-labels issues.
---

# Advance Milestone

## Steps

### 1. Identify current and next milestone

Read `CLAUDE.md` and extract the current active milestone name from this line:
```
Run: `gh issue list --milestone "<CURRENT>" ...`
```

Parse the milestone number (e.g. "M3" → 3). Next milestone = current + 1.

If the user specified a target (e.g. "move to M5"), use that instead.

Read `docs/PLAN.md` section 28 to find the **exact title** of the next milestone (e.g. "M4: Controlled Claude CLI Runtime Spike").

### 2. Create the GitHub milestone (if it doesn't exist)

```bash
gh api repos/shaunnez/goose-hub/milestones --jq '.[].title'
```

If the next milestone title is not listed:
```bash
gh api repos/shaunnez/goose-hub/milestones -X POST \
  -f title="<NEXT_MILESTONE_TITLE>" \
  -f state="open"
```

### 3. Identify issues for the new milestone

Find issues in the new milestone that should be `schedule:current`:
```bash
gh issue list --milestone "<NEXT_MILESTONE_TITLE>" --state open --json number,title,labels
```

For each issue that has `schedule:next`:
```bash
gh issue edit <N> --remove-label "schedule:next" --add-label "schedule:current"
```

If there are no issues in the milestone yet, note that — issues will need to be created before work starts.

### 4. Update CLAUDE.md

In `CLAUDE.md`, find the `gh issue list` command under "Starting the next issue":
```
--milestone "M<OLD>: <OLD_NAME>"
```

Replace with:
```
--milestone "<NEXT_MILESTONE_TITLE>"
```

Also update the milestone reference in the "What's currently in scope" section if it mentions a specific milestone.

Use `gh issue edit` and `Edit` tool — do NOT use sed.

### 5. Update eval.json milestone reference (if present)

Check `.claude/hooks/post-compact.sh` — it now derives the milestone dynamically from `schedule:current` issues, so **no manual update needed** for that file.

Check `skills/echo-test/eval/eval.json` — milestone is not referenced there, so **no update needed**.

### 6. Report

Print a summary:
```
Advanced to: <NEXT_MILESTONE_TITLE>
GitHub milestone: created / already existed
Issues moved to schedule:current: <count>
CLAUDE.md updated: yes
post-compact.sh: self-healing (no update needed)
```

## What NOT to do

- Do not close the previous milestone — human reviews and closes it
- Do not move issues from `schedule:later` to `schedule:current` unless they belong to the new milestone
- Do not create issues — that's a separate task
- Do not modify MISSION.md or FACTORY_RULES.md
