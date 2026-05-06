# From Skills to Harness Engineering — Training Deck

> You know skills. Here's what comes next: building the system around your system.

> Sources: [IndyDevDan: Pi Agent Teams / Harness Engineering](https://www.youtube.com/watch?v=RairMJflUSA) · [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) · [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)

---

---

## Section 1: You Know Skills. Now What?

---

### 1.1 Where You Are

You've built skills. You have CLAUDE.md files. Claude knows your conventions, your commit style, your code review checklist. That puts you ahead of most engineers.

But skills are instructions. Instructions are suggestions. Claude follows them 70-90% of the time.

What happens when you need 100%?

---

### 1.2 The Gap

| What Skills Do | What Skills Can't Do |
|---|---|
| Teach Claude your preferences | **Enforce** that Claude follows them |
| Provide context and workflows | **Block** dangerous operations before they happen |
| Suggest how to work | **Verify** that work is actually complete |
| Guide quality | **Guarantee** quality checks run every time |

Skills are the brain. You need the guardrails.

---

### 1.3 The Insight: Build the System Around the System

> "80% of the time I'm using Claude Code as a meta builder. I'm building the system that builds the system."

This is the shift from agentic coding to **harness engineering**:

```
Level 1: Skills         — Claude knows HOW to work
Level 2: Hooks + SDLC   — The system ENFORCES how work happens
Level 3: Agent teams    — Multiple agents, orchestrated
```

**Today we're going from Level 1 to Level 2.**

A basic SDLC with hooks that enforce planning before building, and verification before shipping.

---

### 1.4 What Is a Hook?

A hook is a script that fires at a specific moment in Claude's lifecycle. It runs outside the model — deterministic code, not a suggestion.

```
Claude wants to edit a file
    ↓
PreToolUse hook fires BEFORE the edit
    ↓
Your script checks: Is there a plan? Is this file in scope?
    ↓
Allow, Deny, or Ask the user
    ↓
Claude proceeds (or doesn't)
```

Think of it like Express.js middleware:

```
HTTP:   Request  →  middleware  →  handler  →  middleware  →  Response
Agent:  Action   →  PreToolUse →  execute  →  PostToolUse →  continue
```

The model never sees the hook. It just encounters the result.

---

---

## Section 2: The Starter SDLC

---

### 2.1 Three Phases, Three Hooks

Every engineering workflow has three phases. We're going to enforce each one with a hook:

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   PLANNING  │  ───→ │  BUILDING   │  ───→ │  VERIFYING  │
│             │       │             │       │             │
│  Plan first │       │  Build with │       │ Prove it    │
│  Think      │       │  guardrails │       │ works       │
│  before     │       │  Quality    │       │ before      │
│  acting     │       │  feedback   │       │ declaring   │
│             │       │  after each │       │ done        │
│             │       │  write      │       │             │
└─────────────┘       └─────────────┘       └─────────────┘
    Hook:                 Hook:                 Hook:
    PreToolUse           PostToolUse            Stop
    "Is there a plan?"  "Did quality pass?"   "Is the work verified?"
```

---

### 2.2 Phase 1: Planning — PreToolUse

**The problem:** Claude jumps straight to coding. It edits files before thinking through the approach. You end up with scattered changes that don't hold together.

**The fix:** A PreToolUse hook on Edit/Write that checks: does a plan file exist?

```
Claude tries to edit src/components/Widget.tsx
    ↓
PreToolUse fires
    ↓
Hook checks: Does .claude/plans/*.md exist for this task?
    ↓
No plan? → DENY with message: "Create a plan first."
Plan exists? → ALLOW
```

**What this enforces:**
- Claude must create a plan file before touching production code
- Plans live in `.claude/plans/` — reviewable, diffable, trackable
- Plan files are always writable (you don't need a plan to write a plan)
- CLAUDE.md and config files are exempt

---

### 2.3 Phase 2: Building — PostToolUse

**The problem:** Claude writes code with lint errors, type errors, broken imports. You catch them later, manually, after the damage is spread across files.

**The fix:** A PostToolUse hook on Edit/Write that runs your quality checks after every file change and injects feedback.

```
Claude writes src/components/Widget.tsx
    ↓
PostToolUse fires
    ↓
Hook runs: eslint, tsc, or your project's lint command
    ↓
Errors found? → Inject via additionalContext
    ↓
Claude reads the feedback → Self-corrects → No human needed
```

**What this enforces:**
- Every file write gets an automatic quality check
- Errors go directly into Claude's context — it fixes them immediately
- No more "I'll run lint later" — it runs every time, automatically
- The feedback loop is instant and continuous

---

### 2.4 Phase 3: Verifying — Stop Hook

**The problem:** Claude says "Done!" but tests are failing, the UI is broken, or half the requirements are missing. Premature victory is the #1 agent failure mode.

**The fix:** A Stop hook that validates completion criteria before Claude can finish.

```
Claude says "I'm done"
    ↓
Stop hook fires
    ↓
Hook checks:
  - Do tests pass?
  - Does the plan file have all sections marked complete?
  - Are there lint errors?
    ↓
All pass? → Allow stop
Any fail? → DENY stop, Claude continues working
```

**What this enforces:**
- Claude must prove it's done, not just say it's done
- Verification runs automatically — not "I should probably run the tests"
- Failed verification sends Claude back to fix the issues
- You get a higher-quality deliverable every time

---

---

## Section 3: How Hooks Work — The Mechanics

---

### 3.1 Where Hooks Live

```
~/.claude/settings.json           ← Global (all projects)
.claude/settings.json             ← Project (shared with team)
.claude/settings.local.json       ← Project (personal, not committed)
Skill/agent YAML frontmatter      ← While skill is active
```

Project settings are the sweet spot. Commit them. Everyone on the team gets the same guardrails.

---

### 3.2 The settings.json Structure

```json
{
  "hooks": {
    "EVENT_NAME": [
      {
        "matcher": "TOOL_PATTERN",
        "hooks": [
          {
            "type": "command",
            "command": "path/to/your/script.sh"
          }
        ]
      }
    ]
  }
}
```

**Matchers** filter which tools trigger the hook:
- `"Edit|Write"` — fires on Edit or Write tool calls
- `"Bash"` — fires on Bash commands only
- `".*"` or `""` — fires on everything
- `"mcp__.*"` — fires on all MCP tool calls

---

### 3.3 Exit Codes — The Critical Detail

| Exit Code | Meaning | Effect |
|---|---|---|
| **0** | Success | Parses stdout as JSON for decisions |
| **2** | Block | Denies the action, stderr shown to Claude |
| **1** | Error (non-blocking) | Shows error but doesn't block |

**Exit code 2 blocks. Exit code 1 does not.** This is the most common mistake.

---

### 3.4 The JSON Output Contract

Your hook script can return JSON to control behavior:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask",
    "permissionDecisionReason": "Explanation shown to Claude",
    "additionalContext": "Extra context injected into conversation"
  }
}
```

**Key fields:**
- `permissionDecision` — allow, deny, or ask (PreToolUse only)
- `additionalContext` — text injected into Claude's context (any hook)
- `decision: "block"` + `reason` — blocks Stop hooks

---

### 3.5 What Your Hook Receives

Every hook gets JSON on stdin:

```json
{
  "session_id": "abc123",
  "hook_event_name": "PreToolUse",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "src/components/Widget.tsx",
    "old_string": "...",
    "new_string": "..."
  },
  "cwd": "/path/to/project",
  "permission_mode": "default"
}
```

Your script reads stdin, makes a decision, outputs JSON to stdout.

---

---

## Section 4: Building Your First Hooks

---

### 4.1 Starter: Plan-First Hook (PreToolUse)

```bash
#!/bin/bash
# .claude/hooks/require-plan.sh
# Blocks edits to production code if no plan exists

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.content // ""')

# Always allow plan files, CLAUDE.md, configs
if echo "$FILE_PATH" | grep -qE '(\.claude/plans/|CLAUDE\.md|settings\.json|\.md$)'; then
  exit 0
fi

# Only check Edit and Write
if [ "$TOOL_NAME" != "Edit" ] && [ "$TOOL_NAME" != "Write" ]; then
  exit 0
fi

# Check if any plan file exists
PLAN_COUNT=$(find .claude/plans/ -name "*.md" 2>/dev/null | wc -l | tr -d ' ')

if [ "$PLAN_COUNT" -eq 0 ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"No plan file found. Create a plan in .claude/plans/ before editing production code. Think first, then build."}}' 
else
  exit 0
fi
```

---

### 4.2 Starter: Quality Check Hook (PostToolUse)

```bash
#!/bin/bash
# .claude/hooks/post-write-lint.sh
# Runs lint check after every file write and injects feedback

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Only check Edit and Write on source files
if [ "$TOOL_NAME" != "Edit" ] && [ "$TOOL_NAME" != "Write" ]; then
  exit 0
fi

# Skip non-source files
if ! echo "$FILE_PATH" | grep -qE '\.(ts|tsx|py|js|jsx)$'; then
  exit 0
fi

# Run your project's lint command (adapt to your stack)
LINT_OUTPUT=$(npx eslint "$FILE_PATH" 2>&1) || true

if [ -n "$LINT_OUTPUT" ] && echo "$LINT_OUTPUT" | grep -q "error"; then
  # Inject lint errors as context so Claude self-corrects
  ESCAPED=$(echo "$LINT_OUTPUT" | head -20 | jq -Rs .)
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":\"Lint errors found in $FILE_PATH. Fix these before proceeding:\\n$LINT_OUTPUT\"}}"
else
  exit 0
fi
```

---

### 4.3 Starter: Completion Gate (Stop)

```bash
#!/bin/bash
# .claude/hooks/verify-before-stop.sh
# Prevents Claude from stopping until verification passes

INPUT=$(cat)

# Check if tests pass
TEST_RESULT=$(npm test 2>&1) || true

if echo "$TEST_RESULT" | grep -qE "(FAIL|failing|failed)"; then
  echo "Tests are failing. Fix them before finishing." >&2
  exit 2  # Exit 2 = BLOCK the stop
fi

# Check if plan exists and has completion markers
PLAN_FILE=$(find .claude/plans/ -name "*.md" -newer .claude/plans 2>/dev/null | head -1)
if [ -n "$PLAN_FILE" ]; then
  INCOMPLETE=$(grep -c '\[ \]' "$PLAN_FILE" 2>/dev/null || echo "0")
  if [ "$INCOMPLETE" -gt 0 ]; then
    echo "Plan has $INCOMPLETE incomplete items. Finish all tasks before stopping." >&2
    exit 2
  fi
fi

exit 0  # All checks pass, allow stop
```

---

### 4.4 Putting It Together: settings.json

```json
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
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/post-write-lint.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/verify-before-stop.sh"
          }
        ]
      }
    ]
  }
}
```

Commit this to `.claude/settings.json`. Every engineer on the team gets the same enforcement.

---

---

## Section 5: The Full Hook Menu

---

### 5.1 All Available Hooks

You started with three. Here's the full menu for when you're ready:

| Hook | When | Can Block? | Use It For |
|---|---|---|---|
| **SessionStart** | Session begins | No | Inject context, set env vars |
| **SessionEnd** | Session ends | No | Archive state, clean up |
| **UserPromptSubmit** | Prompt submitted | Yes | Validate inputs, add context |
| **PreToolUse** | Before tool runs | Yes | Block dangerous ops, enforce plans |
| **PostToolUse** | After tool succeeds | No* | Lint, type-check, inject feedback |
| **PostToolUseFailure** | Tool fails | No | Log errors, suggest fixes |
| **PermissionRequest** | Permission dialog | Yes | Auto-approve safe commands |
| **Stop** | Claude finishes | Yes | Verify completion criteria |
| **PreCompact** | Before context compress | Yes | Preserve critical state |
| **PostCompact** | After compress | No | Re-inject lost context |
| **SubagentStart** | Subagent spawns | No | Inject project context |
| **SubagentStop** | Subagent finishes | Yes | Log metrics, validate output |
| **Notification** | Alert sent | No | TTS, Slack, custom alerts |
| **FileChanged** | File changes on disk | No | Reload env, watch configs |

*PostToolUse can inject `additionalContext` which effectively redirects behavior.

---

### 5.2 Four Hook Types

| Type | Speed | Best For |
|---|---|---|
| **command** | Fastest (< 100ms) | Scripts, pattern matching, lint |
| **http** | Fast (network) | External services, webhooks, dashboards |
| **prompt** | 1-3 seconds | Semantic judgment, intent understanding |
| **agent** | 10-60 seconds | Multi-step review, file analysis |

**Start with command hooks.** They're fast, deterministic, and easy to debug. Graduate to prompt/agent hooks when you need semantic judgment.

---

### 5.3 Matchers — Targeting Your Hooks

| Pattern | What It Matches |
|---|---|
| `"Bash"` | Only Bash tool calls |
| `"Edit\|Write"` | Edit or Write calls |
| `".*"` or `""` | Everything |
| `"mcp__memory__.*"` | All memory MCP tools |
| `"mcp__.*__write.*"` | Write ops from any MCP server |

SubagentStart/Stop matchers target agent types: `"Explore"`, `"Plan"`, `"general-purpose"`.

---

---

## Section 6: Growing Your SDLC

---

### 6.1 The Progression

Start simple. Add hooks as you find pain points.

```
Week 1: The Starter Three
  ├─ PreToolUse: require-plan (Edit|Write)
  ├─ PostToolUse: post-write-lint (Edit|Write)
  └─ Stop: verify-before-stop

Week 2-3: Add Safety
  ├─ PreToolUse: block destructive bash commands (Bash)
  ├─ PostToolUse: type-check after writes
  └─ PermissionRequest: auto-approve safe patterns

Week 4+: Add Observability
  ├─ SessionStart: log session metadata
  ├─ PostCompact: re-inject critical context
  ├─ SubagentStart: inject project context to subagents
  └─ SubagentStop: log token usage and duration

Eventually: Full Lifecycle
  ├─ Phase-gated editing (plan → build → verify → ship)
  ├─ File ownership tracking (who can edit what)
  ├─ Automated quality feedback loops
  └─ Multi-agent team observability
```

---

### 6.2 Real Example: Our SDLC Hooks

Here's what we run in this project right now:

```json
{
  "hooks": {
    "PreToolUse": [{"matcher": "Edit|Write",
      "hooks": [{"type": "command",
        "command": "python3 scripts/lifecycle_hooks.py pre-edit"}]}],
    "PostToolUse": [{"matcher": "Bash",
      "hooks": [{"type": "command",
        "command": "python3 scripts/lifecycle_hooks.py post-bash"}]}],
    "Stop": [{"hooks": [{"type": "command",
        "command": "python3 scripts/lifecycle_hooks.py on-stop"}]}],
    "PostCompact": [{"hooks": [{"type": "command",
        "command": "python3 scripts/lifecycle_hooks.py on-compact"}]}],
    "SubagentStart": [{"hooks": [{"type": "command",
        "command": "python3 scripts/lifecycle_hooks.py on-subagent-start"}]}],
    "SubagentStop": [{"hooks": [{"type": "command",
        "command": "python3 scripts/lifecycle_hooks.py on-subagent-stop"}]}]
  }
}
```

**What each does:**
- **pre-edit**: Phase gates — blocks production code edits during planning phase
- **post-bash**: Advisory warnings on dangerous commands (doesn't block, warns)
- **on-stop**: Persists lifecycle state, builds reminder of pending work
- **on-compact**: Re-injects critical context after compression so Claude doesn't forget
- **on-subagent-start**: Injects project context into spawned subagents
- **on-subagent-stop**: Logs token usage and duration metrics

We started with three hooks. We're at six. You'll grow the same way.

---

### 6.3 Common Patterns to Add Next

**Block dangerous bash commands (PreToolUse on Bash):**
```bash
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')
if echo "$COMMAND" | grep -qE 'rm -rf|DROP TABLE|sudo|docker-compose down -v'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Destructive command blocked by hook."}}' 
fi
```

**Auto-approve safe commands (PermissionRequest on Bash):**
```bash
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')
if echo "$COMMAND" | grep -qE '^(npm run lint|npm test|git status|git diff)'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}'
fi
```

**Re-inject context after compaction (PostCompact):**
```bash
echo "REMINDER: Current feature is $FEATURE_NAME. Plan is at .claude/plans/$PLAN_FILE. Phase: $PHASE."
```

---

---

## Section 7: The Bigger Picture

---

### 7.1 Why This Matters

> "The agent harness is the product. The models are being commoditized."

The Claude Code leak revealed that Anthropic's $2.5B product isn't the model — it's the harness around the model. The permission system, the tool dispatch, the context management, the hooks.

When you add hooks to your workflow, you're building your own harness. A system specialized for your domain, your standards, your SDLC.

---

### 7.2 The Full Progression

```
Where you were:   CLAUDE.md + Skills (the brain)
Where you are:    + Hooks + SDLC (the guardrails)
Where you're going:

  Level 3: Multi-agent with observability
     └─ Dashboard showing all agent activity in real-time
     └─ Per-agent swim lanes, tool usage, failure rates

  Level 4: Agent teams with orchestration
     └─ Orchestrator → Leads → Workers
     └─ One prompt to one orchestrator, horizontal scaling

  Level 5: Agent experts that learn
     └─ Agents maintain their own mental models
     └─ Self-managed expertise files (7K+ tokens)
     └─ Till-done lists (not to-do lists)

  Level 6: Agents that operate your product end-to-end
```

Each level builds on the one before. Hooks are the foundation.

---

### 7.3 What To Do Tomorrow

1. **Create `.claude/hooks/` directory** in your project
2. **Write the plan-first hook** (Section 4.1) — force planning before coding
3. **Write the quality check hook** (Section 4.2) — adapt to your stack's linter
4. **Write the completion gate** (Section 4.3) — prevent premature "done"
5. **Add settings.json** (Section 4.4) — commit it, share it with your team
6. **Run a real task** and watch the hooks fire

Start with the plan-first hook alone if that feels like enough. Add the others as you see the value.

The goal isn't to add all the hooks. The goal is to build a system around your system that makes the work better every time.

---

### 7.4 Key Principles

1. **Prompts suggest. Hooks enforce.** Close the 70-90% gap.
2. **Plan before you build.** A PreToolUse hook makes this non-negotiable.
3. **Verify before you ship.** A Stop hook prevents premature victory.
4. **Start with three hooks.** Planning, quality, verification. Grow from there.
5. **Commit your hooks.** Everyone on the team gets the same guardrails.
6. **Build the system that builds the system.** Hooks are the first step.

---

*Training deck compiled from IndyDevDan's Harness Engineering video and the Claude Code Hooks reference.*
