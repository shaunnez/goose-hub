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
A typed agent identity: Triager, Griller, PRD-Writer, Decomposer, Researcher, Investigator, Developer, Dev-Reviewer, QA, Reviewer, Retrospector, Auditor.

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
`decisionSummaries: Array<{kind, summary, evidence?}>` in the skill's Zod schema (#466). `kind` is constrained to a shared enum (`DecisionKindSchema` in `core/agent-runtime/decision-types.ts`); see ADR 0018. Agent populates during run; orchestrator extracts from the validated terminal output and emits as `agent.decision-summary` events post-validation. Schema enforces emission. This is the canonical record.

**Decision Summary (live)**:
Best-effort mid-run progress. Agent emits `[decision] KIND: <one sentence>` marker lines in its text turn (`KIND` is an uppercase enum value). PostToolUse hook scans `transcript_path` for new markers since last fire and forwards `{kind, summary}` to the event stream; `recordDecisionSummary()` coerces unrecognised kinds to `UNKNOWN` rather than dropping the event. Reconciled against canonical record at run end.
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

**Per-skill typed context:** each `skill.config.ts` exports a `contextSchema: ZodSchema`. Validation is enforced by `invokeSkill()` in `core/agent-runtime/invoke-skill.ts` — wrong context throws `ContextValidationError` before spawn; no subprocess is started. FACTORY_RULES rule 5 applied to inputs as well as outputs. See ADR 0038.

**Holdout context filtering:** `contextAllowlist: ContextKey[]` in `AgentSpec` specifies which context keys the orchestrator is permitted to inject. QA allowlist includes `workItem`, `prDiff`, `sliceTests`, `projectCommands` — excludes `investigationFindings`, `devDecisionSummaries`. Orchestrator filters the context Record before rendering; excluded keys are never present in the XML block.

### Runtime Skill Contract Rules (Migration Baseline, 2026-05-15)

- Canonical context tag style is `camelCase` and must match `contextAllowlist` exactly (example: `<workItem>`, not `<work_item>`).
- `contextAllowlist` dotted keys still render as JSON payloads inside a top-level tag; do not assume nested XML.
- Prompt output JSON examples must mirror `skills/<name>/schema.ts` field names exactly.
- Workflow consumers parse object fields from validated output; contract renames are hard migrations (prompt + schema + consumers + mocks/tests in the same family batch).
- `scripts/audit-skill-contracts.ts` is the baseline advisory auditor; strict enforcement is enabled family-by-family after cleanup.

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

## Operator Intervention Control Plane

**Purpose:** Durable operator interventions explain and resolve stuck work-item
conditions that need a human or server-side operator decision. They replace
browser-only gate heuristics for `needs-human`, `gate-pending`, merge conflict,
QA disagreement, and direct manual override flows.

**Storage:** `work_item_interventions` stores the current intervention row.
`work_item_intervention_events` is the append-only audit log. These are
operational SQLite tables; GitHub labels remain the lifecycle state authority.

**Projection:** `core/interventions/projector.ts` watches actionable terminal
events and opens or reopens rows idempotently. Replay/projector code never calls
the proposer skill inline. Downstream events emitted by an applier include
`interventionId` / `causedByInterventionId`; projectors ignore those so an
applied decision cannot reopen itself.

**Proposer:** `core/interventions/proposer.ts` leases `OPEN` rows, invokes
`skills/intervention-proposer`, validates every proposed option against the
intervention action registry, and stores `PROPOSED`. Invalid proposer output
keeps the row `OPEN` and records `proposalFailed` evidence.

**Decision and apply:** `POST /interventions/:id/decide` is record-only and
requires the observed CAS `expectedVersion`. `core/interventions/applier.ts`
leases `DECIDED` rows, validates the action payload again, executes through
existing server paths, records apply evidence, verifies, and resolves. Failed
apply moves to `FAILED`; stale `APPLYING` leases recover to `DECIDED`.

**Frontend:** The operator queue reads project intervention rows. Issue banners
read issue-specific `OPEN` / `PROPOSED` rows and legal targets from the server;
the browser does not maintain a transition table. The issue timeline includes an
intervention audit panel plus backlinks from state transitions caused by an
intervention.

See ADR 0046 and `docs/runbooks/operator-interventions.md`.

## Persona Routing

**Selection strategy:** round-robin within role (option a). Orchestrator tracks `lastPersonaIndex` per `(projectId, role)` in `project_state` table. Next run picks `(lastIndex + 1) % personaCount`, stores updated index. Simple, deterministic, equal exposure. No stats weighting until M9 provides enough data to know if it matters.

**`personaId` on `AgentSpec` (resolved M6):** `AgentSpec` carries a required `personaId: string` field. The workflow layer is responsible for selection — call `selectPersona(projectId, role)` in `core/agent-runtime/` before building the spec. The runtime's `assembleSpawnContext` uses `personaId` to load persona history on the non-fresh path. Every emitted `agent.*` event carries `personaId` for M9 stats. Field is required (not optional) so it cannot be silently skipped. `triage-batch.ts` backfilled as part of M6.05.

## Model Tier Registry

**Location:** `core/agent-runtime/models.ts` — typed `ModelEntry[]`, hardcoded TS, git-tracked. Not external config.

**Current IDs (as of 2026-05-08):**
- `opus` → `claude-opus-4-7` (provider: claude)
- `sonnet` → `claude-sonnet-4-6` (provider: claude)
- `haiku` → `claude-haiku-4-5-20251001` (provider: claude)
- `opus` → `gpt-5.5` (provider: codex; added M19.10)
- `sonnet` → `gpt-5.4` (provider: codex; added M19.10)
- `haiku` → `gpt-5.4-mini` (provider: codex; added M19.10)

**Exported helpers:**
- `defaultModelForTier(tier)` — head non-deprecated **claude** entry for the tier (back-compat default)
- `defaultModelForTierAndProvider(tier, provider)` — head entry filtered by provider (added M19.10)
- `tierOf(modelId)` — inverse lookup (required for fallback policy enforcement)
- `providerOf(modelId)` — inverse provider lookup (added M19.10; used by the runtime dispatcher)
- `modelsAtOrAboveTier(tier, provider = 'claude')` — for fallback safety (FACTORY_RULES rule 27); fallback stays within-provider

**Override hierarchy (lowest → highest precedence):**
tier default → project pin (`ProjectConfig.modelPins?`) → skill pin (`SkillConfig.modelPin?` with required `reason`) → per-spawn override (`AgentSpec.modelOverride?`)

**Pin, not float.** Persona stats are meaningless under silent upgrades. Sprint stability requires known model per run. Audit trail: `git log core/agent-runtime/models.ts` + run events answers "what model produced this PR?"

**Upgrade path:** manual PR (pre-M9) → retro hook flags degradation (M9+) → autonomous model-bump issues (M16+, YAGNI until felt 3x manually).

**Future flag:** `ModelTier` assumes Anthropic family naming. OpenRouter (post-v0) breaks this; tier becomes per-provider. Document in OpenRouter ADR when that work lands.

## Agent Runtimes — Claude CLI and Codex CLI siblings (M19.10)

Two concrete runtimes share `interface AgentRuntime { run(spec): Promise<AgentResult> }`:

- `core/agent-runtime/claude-cli.ts` → spawns `claude --print --output-format json …`
- `core/agent-runtime/codex-cli.ts` → spawns `codex exec --json --cd <workspace> --model …`

Both honour the same security envelope (FACTORY_RULES rule 29 `shell: false`, rule 32 30 s default timeout, FACTORY_RULES rule 31 4 MB stdout cap), the same hook contract (`FACTORY_RUN_ALLOWLIST`, `FACTORY_RUN_ID`, `FACTORY_SERVER_PORT` env vars consumed by `pre-tool-use-hook.ts`), and emit the same lifecycle events (`agent.run-started`, `agent.run-completed`, `agent.run-failed`, `tool.timeout`, `tool.stdout-truncated`, `agent.log`). The Codex runtime tags both started/completed events with `payload.runtime: 'codex-cli'` so timeline consumers can distinguish providers.

**Codex pre-flight:** `assertCodexAuthenticated()` accepts either path: `OPENAI_API_KEY` env var (key-based auth) or `~/.codex/auth.json` on disk (OAuth via `codex login`). Throws `CodexNotAuthenticatedError` only when both are absent. Runs before mkdir or event emission. Binary resolution (`resolveCodexBinary()`) honours `CODEX_BIN` override, otherwise uses `which codex` (or `where` on Windows). Throws `CodexBinaryNotFoundError`.

**System prompt forwarding:** `appendSystemPrompt` (skill `prompt.md` content) is passed to Codex via `-c instructions="""…"""` — a TOML multi-line basic string. Newlines pass through literally; only `\` and embedded `"""` are escaped. `escapeForTomlMultilineBasic()` is exported for tests.

**Output normalisation:** `parseCodexEnvelope()` accepts either a single JSON envelope or NDJSON, picking the last terminal event with summary fields. Field aliases probed in order: `result | output | text` for the result body; `usage.input_tokens | tokens.input` for input tokens; `usage.output_tokens | tokens.output` for output tokens; `total_cost_usd | cost_usd | cost` for dollars; `num_turns | turns` for turn count. Unknown shapes degrade to zeroed cost with `costLabel: 'estimated'` — same fallback as Claude. `parseCodexEnvelope()` is exported for unit tests.

**Dispatcher:** `core/agent-runtime/select-runtime.ts` exports `selectRuntime({ configRuntime, model?, skillProvider? })`. `'auto'` picks on `model.provider` (via `providerOf()`), falling back to `skillProvider`, then to claude. Existing call sites that hard-code `new ClaudeCliRuntime()` are unchanged — the dispatcher is opt-in for new code paths (M19.11/12 dev-review, future migrations). See ADR 0036.

**Auth status UI:** `GET /projects/:slug/settings/codex-auth` returns `{ status: 'connected' | 'missing', authPath, loginCommand }`. Surfaced in Settings → Skill runtime next to the per-skill provider controls. Read-only; no interactive OAuth from the web (same constraint as Claude).

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

**`invokeSkill()` is the canonical spawn entry point** for skill-driven agent runs (`core/agent-runtime/invoke-skill.ts`). It enforces contextSchema validation before spawn and outputSchema validation after. `contextAllowlist` is required on every `SkillConfig` — no silent empty-allowlist fallback. See ADR 0038.

**Investigation Seed.** Before Wave-1 scout fan-out, `slices/investigate/workflow.ts` builds one orchestrator-owned `InvestigationSeed` via `core/agent-runtime/scout-prefetch.ts`. The seed contains capped candidate files, symbol hits, related test files, recent git touches, and prior overlapping investigation ids. Scouts receive it through the explicit `investigationSeed` allowlist key and must start from seed files/symbols before issuing new searches. This reduces cross-scout rediscovery by shared context, not by sharing #995's per-run cache across separate scout runs.

**Scout Digest Handoff.** Wave-2 scouts and the final investigate synthesis receive `scoutDigest` (`ScoutReportDigestBundle`) instead of raw `scoutReports`. Raw scout reports remain persisted in `core/scout-reports/`; consumers fetch them on demand through `repo_intel.query` with `intent: 'prior-investigation'` when the digest is insufficient for a specific finding.

**Line-Precise Handoff Context.** Investigation outputs may attach `line`, `symbol`, and short `snippet` fields to `keyFiles`, plus an optional `fixHint`. Before `implement` runs, `slices/fix-issue/workflow.ts` builds a bounded `codeContext` bundle from those line-marked key files (`core/agent-runtime/code-context.ts`) and injects it through the explicit implement allowlist. QA and Review receive `prDiffWithContext`, a diff-derived changed-file/hunk summary from `core/agent-runtime/pr-diff-context.ts`; it preserves holdout boundaries because it contains only PR diff metadata, not developer or investigation reasoning.

**Two guards, different paths:**
- `contextAllowlist: ContextKey[]` — the *manifest*. Filters which keys from `AgentSpec.context` render into the user-prompt XML. Guards against wrong keys at spec construction time. Now required (not optional) on `SkillConfig`.
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

**Body schema:** prose summary/context/suggestion for humans + structured YAML fenced block for orchestrator. The retrospector agent emits the human-facing fields only (`kind`, `target_path`, `suggestion_text`, `confidence`, optional `evidence`/`proposed_diff`). The workflow injects provenance (`source_run_id`, `source_project`, `source_work_item`, `retrospective_kind`) when persisting to DB or filing the GitHub issue — see `docs/adr/0019-retrospective-output-schema.md`.

```yaml
improvement_candidate:
  # ── agent-emitted ─────────────────────────────
  kind: skill-prompt
  target_path: skills/triage/prompt.md
  suggestion_text: Add explicit reminder to ...
  confidence: medium   # low | medium | high
  evidence: |          # optional — what surfaced this
  proposed_diff: |     # optional
  # ── workflow-injected ─────────────────────────
  source_run_id: run_01J...
  source_project: phaser-game
  source_work_item: shaunnez/phaser-game#142
  retrospective_kind: deep
```

**Dispatch routing:** `governance-suggestion` → human-only queue. All other kinds → standard supervised pipeline. The kind discriminator is the gate.

**Cross-project coalescing:** bootstrap workflow comments `Related: #N` when a new candidate matches an existing open issue's `target_path`. Coalescing is a human action, not automated. Revisit at higher volumes.

**No auto-ship at M9.** Always human-gated. Kind discriminator ready for future auto-ship gate in autonomous mode if needed.

**Labels:** `improvement:skill-prompt`, `improvement:workflow`, etc. Pre-filed at bootstrap.

## Centralized Skill Budgets (ADR 0020)

`SKILL_BUDGETS: Record<string, SkillBudget>` in `core/agent-runtime/budgets.ts` is the single source of truth for per-skill `maxTurns`, `maxBudgetUsd`, `timeoutMs`, and `modelTier`. Values are calibrated from telemetry with a 3–5× safety margin.

**Resolver:** `resolveBudgets(skill, projectBudgets?)` returns `{ budgets, modelOverride }`. Precedence: project override (`BudgetConfig.skillBudgetOverrides[skill]`) → canonical `SKILL_BUDGETS[skill]` → throws. Unregistered skills are a programming error, not a runtime condition. `maxBudgetUsd` is capped at `perWorkflowMaxUsd`.

**Default tiers:** triage / repo-match / bug-enhance / evidence-post / implement / retro-light → haiku. qa / review / resolve-conflict / playwright-repro / spec-author / retro-deep → sonnet. investigate / advise-on-plan → opus.

**Schema-validation escalation:** `SkillBudget.escalation?: { modelTier; maxBudgetUsd; ... }` defines an opt-in retry policy. `runWithEscalation` wraps `runtime.run + safeParse`; on parse failure for an escalatable skill, it retries once at the higher tier with a fresh `runId` and emits `agent.retry-escalated { stage: 'model', ... }`. Holdouts never escalate (throw `HoldoutFallbackForbiddenError`). One retry max. Currently only `implement` opts in.

**Telemetry:** `agent.run-completed` carries `turns.used` (extracted from CLI `num_turns`) alongside `turns.budgeted` and `budget.usd`, so retrospectives can compare observed vs limit.

## Code-quality audit (M19.22 #698)

`code-quality-audit` is invoked through `core/audit/run-audit.ts`. Three
triggers, one orchestration:

| Trigger              | Caller                                            | Priority gate                                |
|----------------------|---------------------------------------------------|----------------------------------------------|
| `deep-retro`         | `core/workflows/retrospective.ts`                 | `tier==='deep' && triggers.priorityHigh`     |
| `convergent-review`  | `slices/review/workflow.ts` (parallel branch)     | `workItem.priority ∈ {high, critical}`       |
| `nightly`            | `core/audit/nightly-scheduler.ts` (per project)   | all registered projects                       |

The auditor scorecard sums to `audit_score` (0..100) which is written to
the `run_quality_scores.audit_score` column. Lookups by `pipelineRunId`
upgrade an existing merge-decision row in place; nightly audits synthesise
`pipelineRunId = "nightly-<slug>-<isoDate>"` to keep the row queryable
from the trend UI without colliding with real cycles. **`audit_score` is
informational** — it does NOT feed `computeQualityScore` and the
merge-decision gate ignores it. Its job is the autonomous-mode gate:
`audit_score < 60 && mode === 'autonomous'` transitions the lifecycle to
`factory:needs-human` instead of `factory:done` / `factory:approved`. In
supervised mode the gate never fires (the human reads the audit and
decides).

The top three audit recommendations become `ImprovementCandidates` filed
through the same path as retro candidates. Mapping is structural:
`principle` mentioning "prompt" → `skill-prompt`, "config" → `skill-config`,
"schema" → `skill-schema`, "governance" → `governance-suggestion`,
otherwise → `workflow`. The auditor sets `priority`; mapping is in
`mapPrincipleToKind()`. Top-3 selection sorts by (priority, impactPoints
desc).

Events: `audit.completed`, `audit.failed`, `audit.autonomy-gate-fired`.

## Two Quality Scores — QA 8-category vs deterministic outcome (M19.21 #697)

Goose Hub records two distinct quality scores per work-item lifecycle. They
serve different purposes and must not be conflated.

**QA 8-category subjective score (per-run, written by the QA agent).**
Lives on `qa.completed.payload.qualityScores` (open/closed, conceptCount,
timeToCapability, complecting, loc, coupling, gallsLaw, cyclomaticComplexity)
plus a derived `overallScore` summed across categories. Maximum 100, default
threshold 70. This is the **agent's subjective grading** of the diff's
craftsmanship — used to gate the QA verdict (`pass` vs `partial` vs `fail`).
Example: `overallScore: 73, threshold: 70` → QA verdict `pass` for the score
gate (other rules still apply).

**Deterministic outcome score (per-cycle, written by merge-decision).**
Lives on `run_quality_scores`, written by `slices/merge-decision/workflow.ts`
right before `mergePR()` inside the approve action handler. Maximum 100,
default threshold 80. This score is **derived mechanically** from the event
stream — P0..P3 counts from QA + Review findings, harness_pass_rate from the
deterministic Tier 2 test run, `static_passed` / `uat_passed` / `review_converged`
from the pipeline's terminal events. No agent grades this; the formula is
fixed (see `docs/adr/0033-quality-score-weights.md`). Example: with
`p0_count: 0, p1_count: 1, p2_count: 2, harness_pass_rate: 0.8,
static_passed: true, uat_passed: true, review_converged: true` the formula
gives `score: 82`.

**Gate semantics differ.** The QA score gates the QA agent's verdict only.
The deterministic score gates auto-merge — `prior < 3` cycles → score-only
(`score >= 80`); `prior >= 3` cycles → score AND `isConverged([...prior.slice(-2), score], components)`.

**Both flow into retro.** Retrospectives read both. The QA 8-category score
captures "did the agent think the diff is well-crafted?"; the deterministic
score captures "did the cycle actually converge?" — they tell different
stories about the same PR and a divergence between them is itself a signal.

## Cost Module (ADR 0016)

All cost logic lives in `core/cost/`: `extract.ts` (parsers), `repository.ts` (writes), `skill-stage.ts` (skill→UI-stage mapping), `types.ts`. The `costs/` server domain only reads. Only the agent runtime appends rows, called once per successful skill run via `recordCost()`.

**`CostUsage.costLabel`** is required at construction: `'estimated'` (Claude CLI `total_cost_usd`) or `'exact'` (direct Anthropic API `usage`). The label cannot be lost in transit because it's set at parse time. `costFromCliEnvelope` always returns `estimated`; `costFromApiUsage` always returns `exact`.

**`agent_run_costs`** has a unique index on `runId` — duplicate inserts (retries, webhook redeliveries) are silently ignored. Every run produces exactly one row, even at `costUsd = 0`, so dashboards reflect every run.

**Tool-intensity telemetry** lives in `agent_run_tool_stats`, keyed one-to-one by `runId`. The agent runtime calls `recordToolStatsForRun(runId)` synchronously after `recordCost()`, aggregating `agent.tool-call` rows into read/search/write/edit counts, returned bytes, unique paths read, and redundant reads. The per-issue costs API joins these stats back onto cost rows, and a high-read outlier emits `agent.tool-intensity-anomaly` when a run exceeds 2x the same-skill p95 read baseline.

**Stages:** `triage`, `investigate`, `dev`, `qa`, `review`, `retrospective`, `other`. Stage is UI-only metadata; never influences workflow logic. Unknown skills fall into `other` (soft fallback).

**UI convention:** `~$0.04` for estimated, `$0.04` for exact. Enforced in frontend, not DB.

## Holdout Enforcement Internals (ADR 0014)

**Centralized gateway:** all context injection routes through `assembleSpawnContext()` in `core/agent-runtime/context-assembly.ts`. Single point where `spec.context` is filtered against `spec.contextAllowlist` before XML rendering.

**Constants in `context-assembly.ts`:**
- `HOLDOUT_ROLES = new Set(['qa', 'reviewer'])` — source of truth for strict-isolation roles.
- `SYSTEM_KEYS = new Set(['projectId', 'workItemId'])` — runtime-managed keys exempt from violation detection.

**Disallowed key on holdout role:** emit one `tool.violation` event per key with `{ role, disallowedKey, runId }`. Non-holdout roles silently omit disallowed keys (matches pre-M8 behaviour). The violation event is the observable signal for the M8 exit criterion.

**`HoldoutFallbackForbiddenError`** in `core/agent-runtime/interface.ts` (re-exported by `fallback.ts`): typed error thrown when `withFallback()` would otherwise down-tier a QA or Reviewer primary failure. Workflow catch blocks detect the class and transition to `factory:needs-human`.

**Retry counter** in `core/retry/retry-counter.ts`: derived from event stream (`qa.completed` non-pass, `review.completed` `needs-fix`). No new DB table — consistent with stateless-orchestrator. `DEFAULT_MAX_RETRIES = 2`. Lives in `core/retry/` so both `slices/qa/` and `slices/review/` can import without violating slice-import rules. With `maxRetries=2`, second consecutive failure escalates (the just-appended event is included in the count by design — see `slices/retry-escalate/README.md`).

## Workflows Placement (ADR 0017)

**Default:** workflows live in `slices/<name>/workflow.ts` — single-pipeline-stage logic, removable as a unit.

**Exception:** `core/workflows/` for workflows called from **two or more** server code paths that cannot be cleanly removed as a single slice. First inhabitant: `core/workflows/retrospective.ts` (called from both `apps/server/src/domains/workflows/retro-batch.ts` and `apps/server/src/domains/issues/transitions.ts`).

**Promotion rule:** start in a slice; promote to `core/workflows/` only when a second non-batch caller appears. Not a catch-all for "complex" workflows. Not the same as the (never-built) `core/orchestrator/workflows/` directory.

## Target-projects and Skills as Workspace Packages (ADR 0015)

Both `target-projects/` and `skills/` are pnpm workspace packages (`@goose-hub/target-projects`, `@goose-hub/skills`) with wildcard `"./*": "./*"` exports. Apps must import by package name; relative `../../../target-projects/` paths fail review (FACTORY_RULES rule 28a).

**Two import shapes:**
- Per-file static: `import gooseHubSelf from '@goose-hub/target-projects/goose-hub-self/project.config.js'`.
- Filesystem-root anchoring: `import { targetProjectsRoot, skillsRoot } from '@goose-hub/target-projects'` (or `@goose-hub/skills`) for `readdir` walks, dynamic config loads, sibling `repos.md` reads, `prompt.md` lookups.

`tsconfig.json` paths mirror the package mappings so editor + tsc resolve identically to pnpm at runtime.

## Tool Layer (ADR 0010)

**Bundles, not per-tool allowlists.** Skills declare `toolBundles: ['read' | 'dev-tools' | 'qa-tools' | 'validate' | 'core']`; `computeAllowlist` expands at spawn time. Since ADR 0045 Phase 5b, every agent-facing bundle is composed of `mcp__factory-tools__*` names only — native `Read` / `Write` / `Edit` / `Glob` / `Grep` / `Bash` are no longer in any default bundle. Native `Bash` is reachable only via the opt-in `emergency-debug` bundle.

**Pattern-level deny rules** (`Read(./.env*)`, `Bash(sudo *)`, `Bash(rm -rf *)`) live in `<workspace>/.claude/settings.json`, written by `writeWorkspaceSandbox()` at workspace bootstrap. Not passed as `--disallowedTools` argv — settings.json applies for any invocation in the workspace and survives process restarts.

**PreToolUse hook deployed once** to `~/.factory/hooks/` on first run (idempotent). Per-run identity carried in `FACTORY_RUN_ID` / `FACTORY_RUN_ALLOWLIST` env vars, not the hook path.

**No `bash-denylist.ts`** despite PLAN.md §6 listing it. The denylist is a constant in `sandbox.ts`. (`interface.ts` was added post-M10 as the canonical home for `AgentSpec`, `AgentRuntime`, `SkillConfig`, and `HoldoutFallbackForbiddenError` — the original note saying it didn't exist is stale.)

## Multi-project Loader and Per-project Scheduler (ADR 0021)

`core/projects/` holds two files:

- **`loader.ts`** — `loadProjects()`, `getProjectBySlug()`. Reads every `target-projects/*/project.config.ts` at startup via dynamic `import()`. Process-lifetime in-memory cache (no hot reload — restart suffices). Missing/malformed configs log a warning and are skipped; startup never aborts. Duplicate slug throws `DuplicateSlugError` eagerly. `DEFAULT_PROJECTS_ROOT` resolves relative to the compiled module's `__dirname` so the loader works regardless of cwd.

- **`scheduler.ts`** — `startPerProjectScheduler()`. One `setInterval` per project; `tickIntervalSeconds` is per-project config (default 60s). Crash or long-running workflow in project A never delays project B's tick. Error isolation per project.

**Per-project lock** stays in `apps/server/src/shared/dispatch.ts` (the `_issueInFlight` Set keyed by `(slug, issueNumber)`), not in the scheduler. The scheduler is a pure tick driver; dispatch decides what to do.

**Per-project active milestone:** each `ProjectConfig` declares its own `activeMilestone`; the Kanban filters per-project; the All Projects view aggregates across them.

## Cross-project Search (ADR 0044)

`apps/server/src/domains/search/` mounts `GET /search?q=&projectSlug=&type=&milestone=&includeClosed=&limit=` and returns a unified `SearchResult` with two banks: work-item hits and `agent.decision-summary` event hits. Both banks normalise confidence independently to top-result = 100.

**Ranker:** hand-rolled BM25-lite in `score.ts` — title × 3, milestone × 1.5, body × 1 for work items; single-text × 30 for event summaries. Both get a ±10% recency boost inside a 30-day window. `#234` → externalId direct-hit score (1000). Swap to SQLite FTS5 behind the same `scoreItem` interface when the corpus demands it.

**Fan-out cache:** 60s TTL memo in `cache.ts` keyed by `(slug, 'open'|'closed', milestoneNumber)`. Coalesces bursty typing across multiple registered projects so search doesn't re-hit GitHub on every keystroke.

**URL mount note:** server is at `/search` (no `/api` prefix) so the vite dev proxy's `rewrite: (p) => p.replace(/^\/api/, '')` resolves to a real route. The existing `/api/changelog` / `/api/decisions` routes are reachable in production but 404 under the dev proxy — separate concern.

**Holdout discipline:** search reads post-redaction event payloads through `eventStore.replay`. It does NOT touch raw decision-summary text from agent runs; it's a post-emission consumer.

## Skill File Convention (ADR 0022)

Every skill in `skills/<name>/` uses `prompt.md` (Markdown instructions) and `skill.config.ts` (SkillConfig with role, contextSchema, toolBundles, modelTier, budgets). All prompt loading routes through `readPromptWithContext(skillName, projectSlug)` in `core/agent-runtime/read-prompt.ts`, which appends `target-projects/<slug>/agent-context/<skillName>.md` if the overlay file exists. Per-project overlays are now available to every skill, not just orchestrator-side ones. The CLI's `run-agent` command takes an optional `--project=<slug>` flag for the same overlay path. Resolved at M11.

## factory-tools MCP server (ADR 0045)

Spawned agents do not receive native `Read`, `Write`, `Edit`, `Glob`, `Grep`, or broad `Bash`. They receive Factory-owned MCP tools under the `mcp__factory-tools__` prefix that take intent (path, project, kind), not commands. Factory builds the argv, validates the path, caps the output, and emits the audit event.

Per-run MCP config lives at `<worktree>/.factory/mcp-config.json`, written at spawn time and torn down with the worktree. This replaces the singleton `~/.factory/mcp-config.json` used today by `claude-cli.ts` / `codex-cli.ts` (which stomp each other under concurrent spawns).

The server reads its identity from env: `FACTORY_RUN_ID`, `FACTORY_PROJECT_ID`, `FACTORY_WORK_ITEM_ID`, `FACTORY_WORKSPACE_DIR`, `FACTORY_SERVER_PORT`. The agent receives none of these. Tools never accept a `workspaceRoot` argument.

Path policy denylist: absolute paths, `..`, `~`, `.codex`, `.agents`, `.claude`, `.factory`, parent dirs, sibling worktrees. The policy is enforced in `mcp/path-policy.ts` as a denylist-first wrapper over `canonicalizeFactoryToolPath` from `core/tool-layer/path-contract.ts`; path resolution is not duplicated. Command policy: `spawn(cmd, args, { shell: false })`, capped output, per-tool timeout, typed `{ status, exitCode, stdout, stderr, durationMs, truncated }` return.

Every path-bearing tool response returns the structured `RepoRelativePath` shape (`{ path, root, packageRoot?, normalizedFrom? }`) from `core/tool-layer/path-contract.ts`, not a bare string. Package-relative inputs are normalized when uniquely resolvable; ambiguous inputs return a `PathPolicyViolation` with `code: 'ambiguous_path'`.

Every tool call emits `agent.tool-call`. The audit payload is normalized via `core/tool-layer/tool-call-audit.ts` (`normalizeToolCallAuditPayload`) so every path-bearing event carries `raw_path` + `canonical_path`. Every blocked call emits `agent.tool-call` with `blocked: true` and a reason code. Workflow-owned mutations (commit, open PR, transition, publish evidence) are not exposed to normal bundles; the orchestrator drives them.

Read-side MCP tools use a process-local per-`FACTORY_RUN_ID` cache in `core/tool-layer/mcp/run-cache.ts`. `read_file`, `read_many_files`, `list_dir`, `list_files`, `search_text`, and `repo_intel.query` are cached; cache keys are built from canonical tool paths plus the arguments that affect output. Cached hits still emit `agent.tool-call` with `cached: true`. `write_file`, `edit_file`, `apply_patch`, `move_file`, and `delete_file` invalidate overlapping read/list/search entries, and `agent.run-completed` / `agent.run-failed` evict the whole run cache. This never crosses separate scout or synthesis runs.

Duplicate-call nudges are advisory only. `core/tool-layer/mcp/run-cache.ts` tracks identical cache-key calls per run and marks `agent.tool-call` with `duplicateCount` from the second call onward; at the configured threshold (`FACTORY_DUPLICATE_NUDGE_THRESHOLD`, default 3) the PostToolUse hook forwards a one-line `additionalContext` reminder. The hook never blocks, denies, aborts, or fails duplicate calls.

**Repo Intelligence Tool.** `mcp__factory-tools__repo_intel.query` is the preferred structured lookup before grep. It dispatches to existing harness helpers for `find-symbol`, `find-callers`, `find-tests-for`, `related-files`, `recent-changes`, `prior-investigation`, and `fetch-artifact`. Path-bearing inputs still go through MCP path policy. `recent-changes` reuses #996's `gitRecentChanges()` helper. `agent.tool-call` audit includes `repo_intel_intent` so telemetry can break down usage by intent. QA/review holdout callers receive prior-investigation and artifact payloads with decision-summary/implementation-reasoning fields stripped.

`core/tool-layer/tools/{read,write,bash,test}.ts` and their tests have been deleted (Phase 7 cleanup complete). `core/tool-layer/tools/record-decision.ts` is the surviving helper, wrapped by `mcp/tools/context.ts`.

## Flagged ambiguities

- **Decision-summary two-stream split**: resolved. Canonical record lives in schema field; live markers from `[decision]` footer in `prompt.md`. Tool-call audit is a third, separate stream. All three distinct concerns at distinct cadences.
- **Decision-summary `kind` taxonomy**: resolved at M9 (#466). Free-text `step` promoted to a controlled `DecisionKindSchema` enum in `core/agent-runtime/decision-types.ts`, consumed everywhere through `core/retrospective/schemas.ts`. Live-marker grammar is `[decision] KIND: <summary>`. See `docs/adr/0018-decision-kind-taxonomy.md`.
- **Holdout fix-or-register**: resolved at M9 (#468). Every error-severity QA finding and blocker-severity Review finding must declare `disposition` (`fixed` | `registered` | `out-of-scope`) and a matching `dispositionRef`. Shared `DispositionSchema` lives in `core/findings/disposition.ts`.
- **Retrospective output schema drift**: resolved post-M9 maintenance fix. Light and deep tiers now share `RetroOutputBaseSchema` with one canonical `summary` object shape (`{wentWell, didNotGoWell, architecturalTakeaway}`) and one `ImprovementCandidate` shape. DB-layer fields (`id`, `sourceRunIds`, `exampleRunIds`, `surfacedAt`, `computedAt`) and provenance (`sourceRunId/Project/WorkItem`) are stripped from agent output — workflow injects provenance at persist time. `safeParse` failure now emits `agent.run-failed` and transitions to `factory:needs-human` instead of swallowing silently. See `docs/adr/0019-retrospective-output-schema.md`.

## Deferred / Open Questions (to resolve at their milestone)

- **M8 historical handoff**: archived under `docs/archive/legacy/m8-handoff.md`. Do not use it as active guidance.
- **M11 (in flight)**: dependency parser shipped as `core/state-source/dependency-parser.ts` (PR #497, M11.01). The parser is colon-tolerant, supports `Depends on`, `Depends-On`, `Blocks`, `Blocked by`, and same-repo + `owner/repo#N` cross-repo refs, returning typed `DependencyRef`. Still pending in M11: scheduler dependency-satisfaction filter, `factory:blocked-by-dependency` surface, UI dep-state visibility, move-with-dependencies CLI/UI, unregistered cross-repo escalation, multi-parallel project-lock relaxation (ADR for FACTORY_RULES rule 14 wording change), and integration tests.
- **M12**: Governance PR check CI wiring — how does `core/governance/pr-check.ts` get access to the PR diff and labels in GitHub Actions?
- **Post-v0**: Claude CLI vs Claude Agent SDK — reference audit (#10) said "compare honestly." SDK lacks subprocess overhead and suits non-coding skills (triage, retro) better. Revisit when v0 ships.

## Monorepo import convention (established M2)

`core/` is the `@goose-hub/core` workspace package. Apps (`apps/server`, `apps/cli`) import it as:

```ts
import { ... } from '@goose-hub/core/state-machine/states.js';
```

Never via `../../../core/` paths. The wildcard export `"./*": "./*"` in `core/package.json` covers all subpaths. New top-level directories imported by multiple apps must get their own `package.json` with `"name": "@goose-hub/<name>"` before the first cross-app import is written (per FACTORY_RULES.md rule 28a).
