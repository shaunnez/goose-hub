# Goose Hub

Personal command centre for AI-assisted software delivery. One user, local-first. Factory is the orchestration engine inside it.

## Language

**Factory**:
The orchestration engine inside Goose Hub — orchestrator, workflows, agent runtime, tool layer, workspaces, budgets, telemetry.
_Avoid_: "the system", "the harness"

**Target Project** (or just **Project**):
A unit of work Factory operates on. Has its own source of truth, mode, budgets, governance. Configured under `target-projects/<slug>/`.
_Avoid_: "project" alone when the Goose Hub repo itself is meant

**Work Item**:
A unit of work in a project's source of truth. Identified by repo-qualified ref (`github:shaunnez/diamond-ingestion#42`).
_Avoid_: "task", "ticket", "card"

**State**:
The lifecycle position of a work item. Stored as a label on the **issue**, not the PR.
_Avoid_: "status", "stage"

**Skill**:
A packaged agent capability: versioned markdown prompt + Zod schema (`schema.ts`) + config (`skill.config.ts`). Lives under `skills/<name>/`.
_Avoid_: "prompt", "template", "capability"

**Agent Run**:
One invocation of an AI agent with role, prompt, tool allowlist, budget, output schema. Produces JSON conforming to its skill schema.

**Role**:
A typed agent identity: Triager, Griller, PRD-Writer, Decomposer, Researcher, Investigator, Developer, QA, Reviewer, Retrospector, Advisor.

**Persona**:
A named instance of a Role with history and performance stats. Project-scoped. 3 seeded per role per project.

**Holdout**:
A role (QA, Reviewer) that never sees implementation reasoning, plans, decision summaries, or chat history. Enforced at the runtime layer via `contextAllowlist`. No advisor, no down-tier fallback.

**Workspace**:
An ephemeral working directory containing a git worktree of the target repo. A *workflow boundary*, not an *isolation boundary*.

**Gate**:
A workflow node that pauses awaiting human approval. In supervised mode, emits `gate.awaiting-human`. In autonomous mode, bypassed automatically.

**Advisor**:
A higher-tier model that reviews a primary agent's output in fresh context. Verdict: `proceed`/`revise`/`abort`. Never does work. Never on holdouts.

**Decision Summary (canonical)**:
`decisionSummaries: Array<{step, summary, evidence?}>` in the skill's Zod schema. Agent populates during run; orchestrator extracts from the validated terminal output and emits as `agent.decision-summary` events post-validation. Schema enforces emission. This is the canonical record.

**Decision Summary (live)**:
Best-effort mid-run progress. Agent emits `[decision] <one sentence>` marker lines in its text turn (standardized footer in each skill's `prompt.md`). PostToolUse hook scans `transcript_path` for new markers since last fire and forwards to event stream. Reconciled against canonical record at run end.
_Avoid_: "agent thought", "reasoning log"

**Tool-Call Audit** (`agent.tool-call`):
Automatic, per tool call. PreToolUse hook logs `{tool_name, redacted_tool_input, run_id, timestamp}` to event stream. No reasoning, no skill-author burden. Shares the same hook already wired for allowlist enforcement.
_Avoid_: conflating with decision summaries — they are different streams at different cadences

**Bootstrap**:
The workflow that onboards a new target project. Has governance-creation exception (may create but not modify governance files in PRs tagged `factory:bootstrap-pr`).

**Vertical Slice**:
A self-contained, end-to-end feature folder. Includes only the surfaces it genuinely touches. `slice.test.ts` and `README.md` always required.

## Prompt and Context Architecture

**Channel split:** `--system-prompt` carries the skill's `prompt.md` verbatim (stable, cacheable, never mutated by per-run data). `-p "<context>"` carries the per-run task context as the user message. Mirrors Anthropic's canonical pattern.

> **Correction (M4 integration):** Originally documented as `--append-system-prompt`. Empirically, `--append-system-prompt` appends to the default Claude Code IDE system prompt, causing the agent to respond as a general coding assistant rather than follow the skill instructions. `--system-prompt` (full replacement) is required.

**Prompt caching benefit:** system prompt is identical across all runs of a given skill → fully cacheable. Per-run context in user message does not invalidate the system prompt cache.

**Context format:** structured XML tags (`<task><work_item>...</work_item><findings>...</findings></task>`). Anthropic's native delimiter. Orchestrator renders context mechanically from a typed `AgentSpec.context` object; skill authors never write template syntax.

**Per-skill typed context:** each `skill.config.ts` exports a `contextSchema: ZodSchema`. Orchestrator validates `AgentSpec.context` against it before spawn. Wrong context → run fails before subprocess starts. FACTORY_RULES rule 5 applied to inputs as well as outputs.

**Holdout context filtering:** `contextAllowlist: ContextKey[]` in `AgentSpec` specifies which context keys the orchestrator is permitted to inject. QA allowlist includes `workItem`, `prDiff`, `sliceTests`, `projectCommands` — excludes `investigationFindings`, `devDecisionSummaries`. Orchestrator filters the context Record before rendering; excluded keys are never present in the XML block.

## Agent Runtime — Resolved Decisions

**`runId`:** canonical workflow isolation key. Generated once per `AgentRuntime.run()` call (ULID or UUID v4). Declared as `runId: string` on `AgentSpec`. Passed to all subprocess calls, workspace dir paths (`~/.factory/workspaces/<runId>/`), event emission, and hook scripts (via env var). All downstream components — tool layer, event store, hooks — use `runId` as the traceability key. Resolved at M4.01.

**Spawn mechanism:** `claude -p` (`--print` mode, non-interactive subprocess).

**Tool allowlist enforcement:** Belt-and-braces, two layers:
1. `--allowedTools "Read,Write,..."` at spawn — orchestrator computes coarse allowlist from `toolBundles ∪ toolExtras` in `AgentSpec`.
2. `PreToolUse` hook (orchestrator-owned) — audit + secondary deny. Receives per-run allowlist via env var. Denies on mismatch; logs every call to event stream with secret redaction.

**Pattern-level deny rules** (e.g. `Read(./.env*)`, `Bash(sudo *)`) live in workspace `.claude/settings.json`, written once at workspace bootstrap, not mutated per run.

**Other flags at spawn:** `--max-turns`, `--max-budget-usd` (mapped from `AgentSpec.budgets`), `--no-session-persistence`, `--system-prompt` (skill-specific guidance, full replacement — see channel split above). Spawn env requires `HOME`, `USER`, `TMPDIR`, `PATH` plus `FACTORY_RUN_ID`, `FACTORY_RUN_ALLOWLIST`; `USER` and `TMPDIR` are required for macOS OAuth keychain credential lookup.

**Structured output:** `--output-format json --json-schema <schema>` for the terminal envelope. The model returns the JSON inside a markdown code fence in the `result` field (not via a `StructuredOutput` tool call). Runtime must extract JSON from the fence: try direct `JSON.parse`, then strip ` ```json ... ``` `, then fall back to raw string.

**Zod ↔ JSON Schema:** Spike at M4 (echo-test). Strategy: author in Zod, emit via `zod-to-json-schema`, pass to `--json-schema`. Fall back to Zod-only post-hoc validation if roundtrip is lossy.

**Decision-summary events:** Emitted via PostToolUse hooks during the run — orchestrator synthesizes from tool call context. The agent does NOT call a `emit_decision_summary` tool.

## Model Tier Registry

## Advisor Flow

**Verdicts (typed):**
```ts
type AdvisorVerdict =
  | { verdict: 'proceed' }
  | { verdict: 'revise', feedback: string }   // feedback non-optional
  | { verdict: 'abort',  reason: string }     // reason non-optional, immediate escalation
```

**State-machine table (complete, no gaps):**

| Pass | Verdict | Action |
|------|---------|--------|
| 0 | proceed | continue with primary output |
| 0 | revise | re-spawn primary with feedback; pass → 1 |
| 0 | abort | `factory:needs-human`, write reason as comment |
| 1 | proceed | continue with revised primary output |
| 1 | revise | `factory:needs-human`, include both feedback rounds in comment |
| 1 | abort | `factory:needs-human`, write reason as comment |

**`abort` is unconditional.** No revision pass on any abort. Categorical distinction: `revise` = "fixable, try again"; `abort` = "unsafe, stop". Making abort revisable collapses it into a stronger revise and destroys the safety signal.

**Context XML on revision passes** (in user-prompt channel per Q3):
```xml
<task>
  <work_item>...</work_item>
  <revision_pass>1</revision_pass>
  <advisor_feedback>
    <previous_output_summary>...</previous_output_summary>  <!-- ~1 paragraph, not full output -->
    <feedback>...</feedback>                                <!-- verbatim from revise verdict -->
  </advisor_feedback>
</task>
```

**Advisor pass 1 is informed.** Advisor on second invocation sees `<previous_advisor_feedback>` (its own pass-0 output). Lets it check: "did the primary address what I raised?" Stays within holdout discipline — advisor seeing its own prior output is not a reasoning leak.

**Prior pass decision summaries** never carry to revised primary spawn. Stay in event stream for human/retro use only.

**`SkillConfig.contextSchema`** declares `advisorFeedback?: AdvisorFeedback` and `revisionPass?: 0 | 1`. Orchestrator pre-spawn validator catches revision-pass state with missing feedback before subprocess starts.

## Gate Mechanics

**Authority:** GitHub labels. Both UI and direct label edit are co-equal approval paths — no dedup logic, no UI exclusivity. The stateless idempotent tick + project lock handle convergence by construction.

**Why no dedup:** `transitionState()` writes to GitHub → webhook fires (confirmation of write). Tick is idempotent (same state twice → same no-op). Lock serializes concurrent fires. One unit test: `tick()` called twice in succession with no state change dispatches once.

**Where UI earns its keep:** atomic compound actions. "Approve" = single label flip, equivalent on both surfaces. "Request-changes" = remove state label + add `factory:needs-fix` + write comment + retry counter update — four ops the UI composes atomically. GitHub-side request-changes requires the human to sequence all four manually.

**Audit trail uniformity:** UI gate decisions write a GitHub comment as a side effect (e.g., `"Approved via Goose Hub UI"`). Both paths look equivalent in the timeline (GitHub is canonical). No separate "UI history."

**Webhook filtering:** only `factory:*` state-label changes trigger a tick. Auxiliary-label changes (`schedule:`, `priority:`, `mode:`, `type:`) update local cache only, never dispatch. Filter at webhook handler, not inside `tick()`.

**Mid-flight reversion:** human approves → workflow dispatches → human reverts label → running workflow must emit `state.changed-during-run` and abort cleanly. Explicit test case for M7's review workflow.

**Authorization:** deferred (single-user, v0). ADR when contributor support lands.

## Persona Routing

**Selection strategy:** round-robin within role (option a). Orchestrator tracks `lastPersonaIndex` per `(projectId, role)` in `project_state` table. Next run picks `(lastIndex + 1) % personaCount`, stores updated index. Simple, deterministic, equal exposure. No stats weighting until M9 provides enough data to know if it matters.

**`personaId` on `AgentSpec` (resolved M6):** `AgentSpec` carries a required `personaId: string` field. The workflow layer is responsible for selection — call `selectPersona(projectId, role)` in `core/agent-runtime/` before building the spec. The runtime's `assembleSpawnContext` uses `personaId` to load persona history on the non-fresh path. Every emitted `agent.*` event carries `personaId` for M9 stats. Field is required (not optional) so it cannot be silently skipped. `triage-batch.ts` backfilled as part of M6.05.

## Model Tier Registry

**Location:** `core/agent-runtime/models.ts` — typed `ModelEntry[]`, hardcoded TS, git-tracked. Not external config.

**Current IDs (as of 2026-04-30):**
- `opus` → `claude-opus-4-7`
- `sonnet` → `claude-sonnet-4-6`
- `haiku` → `claude-haiku-4-5-20251001`

**Exported helpers:**
- `defaultModelForTier(tier)` — head non-deprecated entry for the tier
- `tierOf(modelId)` — inverse lookup (required for fallback policy enforcement)
- `modelsAtOrAboveTier(tier)` — for fallback safety (FACTORY_RULES rule 27)

**Override hierarchy (lowest → highest precedence):**
tier default → project pin (`ProjectConfig.modelPins?`) → skill pin (`SkillConfig.modelPin?` with required `reason`) → per-spawn override (`AgentSpec.modelOverride?`)

**Pin, not float.** Persona stats are meaningless under silent upgrades. Sprint stability requires known model per run. Audit trail: `git log core/agent-runtime/models.ts` + run events answers "what model produced this PR?"

**Upgrade path:** manual PR (pre-M9) → retro hook flags degradation (M9+) → autonomous model-bump issues (M16+, YAGNI until felt 3x manually).

**Future flag:** `ModelTier` assumes Anthropic family naming. OpenRouter (post-v0) breaks this; tier becomes per-provider. Document in OpenRouter ADR when that work lands.

## Scheduler — Work Item Eligibility Pipeline

Resolved order for `core/orchestrator/scheduler.ts`. Each step is a pure function over `(item, project, operationalState)`.

1. **Conflict-resolve** — run `conflict-resolver.ts` → canonical state per item (pre-filter; may move item to `factory:needs-human`)
2. **State-workflow match** — item state must map to a dispatchable workflow; excludes terminal, gate-pending, `needs-human`
3. **Quarantine filter** — exclude items with `factory:rate-limited | budget-exceeded | tool-violation`
4. **Schedule filter** — `schedule:current` only; `next | later | blocked-by` excluded (`blocked-by` is manual override — cleared by human, never by orchestrator)
5. **Dependency check** — all `dependsOn` refs must be `done | archived` (M11+; pre-M11 assumed empty)
6. **Active-milestone filter** — HARD: item's milestone must equal project's active milestone, OR item has no milestone. Active queue empty → orchestrator does nothing; human sets next active milestone.
7. **Mode-eligibility** — item's effective mode must match tick trigger context (webhook, cron, UI button); interactive items never dispatched by webhook tick
8. **Flood protection** — non-owner author cap (`maxIssuesPerDayFromNonOwners`) not exceeded for today; counter in operational SQLite
9. **Lock check** — per-project lock not held (pre-M11) / item not already in-flight (M11+)
10. **Sort** — `priority desc`, then `(repo asc, issueNumber asc)` tuple (stable, deterministic, multi-repo-safe)
11. **Return** — head element pre-M11; `pickEligibleBatch(items, project, maxParallel)` returning 0–N at M11+. Do NOT bake singular return into TypeScript types now.

**Starvation note:** strict priority + FIFO may starve `medium/low` under sustained `critical` load. Deferred until measured; mitigation is aging weight if it bites.

## Relationships

- A **Target Project** has exactly one **Source of Truth** and one or more **Target Repositories**
- A **Work Item** has exactly one **State** (the canonical label on the issue)
- A **Workflow** operates on a **Work Item** inside a **Workspace**
- An **Agent Run** belongs to a **Workflow** and is executed by a **Persona** with a **Role**
- A **Skill** defines the contract for an **Agent Run** (prompt + schema + config)
- **Holdouts** (QA, Reviewer) enforce fresh context via `contextAllowlist` — no implementation reasoning in, no reasoning out

## Example dialogue

> **Dev:** "Should the QA persona see the Developer's decision summaries?"
> **Domain expert:** "No — QA is a holdout. The runtime's context allowlist excludes `decision-summaries-from-implementation-roles`. The orchestrator never injects them."

## Event Stream Architecture

**Mechanism:** in-process `EventEmitter` + SQLite chokepoint. Not polling, not `update_hook` (better-sqlite3 doesn't expose it).

**Single writer:**
```ts
// core/event-stream/store.ts
export function appendEvent(event: AgentEvent): AgentEvent {
  const persisted = db.transaction(() => insertEvent(event))()
  eventBus.emit('event', persisted)  // post-commit — subscribers never see uncommitted state
  return persisted
}
```
No other code in `core/` may call `insertEvent` directly. Lint rule enforces. On crash between insert and emit: SQLite record intact, notification missed → next reconnect's catch-up query recovers it.

**SSE endpoint — Last-Event-ID is mandatory:**
1. Replay all events since `lastSeen` matching filters
2. Subscribe to EventEmitter for live tail with same filter
3. Every SSE event writes `id: ${e.id}` — browser stores it, sends on reconnect

**Filter at endpoint** (`project`, `workItem`, `type`, `since`). Both replay and live tail apply the same filter. No cross-project event leakage.

| Concern | Mechanism |
|---------|-----------|
| Durability | SQLite write inside `appendEvent()` transaction |
| Notification | In-process EventEmitter emit, post-commit |
| Single writer | `appendEvent()` only; lint enforced |
| Reconnect catch-up | `Last-Event-ID` → `queryEventsSince(lastSeen, filters)` |
| Live tail | EventEmitter subscription, same filter function |
| Driver lock-in | None — works with any SQLite binding |

## Context Assembly and Holdout Enforcement

**Two guards, different paths:**
- `contextAllowlist: ContextKey[]` — the *manifest*. Filters which keys from `AgentSpec.context` render into the user-prompt XML. Guards against wrong keys at spec construction time.
- `freshContext: boolean` — the *closure assertion*. When `true`, no other injection channel adds anything. Guards against runtime infrastructure adding ambient state the AgentSpec author doesn't control.

**Type-level enforcement:**
```ts
type Role =
  | { kind: 'developer' | 'investigator' | ... }
  | { kind: 'qa' | 'reviewer', requiresFreshContext: true, allowsAdvisor: false }

type AgentSpec<R extends Role> = {
  freshContext: R extends { requiresFreshContext: true } ? true : boolean
  // ...
}
```
QA `AgentSpec` with `freshContext: false` fails to compile.

**What the non-fresh path injects** (only for non-holdout roles):
- Recent event-stream entries from current run
- Decision summaries from earlier same-run invocations
- Persona history ("you've handled 47 of these; common pitfalls are X, Y")
- Inbox notes tagged for this work item

**CC-side leak vector: workspace `CLAUDE.md`.** CC reads it automatically on every spawn. The workspace CLAUDE.md must be *holdout-clean by design* — only material safe for every role (naming conventions, test commands, etc.). Implementation guidance belongs in per-skill `prompt.md` or in `AgentSpec.context` filtered by allowlist. Never in the auto-loaded path. Bootstrap workflow's CLAUDE.md template (M12) includes an explicit `## What goes here / What doesn't` section. This is a Factory rule, not a soft convention.

**Centralized injection registry:**
```ts
// core/agent-runtime/context-assembly.ts
export function assembleSpawnContext(spec: AgentSpec): SpawnContext {
  const base = renderManifest(spec.context, spec.contextAllowlist)
  if (spec.freshContext) return base
  return { ...base, eventStream: ..., personaHistory: ..., }
}
```
All ambient injection routes through this function. ESLint rule or PR check flags any non-test access to event-stream/persona-history/inbox from `core/agent-runtime/` outside this file.

## Interactive Workflow Pattern (grill-me is first instance)

**Mechanism:** stateless multi-turn. Orchestrator reconstructs full conversation from DB, re-spawns fresh agent each turn with `<conversation_history>` in user-prompt XML.

**Dispatch trigger:** new human message written to `conversation_log` table → orchestrator tick fires → `awaitingAgent()` check: eligible if `messages.length === 0` OR `last(messages).role === 'human'`. Not eligible while waiting on human.

**Primitives (generic, reusable):**
- `conversation_log` table in operational SQLite, keyed by work-item ID
- `awaitingAgent(item, opState)` eligibility check — applied to any state whose workflow is `interactive: true`
- `<conversation_history>` XML element in user-prompt block
- `InteractiveSkillConfig extends SkillConfig` with `interactive: true` and `maxTurns: number`

**Termination:** discriminated union output schema:
```ts
const GrillerOutput = z.discriminatedUnion('done', [
  z.object({ done: z.literal(false), question: z.string(), decisionSummaries: z.array(DecisionSummary).optional() }),
  z.object({ done: z.literal(true), intentDocument: z.string(), decisionSummaries: z.array(DecisionSummary).min(1) }),
])
```
`done: true` → orchestrator persists `intentDocument`, transitions to `factory:prd-drafting`.

**Turn budget:** `maxTurns` (default 8 agent turns). On exhaustion: force `done: true` with assembled intent; emit `agent.turn-budget-exhausted`; human can continue manually.

**M4 flag:** pull discriminated-union output into echo-test spike to catch `--json-schema` roundtrip issues before M13's first real use.

## Improvement Candidates

**Always file in `shaunnez/goose-hub`, never in the target project.** The change lives in Goose Hub (skill, config, workflow) regardless of which project's retro surfaced it. Provenance carried as structured metadata.

**`ImprovementKind` (required, non-optional in schema):**
```ts
type ImprovementKind =
  | 'skill-prompt' | 'skill-schema' | 'skill-config'
  | 'global-config' | 'project-config' | 'persona'
  | 'workflow'
  | 'governance-suggestion'   // human-only; filtered from dispatcher (FACTORY_RULES rule 12)
```

**Body schema:** prose summary/context/suggestion for humans + structured YAML fenced block for orchestrator:
```yaml
improvement_candidate:
  kind: skill-prompt
  target_path: skills/triage/prompt.md
  source_run_id: run_01J...
  source_project: phaser-game
  source_work_item: shaunnez/phaser-game#142
  retrospective_kind: deep
  confidence: medium   # low | medium | high
  proposed_diff: |     # optional
```

**Dispatch routing:** `governance-suggestion` → human-only queue. All other kinds → standard supervised pipeline. The kind discriminator is the gate.

**Cross-project coalescing:** bootstrap workflow comments `Related: #N` when a new candidate matches an existing open issue's `target_path`. Coalescing is a human action, not automated. Revisit at higher volumes.

**No auto-ship at M9.** Always human-gated. Kind discriminator ready for future auto-ship gate in autonomous mode if needed.

**Labels:** `improvement:skill-prompt`, `improvement:workflow`, etc. Pre-filed at bootstrap.

## Flagged ambiguities

- **Decision-summary two-stream split**: resolved. Canonical record lives in schema field; live markers from `[decision]` footer in `prompt.md`. Tool-call audit is a third, separate stream. All three distinct concerns at distinct cadences.

## Deferred / Open Questions (to resolve at their milestone)

- **M11**: `parseDependsOn` regex in `github-labels.ts` requires a colon (`depends on:`). Plan examples use `Depends on #42` (no colon). Tolerant parser spec says also accept `Depends-On`, `blocked by`. Fix before M11 dependency checks go live.
- **M12**: Governance PR check CI wiring — how does `core/governance/pr-check.ts` get access to the PR diff and labels in GitHub Actions?
- **Post-v0**: Claude CLI vs Claude Agent SDK — reference audit (#10) said "compare honestly." SDK lacks subprocess overhead and suits non-coding skills (triage, retro) better. Revisit when v0 ships.

## Monorepo import convention (established M2)

`core/` is the `@goose-hub/core` workspace package. Apps (`apps/server`, `apps/cli`) import it as:

```ts
import { ... } from '@goose-hub/core/state-machine/states.js';
```

Never via `../../../core/` paths. The wildcard export `"./*": "./*"` in `core/package.json` covers all subpaths. New top-level directories imported by multiple apps must get their own `package.json` with `"name": "@goose-hub/<name>"` before the first cross-app import is written (per FACTORY_RULES.md rule 28a).
