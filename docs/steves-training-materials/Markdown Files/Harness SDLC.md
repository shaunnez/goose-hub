<!-- Slide number: 1 -->
From Skills to
Harness Engineering

Your first SDLC with hooks: plan, build, verify.
You know skills. Here's what comes next.
Based on IndyDevDan + claude-code-hooks-multi-agent-observability
1 / 24

### Notes:

<!-- Slide number: 2 -->
Where You Are

You've built skills -- Claude knows your conventions
You have CLAUDE.md -- Claude knows your project
You're ahead of most engineers already

But skills are instructions. Instructions are suggestions.
Claude follows them 70-90% of the time.

What happens when you need 100%?
2 / 24

### Notes:

<!-- Slide number: 3 -->
The Gap: Skills vs. Hooks

| What Skills Do | What Skills Can't Do |
| --- | --- |
| Teach Claude your preferences | ENFORCE that Claude follows them |
| Provide context and workflows | BLOCK dangerous operations before they happen |
| Suggest how to work | VERIFY that work is actually complete |
| Guide quality | GUARANTEE quality checks run every time |
Skills are the brain. Hooks are the guardrails.
3 / 24

### Notes:

<!-- Slide number: 4 -->
Build the System Around the System

Level 1: Skills

You are here
Claude knows HOW to work

Level 2: Hooks + SDLC

Today's goal
The system ENFORCES how work happens

Level 3: Agent Teams

What's next
Multiple agents, orchestrated

"I'm building the system that builds the system." -- IndyDevDan
4 / 24

### Notes:

<!-- Slide number: 5 -->
What Is a Hook?

A script that fires at a specific moment in Claude's lifecycle. Deterministic code, not a suggestion.
Claude wants to edit a file
    |
    v
PreToolUse hook fires BEFORE the edit
    |
    v
Your script checks: Is there a plan? Is this file in scope?
    |
    v
Allow, Deny, or Ask the user
    |
    v
Claude proceeds (or doesn't)
The model never sees the hook. It just encounters the result.
5 / 24

### Notes:

<!-- Slide number: 6 -->
Section 2
The Starter SDLC

Three phases, three hooks. Plan, build, verify.
6 / 24

### Notes:

<!-- Slide number: 7 -->
Three Phases, Three Hooks

PLANNING
BUILDING
VERIFYING
Plan firstThink before acting
Build with guardrailsQuality after each write
Prove it worksbefore declaring done
-->
-->

Hook: PreToolUse
Hook: PostToolUse
Hook: Stop
"Is there a plan?"
"Did quality pass?"
"Is the work verified?"
Every engineering workflow has these three phases. We enforce each one with a hook.
7 / 24

### Notes:

<!-- Slide number: 8 -->
Phase 1: Planning -- PreToolUse

Problem: Claude jumps straight to coding before thinking through the approach.
Claude tries to edit Widget.tsx
    |
PreToolUse fires
    |
Does .claude/plans/*.md exist?
    |
NO  --> DENY: "Create a plan first"
YES --> ALLOW
Must create a plan before touching code
Plans live in .claude/plans/
Reviewable, diffable, trackable
Plan files always writable
CLAUDE.md and configs exempt

You don't need a plan to write a plan. But you need a plan to write code.
8 / 24

### Notes:

<!-- Slide number: 9 -->
Phase 2: Building -- PostToolUse

Problem: Claude writes code with lint errors and type errors. You catch them manually, later.
Claude writes Widget.tsx
    |
PostToolUse fires
    |
Hook runs eslint / tsc
    |
Errors? --> additionalContext
    |
Claude reads --> self-corrects
Every write gets automatic quality check
Errors injected into Claude's context
Claude fixes them immediately
No more "I'll run lint later"
Feedback loop is instant and continuous
9 / 24

### Notes:

<!-- Slide number: 10 -->
Phase 3: Verifying -- Stop Hook

Problem: Claude says "Done!" but tests are failing and requirements are missing.
Claude says "I'm done"
    |
Stop hook fires
    |
Do tests pass?           NO --> DENY
Plan items all checked?  NO --> DENY
Lint errors?             YES -> DENY
    |
ALL PASS --> Allow stop
Claude must PROVE it's done
Verification runs automatically
Failed = sent back to fix
Higher quality every time
#1 agent failure mode: premature victory

Exit code 2 = BLOCK. Exit code 1 = does NOT block. This is the most common mistake.
10 / 24

### Notes:

<!-- Slide number: 11 -->
Section 3
How Hooks Work

Settings, exit codes, JSON contract, matchers.
11 / 24

### Notes:

<!-- Slide number: 12 -->
Where Hooks Live

| Location | Scope | Commit? |
| --- | --- | --- |
| ~/.claude/settings.json | All projects (global) | No |
| .claude/settings.json | This project (shared) | Yes -- team guardrails |
| .claude/settings.local.json | This project (personal) | No |
| Skill YAML frontmatter | While skill is active | Yes |

Project settings (.claude/settings.json) are the sweet spot. Commit them. Everyone on the team gets the same guardrails.
12 / 24

### Notes:

<!-- Slide number: 13 -->
The settings.json Structure

{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/require-plan.sh"
          }
        ]
      }
    ]
  }
}
Matchers filter which tools fire:
  "Edit|Write" = Edit or Write
  "Bash" = Bash only
  ".*" or "" = everything
  "mcp__.*" = all MCP tools

Four hook types:
  command = shell script (fastest)
  http = POST to endpoint
  prompt = single-turn Claude eval
  agent = multi-turn with tools
13 / 24

### Notes:

<!-- Slide number: 14 -->
Exit Codes and JSON Output

| Exit Code | Meaning | Effect |
| --- | --- | --- |
| 0 | Success | Parses stdout JSON for decisions |
| 2 | BLOCK | Denies the action, stderr shown to Claude |
| 1 | Error (non-blocking) | Shows error but does NOT block |
JSON output for fine-grained control:
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow | deny | ask",
    "permissionDecisionReason": "Why (shown to Claude)",
    "additionalContext": "Extra context injected"
  }
}
14 / 24

### Notes:

<!-- Slide number: 15 -->
Section 4
Build Your First Hooks

Copy-paste starters for planning, quality, and verification.
15 / 24

### Notes:

<!-- Slide number: 16 -->
Starter: Plan-First Hook
PreToolUse on Edit|Write
#!/bin/bash
# .claude/hooks/require-plan.sh
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name')
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Always allow plans, CLAUDE.md, configs
if echo "$FILE" | grep -qE '(\.claude/plans/|CLAUDE\.md|settings\.json)'; then
  exit 0
fi

# Only check Edit and Write
[ "$TOOL" != "Edit" ] && [ "$TOOL" != "Write" ] && exit 0

# Require a plan file
PLANS=$(find .claude/plans/ -name "*.md" 2>/dev/null | wc -l | tr -d " ")
if [ "$PLANS" -eq 0 ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse",
    "permissionDecision":"deny",
    "permissionDecisionReason":"No plan found. Create one in .claude/plans/ first."}}'
else
  exit 0
fi
16 / 24

### Notes:

<!-- Slide number: 17 -->
Starter: Quality Check Hook
PostToolUse on Edit|Write
#!/bin/bash
# .claude/hooks/post-write-lint.sh
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name')
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Only check source files on Edit/Write
[ "$TOOL" != "Edit" ] && [ "$TOOL" != "Write" ] && exit 0
echo "$FILE" | grep -qE '\.(ts|tsx|py|js|jsx)$' || exit 0

# Run your linter (adapt to your stack)
LINT=$(npx eslint "$FILE" 2>&1) || true

if [ -n "$LINT" ] && echo "$LINT" | grep -q "error"; then
  # Inject errors -- Claude reads this and self-corrects
  ERRORS=$(echo "$LINT" | head -20)
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",
    \"additionalContext\":\"Lint errors in $FILE. Fix before proceeding:\n$ERRORS\"}}"
else
  exit 0  # Clean -- no feedback needed
fi
17 / 24

### Notes:

<!-- Slide number: 18 -->
Starter: Completion Gate
Stop hook
#!/bin/bash
# .claude/hooks/verify-before-stop.sh
INPUT=$(cat)

# Check 1: Do tests pass?
TEST_OUT=$(npm test 2>&1) || true
if echo "$TEST_OUT" | grep -qEi "(FAIL|failing|failed)"; then
  echo "Tests are failing. Fix them before finishing." >&2
  exit 2  # EXIT 2 = BLOCK
fi

# Check 2: Plan items all complete?
PLAN=$(find .claude/plans/ -name "*.md" 2>/dev/null | head -1)
if [ -n "$PLAN" ]; then
  INCOMPLETE=$(grep -c "\[ \]" "$PLAN" 2>/dev/null || echo "0")
  if [ "$INCOMPLETE" -gt 0 ]; then
    echo "$INCOMPLETE plan items incomplete. Finish them." >&2
    exit 2  # EXIT 2 = BLOCK
  fi
fi

exit 0  # All checks pass
18 / 24

### Notes:

<!-- Slide number: 19 -->
Put It Together: .claude/settings.json
Commit this. Everyone gets the same guardrails.
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{"type": "command",
          "command": "bash .claude/hooks/require-plan.sh"}]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{"type": "command",
          "command": "bash .claude/hooks/post-write-lint.sh"}]
      }
    ],
    "Stop": [
      {
        "hooks": [{"type": "command",
          "command": "bash .claude/hooks/verify-before-stop.sh"}]
      }
    ]
  }
}
19 / 24

### Notes:

<!-- Slide number: 20 -->
Section 5
Growing Your SDLC

What to add next, and where this all leads.
20 / 24

### Notes:

<!-- Slide number: 21 -->
The Growth Path
Week 1
The Starter Three

  PreToolUse: require-plan (Edit|Write)
  PostToolUse: post-write-lint (Edit|Write)
  Stop: verify-before-stop
Week 2-3
Add Safety

  PreToolUse: block destructive bash (rm -rf, DROP TABLE)
  PermissionRequest: auto-approve safe commands (lint, test)
Week 4+
Add Observability

  PostCompact: re-inject critical context after compression
  SubagentStart: inject project context to subagents
  SubagentStop: log token usage and duration
Eventually
Full Lifecycle

  Phase-gated editing, file ownership, agent team dashboards
21 / 24

### Notes:

<!-- Slide number: 22 -->
Real Example: Our Project's Hooks
| Hook | Event | Matcher | What It Does |
| --- | --- | --- | --- |
| pre-edit | PreToolUse | Edit|Write | Phase gates -- blocks code edits during planning phase |
| post-bash | PostToolUse | Bash | Advisory warnings on destructive commands |
| on-stop | Stop | -- | Persists lifecycle state, reminds of pending work |
| on-compact | PostCompact | -- | Re-injects critical context after compression |
| on-subagent-start | SubagentStart | -- | Injects project context into spawned subagents |
| on-subagent-stop | SubagentStop | -- | Logs token usage and duration metrics |

We started with three hooks. We're at six. You'll grow the same way.
22 / 24

### Notes:

<!-- Slide number: 23 -->
What To Do Tomorrow

1.  mkdir .claude/hooks/ in your project
2.  Write require-plan.sh  -- force planning before coding
3.  Write post-write-lint.sh  -- adapt to YOUR stack's linter
4.  Write verify-before-stop.sh  -- prevent premature 'done'
5.  Add .claude/settings.json  -- commit it, share with team
6.  Run a real task and watch the hooks fire

Start with the plan-first hook alone if that feels like enough. Add the others as you see the value.
23 / 24

### Notes:

<!-- Slide number: 24 -->
Key Principles

Prompts suggest. Hooks enforce. Close the 70-90% gap.
Plan before you build. A PreToolUse hook makes this non-negotiable.
Verify before you ship. A Stop hook prevents premature victory.
Start with three hooks. Planning, quality, verification.
Commit your hooks. Everyone on the team gets the same guardrails.
Build the system that builds the system. Hooks are the first step.
IndyDevDan  |  claude-code-hooks-multi-agent-observability  |  code.claude.com/docs/en/hooks
24 / 24

### Notes:
