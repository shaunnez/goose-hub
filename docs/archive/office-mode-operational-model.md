# Goose Hub Office Mode — Operational Model

This document is the operational-model analysis behind the next iteration of Office Mode (the pixel-art simulation of agent activity in `apps/web/src/components/office/`). It is **not** a visual design — it's the system-architect / game-systems-designer / observability-platform layer that the visual design must serve.

It is grounded in the real codebase (state machine in `core/state-machine/`, event taxonomy in `core/event-stream/`, role union in `core/types.ts`, M19 swarm contracts in `skills/scout-*/`, `skills/wave2-*/`, `skills/spec-author/`, holdout rules in `core/agent-runtime/holdout-validator.ts`, etc.). Quotes and enums match the source as of the M19-active milestone window.

The single most important reframe from M17: **the worker is the persona, not the role.** Geese are persistent characters with codenames; they pick up issues and carry them between rooms. The "one developer desk" model in M17 collapses 3 persona instances into one and erases the round-robin pattern that's literally encoded in `personaRouting.lastIndex`.

---

## Section 1 — Core Entities

Goose Hub has *four classes* of entities, not the flat "issue + agent" model the kanban currently suggests.

### 1A. Persistent entities (they survive ticks; the system reasons about them)

- **Project** — top-level container. Owns a `BudgetConfig`, a `Mode` (interactive / supervised / autonomous), a stack profile, an active milestone. Persistent. Spawns *everything* below it. Visualisation: should be a **place** (a floor), not a label.
- **Milestone** — a project-scoped bucket of work items, GitHub-native. Persistent. Doesn't own behaviour, owns *scope*. Visualisation: a **time-bounded room or palette tint**, not a goose. Banner / season change on the floor.
- **WorkItem (Issue)** — the unit of work. Owns `state` (one of 26), `priority`, `type`, `mode`, `parentId`, `dependsOn[]`, `blocks[]`, `schedule`. The state machine drives a WorkItem; the agents are *transient consumers* of it. Persistent on GitHub + indexed in SQLite. Visualisation: a **physical object** (card, ticket, folder) that gets *carried*. The WorkItem is not the goose. The goose is whoever's currently holding it.
- **SubIssue / Child** — created by decomposition. Same shape as WorkItem with `parentId` set. Persistent. Visualisation: same as WorkItem but tinted by parent.
- **Persona** — `projectId/role/slotIndex` (3 per role per project), assigned a `codename` once (e.g. "Grey Honker (DEV)"), round-robin selected. **Personas are the durable workers; they outlive issues.** Persistent. Visualisation: each persona deserves a **named goose with a stable appearance**.
- **EngineeringSpec (M19)** — JSON blueprint authored by `spec-author`: Journeys, WorkPackages (filesOwned + dependsOn + builderTier), ExecutionBatches, AcceptanceCriteria. Tied to a `pipelineRunId`. Persistent. Visualisation: a **document object** posted on a board that drives parallel builders.
- **WorkPackage** — child of EngineeringSpec. Owns a set of files (no overlap with siblings), a builder tier, a dependency on other WPs. Persistent. Visualisation: a **named sub-ticket** clipped to the spec.
- **ScoutReport** — Wave-1 output, one per scout-skill per investigation run. Persistent in SQLite. Visualisation: a **sealed envelope / report folder** emerging from the library, pinned to the investigation board.
- **QualityScore** — per-`pipelineRunId`, score 0–100 with components (`p0_count`, `regressions_open`, `review_converged`, etc.) + an informational `auditScore`. Persistent. Visualisation: a **dial / gauge** in the merge-decision area; *not* attached to a goose.
- **ImprovementCandidate** — retro/audit output, kind ∈ {skill-prompt, skill-schema, workflow, persona, ...}, status ∈ {pending, approved, rejected}, optional `githubIssueUrl` once promoted. Persistent. Visualisation: **notebook pages on a corkboard in a backstage room**. The meta-narrative; the company gets smarter here.
- **CostRecord** — per run, per skill, per persona, per model. Persistent. Visualisation: **never directly**. Aggregate into a budget board.
- **Event** — immutable, ~90 kinds, SQLite-backed, SSE-streamed. Persistent. Drives every animation. Not visualised as an entity; rendered as *consequences*.
- **DependencyEdge** — parsed from issue body (`depends-on: #N`, `blocks: #M`). Persistent (in WorkItem.dependsOn / .blocks). Visualisation: **threads / chains** between issue cards in the in-tray.
- **Worktree** — `~/.factory/workspaces/<runId>/`. Persistent for the duration of a run, ephemeral conceptually. Visualisation: **invisible** (or the goose's "desk drawer").

### 1B. Transient runtime entities (alive only during a tick)

- **AgentRun** — one invocation of one skill by one persona on one work item. Lives seconds to ~10 minutes. Emits `agent.run-started` → many `agent.tool-call` + `agent.decision-summary-live` → `agent.run-completed | failed | cancelled`. Visualisation: **the goose is "lit" / animated** during the run; quiet between runs.
- **Wave** — a batch of parallel scout AgentRuns (M19.01). Wave 1 = 6 scouts (cap), Wave 2 = up to 2 deep agents. Transient. Visualisation: **a flock formation**, not 6 individual labelled geese (except at hero zoom).
- **ParallelBuildIteration** — one round of N parallel builders trying to satisfy an EngineeringSpec (M19.03). Bounded by retry config. Transient. Visualisation: **multiple builder geese all tethered to the same parent issue**; tether colour matches the spec.
- **ReviewRound** — one round of convergent review (M19.13). ≥2 reviewers, repeats until 2 consecutive rounds with 0 new CRITICAL findings. Transient. Visualisation: **silhouettes inside the frosted Review chamber**; round count on the door, not the geese.
- **DispatchLock** — concurrency primitive in `parallelLock`. Counts in-flight per project. Transient. Visualisation: **not directly**; manifests as queue depth at the front of each room.
- **ToolInvocation** — every `agent.tool-call`. Sub-second. Hundreds per run. Visualisation: **micro-animations only** (keyboard typing, drawer pull, monitor flicker). Never a sprite.

### 1C. Meta entities (taxonomy primitives; not instances)

Named sets, not objects. The vocabulary the system reasons in.

- **Role** (12: triager, griller, prd-writer, decomposer, researcher, investigator, developer, dev-reviewer, qa, reviewer, retrospector, auditor) — visualised as **room assignment**, not as a goose-type, because the goose is always a persona instance of a role.
- **Skill** (39 in `/skills/`) — versioned recipe = prompt + schema + config. Visualisation: **not directly** — the skill manifests as the action the goose performs.
- **ToolBundle** — capability cluster (read/write/validate/playwright/...). Not directly visualised; affects what kinds of micro-animations a goose can do at its desk.
- **StateName** (26) — drives the state machine. Visualised *spatially* — each state belongs to a room or sub-zone.
- **DecisionKind** (48: READ / PLAN / RED / GREEN / REFACTOR / LINT / COMMIT / STRUCTURAL_CHECK / ... / BLOCKER / UNCERTAINTY / ...) — drives thought-bubble glyphs.
- **ModelTier** (haiku / sonnet / opus) — affects persona run cost and behaviour. Visualisation: **subtle persona styling** (size, halo, pace). A haiku scout is small and fast; an opus investigator is larger and more deliberate.
- **Mode** (interactive / supervised / autonomous) — global tone of the simulation. Visualisation: **ambient palette + lighting**.

### 1D. Funnel sources (origin points; non-persistent themselves)

The system has multiple inlets for work. Each deserves a *visible doorway* into the office because the source colours the issue's first hops.

- **Inbox** (`apps/server/src/domains/inbox/`) — SQLite staging table, promoted to a GitHub issue. Visualisation: a **drop box in the lobby**; courier carries it upstairs.
- **GitHub webhook** — issue created/labelled externally. Visualisation: an item **dropped through a roof skylight** or pneumatic tube — comes from outside.
- **Decomposition output** — children of a PRD'd parent. Visualisation: spawned **from the decomposer's desk** during the decomposition animation.
- **Retro / audit promotion** — an `improvement_candidate` becomes a new factory issue. Visualisation: **walks out of the backstage coach office** carrying a notebook page. (The meta loop made physical.)
- **Research lane** (future) — researcher-originated work item. Visualisation: from the research desk.

### Entity-class summary

| Class | Lifetime | What it deserves visually |
|---|---|---|
| Project | persistent | A floor (place) |
| WorkItem | persistent | A ticket (object) |
| Persona | persistent | A named goose |
| EngineeringSpec / WorkPackage | persistent | A board / clipped sub-tickets |
| ScoutReport | persistent | A sealed envelope |
| QualityScore | persistent | A gauge / dial |
| ImprovementCandidate | persistent | A corkboard note (backstage) |
| AgentRun | transient | Lighting on the persona |
| Wave | transient | Flock formation |
| ReviewRound | transient | Silhouettes through frosted glass |
| Event | persistent (data) | Animation triggers only |
| Role / Skill / DecisionKind | meta | Vocabulary, not objects |

---

## Section 2 — Workflow Graph (the real one)

26 states grouped into 9 *phases* that map cleanly to spatial regions.

### Phase A — Intake
States: `triaging`, `accepted`, `rejected`
- Entry: WorkItem appears (inbox promotion, webhook, decomposition output, retro promotion).
- Exit: routes to one of {grilling, investigating, dev-ready, research-pending} based on type + triage skill output.
- Rollback: rare — accepted → archived, rejected terminal.
- Concurrency: triage-batch processes all triaging items in parallel within `maxParallelAgents`.
- Gates: none.
- Retry: triage retries on failure (capped).
- Cancellation: a triaging item can be moved to rejected by the triager.
- **Visualisation: room-worthy.** "Triage corner" near the elevator/lobby on each floor. Items pile up here until processed.

### Phase B — Discovery
States: `grilling`, `prd-drafting`, `prd-review`, `decomposing`, `issues-created`
- Entry: from accepted (feature type).
- Exit: issues-created → done (parent terminal) or dev-ready (single-tracked PRDs).
- Rollback: `gate-pending → grilling` is the human-escalates-back edge.
- Concurrency: multiple work items can be in different discovery sub-states simultaneously.
- Gates: `prd-review` is a *human gate* — Approve / Revise / Decline.
- Retry: PRD revision loops via `prd-review → ... → prd-review` (M11 three-path PRD flow).
- Cancellation: any discovery state → archived.
- Timeout: grill has max-turns budget.
- **Visualisation: room-worthy ("Discovery suite").** Sub-zones: conversation pit (grilling), drafting table (PRD writer), critique wall (PRD review), splitting bench (decomposition). Don't give each a floor — they're one connected workshop.

### Phase C — Research / Investigation
States: `research-pending`, `research-complete`, `investigating`, `investigation-complete`, `gate-pending`
- Entry: from accepted (bug, research) or from spec/dev re-entry.
- Exit: `dev-ready` (high confidence) or `gate-pending` (low confidence).
- Rollback: gate-pending can re-enter grilling.
- **Concurrency: nested — one investigator owns the issue, but inside, Wave-1 spawns 6 parallel scout runs (separate fan-out cap, doesn't consume the per-issue slot), then 2 Wave-2 runs.**
- Gates: `gate-pending` is the *confidence gate* — explicit human approval.
- Retry: per scout.
- Cancellation: investigator timeout → needs-human.
- **Visualisation: floor-worthy zone with a sealed sub-room.** "Investigation Lab" (open) + "Library" (closed, holdout-ish — scouts get `freshContext: true`). The lab is where the lead investigator sits; the library is where scouts go to dig. The wave fan-out is the most photogenic moment in the system; it deserves a real ritual.

### Phase D — Build Prep
States: `dev-ready`, `spec-ready`
- Entry: from investigation/research/discover.
- Exit: in-progress.
- **`spec-ready`** is the M19 fork: Wave1 + Wave2 + spec-author have produced an EngineeringSpec, ready for *parallel build*. `dev-ready` is the M16-era single-builder path.
- Concurrency: spec-author runs once per issue.
- Gates: none (the spec is the gate's *output*, not its trigger).
- **Visualisation: a single drafting booth ("Spec booth") + a bulletin board for the EngineeringSpec.** The conductor's stand. WorkPackages get tacked up here for builders to claim.

### Phase E — Build
States: `in-progress`
- Entry: from dev-ready, spec-ready, or needs-fix.
- Exit: needs-qa.
- **Concurrency: one builder for dev-ready path; N parallel builders for spec-ready path (one per WorkPackage in the current ExecutionBatch).**
- Retry: M19.03 `parallel-implement.iteration-started/exhausted`.
- Cancellation: budget exceeded → needs-human.
- Timeout: per-skill `timeoutMs`.
- **Visualisation: floor-worthy "Dev floor" with multiple desks.** Each desk is a persona. When parallel-build fires, 3+ builders work simultaneously, all tethered to the same parent (visual ribbon). TDD loop animates via `DecisionKind` glyphs: RED → GREEN → REFACTOR → LINT → COMMIT.

### Phase F — Verify (Holdout)
States: `needs-qa`, `qa-failed`, `needs-fix`
- Entry: needs-qa from in-progress.
- Exit: needs-review (pass) or qa-failed (fail).
- **Holdout: QA sees only `{workItem, prDiff}` — no dev reasoning. Encoded in `findHoldoutContextLeaks` and the skill's `contextAllowlist`.**
- Concurrency: qa-batch runs multiple QAs in parallel.
- Retry: M19.19 three-tier verification (structural → functional → regression). Failure at any tier triggers `qa.<tier>-failed`.
- Gates: at >2 retries, escalation to needs-human (M19.20).
- **Visualisation: a sealed room ("QA chamber") with 3 visible stations inside.** Items enter via a slot, verdict scrolls emerge. The contract is *visible* — you can see motion but not detail. Retry counter on the door.

### Phase G — Review (Holdout)
States: `needs-review`, `approved`, `merge-conflict`
- Entry: from needs-qa (pass) or merge-conflict resolution.
- Exit: approved → retrospecting; merge-conflict → done (or back).
- **Holdout: Reviewer sees only `{workItem, prDiff, qaVerdict}`. Convergent review (M19.13) runs ≥2 reviewers per round, rounds repeat until 2 consecutive rounds with 0 new CRITICAL findings. M19.21 gates merge on `QualityScore`.**
- Concurrency: review-batch + parallel reviewers per item.
- Gates: human rejection from needs-review → rejected (terminal). Merge-decision gate on QualityScore.
- **Visualisation: a frosted "Review chamber" + a gauge on the door (the QualityScore dial).** Convergent rounds are silhouettes through the glass; round count surfaces as a counter.

### Phase H — Learn
States: `retrospecting`
- Entry: after merge.
- Exit: done.
- Concurrency: retro-batch.
- **Visualisation: a "Retro room" with a debrief table.** Critically, retro produces ImprovementCandidates that get pinned to a **backstage corkboard** — the *only* place where the meta-loop ("the company learning") is visible. Worth budgeting screen real estate for.

### Phase I — Terminal
States: `done`, `archived`
- **Visualisation: a "Done shelf" + an "Archive cabinet."** Items walk in, never walk out.

### Phase J — Stuck (orthogonal)
State: `needs-human`
- Entry: from *any* state when an agent times out, budget exhausts, or an autonomy gate fires.
- Exit: human routes back to `dev-ready | needs-qa | triaging | rejected | archived`.
- **Visualisation: in-place, not a separate room.** The goose carrying the issue freezes at their desk, holds up a `?`. Spotlight on them; ambient lighting dims. A lobby bell rings (UI notification). The most important emotional moment in the sim.

### Floor / room / abstract decision

| Phase | Spatial weight |
|---|---|
| Intake | Room (corner near elevator) |
| Discovery | Room (workshop suite) |
| Research / Investigation | **Floor-worthy zone** — lab + sealed library |
| Build prep (spec) | Booth + board |
| Build | **Floor-worthy** — multiple desks, parallel-build is the headline |
| Verify | Sealed room (holdout) |
| Review | Sealed room (holdout) + gauge |
| Learn | Room + backstage corkboard |
| Terminal | Shelf / cabinet |
| Stuck | Overlay, not a place |

The temptation is to give every state its own physical zone. That's wrong — adjacent states in a phase share workshops. The state machine's *transitions* are what need to be visually traversable; the states themselves are positions within a room.

---

## Section 3 — Agent Types (archetypes)

Twelve roles, but they fall into six behavioural archetypes that should each have a distinct visual register.

### Archetype I — Classifiers (short-lived, decisive)
**triager, repo-match** — single-turn skills that emit a label and exit. Haiku-tier usually. They don't "work" so much as *judge*. Multiple can run concurrently within a batch.
- Visualisation: a goose that walks in, stamps a card, walks out. No long sitting. At a podium near the door of each room rather than a permanent desk.

### Archetype II — Conversationalists (multi-turn, gated)
**griller** — runs over many turns with explicit human-in-the-loop (`grill.question-posted`, `grill.completed`, `grill.decision-crystallized`). Owns the issue across user replies.
- Visualisation: a goose at a conversation pit / coffee table, with a thought bubble that *waits* and reacts to incoming human input.

### Archetype III — Authors (long-running, persistent output)
**prd-writer, decomposer, spec-author** — produce structured documents (PRD JSON, child issue lists, EngineeringSpec). Sonnet-or-opus. Run once per item.
- Visualisation: drafting tables. Output is a *visible* artefact that gets posted somewhere (PRD on critique wall, spec on builder board, children on the floor's triage corner).

### Archetype IV — Investigators (read-heavy, swarm-capable)
**investigator, researcher, scout-* (6 scouts), wave2-interface-designer, wave2-risk-analyst** — read code, search, file structured findings. Investigator is the lead; scouts are sub-investigators with `freshContext: true`; Wave-2 specialists are the cross-validators.
- Visualisation: tiered. Lead investigator at an open desk; scouts emerge from + return to the sealed library (holdouts); Wave-2 specialists are taller / more visually distinct (sonnet-tier).
- **Spawn behaviour: a single investigator can spawn 6 scouts in parallel + 2 Wave-2 agents. The only role that "summons" others. Worth a dedicated animation.**

### Archetype V — Builders (long-running, file-modifying)
**developer, dev-reviewer, qa, reviewer, retrospector** — operate on a worktree, write files, run tests, post evidence.
- Builder geese are the longest-running and the most *active*. Their micro-animations (TDD loop via DecisionKind) carry most of the ambient liveness of the simulation.
- **QA and Reviewer are holdouts** — they get sanitized context. The seal on their rooms is the visual contract. This needs to be readable at a glance: a player should look at the QA door and understand "no one in there knows what the dev was thinking."

### Archetype VI — Watchdogs (eventful, rare)
**auditor** — runs at autonomy-gate moments. Never sits at a desk; perches in a *watchtower* and only descends when an audit fires. M19.22.
- Visualisation: a tower above the building. Spotlight goose. Off-screen 99% of the time. When it lights up, everything else fades.
- **retrospector** is *not* a watchdog — it's a builder that operates after-the-fact. Different room.

### Persistence rule
A persona instance (`projectId/role/slotIndex`) is **permanent**. An AgentRun is ephemeral. The goose-as-character persists across many issues and many runs. They accumulate identity. A persona that has shipped 50 issues should feel different from a fresh one (subtle: tiny win counter on their desk, or a streak badge). The infrastructure for this exists (persona stats are stored), and showing it cheaply is what makes the "tiny company" fantasy land.

---

## Section 4 — Swarms / Waves

The M19 swarm orchestration is the system's most distinctive operational pattern and the one current visualisations miss entirely.

### The investigation swarm (Wave 1)
- One investigator owns the issue.
- Investigator dispatches **6 scout runs in parallel** (canonical roster: schema, code-path, pattern, test-inventory, dependency, user-journey). Each scout has `freshContext: true` — no shared reasoning — and a tight haiku-tier budget.
- Each scout emits a structured ScoutReport (file:line citations).
- Cap is `maxScoutAgents` (default 6), separate from `maxParallelAgents`. Scouts **do not consume** per-issue dispatch slots.

### The cross-validation step
- Orchestrator step between Wave 1 and Wave 2 reads all ScoutReports and flags contradictions.
- Pure orchestrator logic — no agent.
- Emits `swarm.wave-completed` or `swarm.wave-incomplete`.

### The deep wave (Wave 2)
- 1–2 Wave-2 agents (Interface Designer, Risk Analyst) consume all Wave-1 reports and produce paste-ready blueprints (Zod schemas, function signatures, risk matrices).
- Sonnet-tier. Holdout-flavoured (also `freshContext: true`) — they see scout outputs but not the investigator's own reasoning.

### Spec authoring
- `spec-author` consumes Wave 1 + Wave 2 + AcceptanceCriteria → emits an **EngineeringSpec** (JSON: Journeys, WorkPackages with `filesOwned` no-overlap, ExecutionBatches, risk register).
- The **conductor's score**. Everything downstream consumes it.

### Parallel build (M19.03)
- Builders are spawned per WorkPackage in the current ExecutionBatch. Multiple builders can run **simultaneously on disjoint files**.
- Each emits `parallel-implement.wp-started → .wp-committed | .wp-failed | .wp-timeout`.
- Iteration semantics: failed batch → retry, capped at config.

### Convergent adversarial review (M19.13)
- ≥2 reviewers in Round 1. Both holdouts. Topic-aware: `auth | session | crypto | secret` requires ≥3 rounds.
- Rounds continue until **2 consecutive rounds with 0 new CRITICAL findings**.
- Emits `review.wave-completed`, `review.converged`, `review.escalated`.

### Disagreement / failure modes
- Wave-1 contradictions → cross-validation flag → either Wave-2 resolves, or the issue routes to `needs-human`.
- QA tier disagreement → `qa.tier-disagreement` event.
- Parallel-build exhaustion → `parallel-implement.exhausted` → needs-human.

### Visualisation contract

The wave is the cinematic core of the office sim. It deserves a *ritual*:

- **Wave 1 fan-out** is the most photogenic moment. The investigator stands at the lab; 6 scouts emerge from the library (or fly *into* the library); they work in parallel for a few seconds; then they emerge holding scrolls. The pattern is **expand → work → converge → cross-validate**. A flock formation is the right abstraction at scale, but at the "hero task" zoom level, all 6 scouts should be individually visible.
- **Wave 2** is two geese walking *into* the library after Wave 1 returns. Smaller event.
- **Spec posting** is a moment: the spec-author walks the EngineeringSpec to the builder board and pins it.
- **Parallel build** is multiple builders all running TDD loops, each on their own desk, **visually grouped by a colored tether back to the parent issue** so you know they're collaborating. The work-package ribbon is the *most novel* visual primitive in the system — there's no kanban analog.
- **Convergent review rounds** are silhouettes through frosted glass with a round counter on the door. When `review.converged` fires, the door opens.

The wave / spec / parallel-build / convergent-review chain is what makes the office sim worth building. Without it, you're just animating a kanban. With it, you have a *factory floor*.

---

## Section 5 — Configuration Model

Per-project config sits in `target-projects/<slug>/project.config.ts` and is mostly immutable (FACTORY_RULES rule 5).

| Config | Effect | Should the office show it? |
|---|---|---|
| `mode` (interactive / supervised / autonomous) | Whether human gates auto-advance | **Yes** — ambient palette / lighting. Autonomous = night-shift palette; supervised = day; interactive = brighter, more "human present" cues. |
| `maxParallelAgents` | Per-project issue concurrency cap | **Yes** — number of "active workstations" on the floor. cap=1 → at most 1 active dispatch; cap=4 visibly busier. |
| `maxScoutAgents` | Per-issue scout fan-out cap | **Yes** — number of library scout desks. Cap=6 → 6 scout desks. |
| `maxRetries` | Per-skill retry budget | **No** (numeric ambient, surface only on escalation). |
| `perWorkflowMaxUsd` / `perAgentMaxUsd` | Run-level USD caps | **No directly**, but visible as a *budget board in the lobby* (aggregated). |
| `dailyTokens` | Project daily token cap | **Yes** — visible as a daily gauge in the lobby. At 80% consumed, ambient yellow. When exceeded, the floor pauses. |
| `rolesModels` (per-role primary/fallback/advisor tier) | What model tier each role's persona runs at | **Yes — subtle persona styling.** Haiku personas smaller / faster; opus larger / slower; advisor visible as a *halo* or *shadow* hovering over an agent when active. |
| `skillBudgetOverrides` | Per-skill budget tweaks | **No** — invisible config. |
| `allowHoldoutOverride` | Whether human can override a holdout verdict | **Yes** — visible as a "human override" panel on the QA / Review doors when true. |
| `fallbackPolicy` per priority | When to allow down-tier model fallback | **Indirectly** — visible as `agent.fallback-triggered` events firing (a small "downshift" indicator). |

### Fixed (not configurable but visible)
- The **state machine** itself (26 states, transitions) — fixed code.
- The **skill catalogue** (39 skills) — fixed code.
- The **role roster** (12 roles) — fixed code.
- Persona codename pool (30 names) — fixed code.

### Modal tone

Each `mode` should carry a strong tonal signature because it changes the *meaning* of agent activity:

- **interactive**: bright daylight, lobby phone rings often, human icon visible. "I am here, watching."
- **supervised**: warm daylight, occasional phone rings. "I'll check in periodically."
- **autonomous**: dusk → night palette, only active rooms lit, watchtower beacon visible. "The office runs itself; I check the logs in the morning." When the audit gate fires in autonomous, the building flashes red — emotionally distinct from any other event.

---

## Section 6 — Event Stream

90+ event kinds. Tier by visual cost.

### Tier 1 — Cinematic (camera moves, sound, full-screen overlay possible)
Events worth interrupting the player's attention for.
- `gate.awaiting-human` — issue is stuck on you. Spotlight + lobby bell.
- `audit.autonomy-gate-fired` — auditor descends. Building flashes red. Pause animation budget.
- `project.budget-exceeded` — floor goes amber, all dispatch pauses.
- `pr.merged` — small celebration (the goose walks the issue to the Done shelf).
- `merge.conflict-unresolvable` — red rotating beacon at the merge-conflict room.
- `parallel-implement.exhausted` — entire builder squad stops; tether goes red.
- `audit.failed` — auditor's beacon stays lit.

### Tier 2 — Notable (animation + indicator update, no interruption)
- `state.transitioned` — goose walks between rooms.
- `agent.spawned` / `agent.terminated` — goose appears at desk / leaves.
- `agent.run-completed` — desk-light dims; goose returns to idle.
- `agent.run-failed` — desk-light flashes red briefly; counter increments.
- `agent.fallback-triggered` — small "downshift" indicator over the goose (model tier dropped).
- `swarm.wave-completed` / `.wave-incomplete` / `.wave-halted` — scouts return to library; door opens / stays sealed.
- `qa.structural-passed` / `.functional-passed` / `.regression-passed` (or `-failed`) — verdict scroll emerges from QA chamber; tier marker on the scroll.
- `review.converged` — review chamber door opens, work item exits.
- `review.escalated` — door stays sealed; counter on door climbs.
- `pr.opened` — PR card appears on the dev desk.
- `merge.conflict` — work item moves to merge-conflict alcove.
- `decompose.completed` — parent issue spawns N children (animated).
- `prd.approved` / `.rejected` / `.revised` / `.declined` — verdict on the PRD critique wall.
- `grill.question-posted` — griller's thought bubble pulses; waits for human.
- `coach.completed` — backstage corkboard gets a new pinned note.
- `retrospective.completed` — retro room empties; corkboard updates.

### Tier 3 — Ambient (micro-animation only)
- `agent.tool-call` — a single keystroke / drawer pull / monitor flicker at the goose's desk. **Hundreds per run.** Batch into ambient motion; never spawn an individual sprite.
- `agent.tool-result` — same as above; brief outcome flash.
- `agent.decision-summary-live` — thought bubble with `DecisionKind` glyph. RED / GREEN / REFACTOR / LINT for builders is the visible TDD heartbeat.
- `agent.log` — invisible; available in a per-goose log overlay if the player clicks.
- `agent.model-selected` — tier badge on the goose updates.
- `parallel-implement.wp-started` / `.wp-committed` — each builder gets a small per-WP indicator.

### Tier 4 — Background only (no animation)
- `tool.stdout-truncated`, `tool.timeout`, `system.note`, `tool.violation` — log only. Surface in a "system notices" panel.
- `dev-review.budget-skipped`, `prd.advisor-skipped` — log only.

### Sonic / haptic

Calm-ambient environment by default. Two sound categories:
- **Ambient layer** — soft keyboard clicks, distant chatter, occasional desk-bell. Constant.
- **Event chimes** — gate-pending bell (the only "interrupt" sound), pr.merged chime (gentle), audit beacon (lower, more serious).

Reserve sound for **emotionally distinct moments** — overuse kills the calm.

---

## Section 7 — Visual Priority at Scale

50–500 simultaneous issues breaks naive sprite-per-issue rendering. The sim must tier.

### Hero tasks (≤10 visible, individually labelled)
- `priority: critical` items.
- Items currently in a *transition* (between rooms) — they "promote" to hero for ~5s.
- Items in `gate-pending` or `needs-human` (always hero — they want attention).
- The currently-camera-selected item (player has clicked it).
- In autonomous mode: the most recently progressed item is hero.

Hero tasks get: codename label of carrier persona, issue title visible, thought bubble with full DecisionKind glyph, full-color sprite.

### Ambient tasks (sample of remaining, ~20–50 visible)
- Show motion in each room proportional to the count. If Dev room has 25 in-flight, show ~5 builders working (cycling through which are visible).
- No labels. No thought bubbles. Just colour-by-priority pulse.

### Collapsed queues (everything else)
- At the **doorway** of each room, a *stack of cards* showing depth: "Dev queue: 47." Items not currently being worked on live in the stack, not on the floor.
- Stacks update with motion when items arrive / leave.
- Click the stack → modal listing the queued items.

### Aggregated swarms
- When 6 scouts fire on the same issue, **at the floor zoom level show one flock badge** ("6 scouts ×"); at the room zoom level show all 6 scouts.
- When parallel-build fires with 4 builders, **at the floor level show one builder cluster** with a count; at room level all 4 are visible.

### Camera modes
- **Building view** (zoomed out): all floors, project-level activity rollup. No individual geese.
- **Floor view** (default): one project's floor, rooms visible, ambient tasks animated, hero tasks labelled.
- **Room view** (zoomed in): full detail, all geese in the room visible, thought bubbles readable.
- **Persona view** (clicked-on goose): timeline of their active runs, decision summaries.

The kanban already gives "everything always." The office should give *the right thing at the right zoom*.

### What should never be visualised directly
- Tool calls per run (animate as desk micro-motion, never as a sprite).
- Decision summaries below Tier 2 (they live in thought bubbles, not in events).
- Cost records (aggregate to the lobby budget board).
- Worktree mechanics (invisible).
- Persona round-robin index (invisible — but the *outcome* is the named goose).

---

## Section 8 — Office Simulation Mapping (canonical)

### The Building

**Goose Hub** is one building. The building has:
- A **lobby** at ground level.
- **Floors above**, one per project.
- A **watchtower** on top (audit).
- A **basement / backstage** (coach office, corkboard).

### Lobby (ground floor)
- **Inbox drop box** — items dropped here from external funnels.
- **Courier desk** — courier geese pick up inbox items and carry them upstairs to the right project floor.
- **Budget board** — daily tokens, daily USD, gauge. Per-project tabs.
- **Lobby bell** — rings on `gate.awaiting-human`.

### Project floors
Each floor is divided into:
- **Triage corner** (near elevator) — incoming items pile up here briefly.
- **Discovery suite** — conversation pit (grilling) → drafting tables (PRD) → critique wall (PRD review) → splitting bench (decomposing). Children spawned at the splitting bench walk back to the triage corner of the *same* floor.
- **Research lab** — open desks for researchers.
- **Investigation lab + Library** — open lab for the lead investigator; sealed library for the 6 scout desks + 2 Wave-2 desks. The library is *visibly sealed* because scouts are holdouts.
- **Spec booth + builder board** — single drafting booth where spec-author sits; a board on the wall where EngineeringSpecs get pinned with their WorkPackages.
- **Dev floor** — multiple builder desks. Builders can work in parallel; they're tethered to the same parent issue by a coloured ribbon when on the same EngineeringSpec.
- **Dev-Review nook** — a small adjacent area where dev-reviewer (Codex) sits, *next to* the dev floor but visibly separate (different desk style). Pre-QA pass.
- **QA chamber** — sealed room with 3 inner stations (structural / functional / regression). Slot for incoming, slot for outgoing verdicts. Door shows retry counter.
- **Review chamber** — sealed room with frosted glass. Round counter on the door. QualityScore dial *next to* the door.
- **Retro room** — debrief table. Retrospector goose sits with notebook. After retro, retrospector walks improvement candidates to the corkboard backstage.
- **Done shelf** — items walk in, never out.
- **Archive cabinet** — terminal storage, partially visible if the player toggles "show archive."

### The Watchtower (top of building)
- **Auditor's perch** — auditor goose visible 24/7 but only *active* (descending, spotlighting) when an audit gate fires.
- **Beacon** — pulses red on `audit.autonomy-gate-fired`.

### Backstage (basement / side door)
- **Coach office** — skill-coach desk. Improvement candidates arrive here from the retro room.
- **Corkboard** — pinned ImprovementCandidate notes, organized by `kind` (skill-prompt / skill-config / workflow / persona / governance-suggestion). Notes change status (pending → approved → rejected) visually (sticky-note colour). When a candidate is promoted to a GitHub issue, the note gets a small "✓ promoted" stamp and a thread links back to the corkboard.
- **Training shelves** — versioned skill prompt artefacts. Slow-burn meta narrative.

### What carries what

| Object | Carried by | Carried as |
|---|---|---|
| WorkItem | Persona (goose) | Ticket / card in hand |
| ScoutReport | Scout (returning to library) | Sealed envelope |
| PRD | PRD-writer | Drafting paper, posted on critique wall |
| EngineeringSpec | Spec-author | Posted on builder board |
| Verdict (QA, Review) | Emerges from sealed room | Verdict scroll |
| ImprovementCandidate | Retrospector | Pinned to corkboard |
| Decompose output | Decomposer | Multiple smaller cards |

### What animations carry what state

| State / event | Animation |
|---|---|
| `state.transitioned` | Goose walks between rooms (path = state-graph edge) |
| `agent.run-started` | Goose sits at desk, desk light turns on |
| `agent.tool-call` | Keyboard tap / drawer pull / monitor flicker |
| `agent.decision-summary-live` | Thought bubble with `DecisionKind` glyph |
| `swarm.scout-completed` (one) | One library desk light goes off, scout emerges with envelope |
| `swarm.wave-completed` (all) | All 6 scouts emerge; door of library opens fully |
| `gate.awaiting-human` | Goose freezes, holds `?`, spotlight, lobby bell |
| `qa.functional-failed` | Verdict scroll emerges red-stamped, goose returns to Dev |
| `review.converged` | Review chamber door opens, goose walks out with green-stamped item |
| `merge-decision.completed` | QualityScore dial spins, settles on score |
| `pr.merged` | Goose walks issue to Done shelf, small flag pop |
| `audit.autonomy-gate-fired` | Watchtower beacon, auditor descends, all floors dim |
| `coach.completed` | New note pinned to corkboard with subtle motion |

### Emotional registers

The "what does it feel like" question:

- **Idle**: warm ambient light, soft keyboard sounds, a janitor goose makes rounds, the budget board ticks slowly. The fantasy: "the company is at rest, but alive."
- **Massive swarm activity**: buzz of motion, multiple tethers across the Dev floor, the library doors swinging, the Spec booth lit up. The fantasy: "the company is *working*."
- **Cascading failures**: red verdict scrolls stack at the Dev floor; retry counters on the QA door climb; geese walk back and forth with increasing weariness (subtle pace change after 2+ retries); auditor's perch lights yellow then red. The fantasy: "something is wrong, the company is struggling."
- **Overnight autonomous operation**: night palette; only active rooms lit; the watchtower beacon swings slowly; geese still working but the lobby is empty; no human icon. Items quietly progress to the Done shelf. The fantasy: "the company runs while you sleep, and you trust it." When the audit gate fires, the night gets violently red — emotionally distinct from anything during the day.
- **Human intervention moment**: spotlight on the affected goose; ambient lighting dims everywhere else; the lobby bell rings; a "phone" UI element pulses. When you click to resolve, lighting restores. The fantasy: "they need me; I am useful here." The most emotionally important register — if it feels good to respond to, the whole sim earns its keep.

---

## Sequencing recommendation

If all of this is built at once, coordination cost collapses delivery. Dependency order respecting both the operational model *and* visual narrative:

1. **Multi-persona geese first.** Replace one-goose-per-role with N personas per role (codename-labelled). The data is already there. Single biggest perceptual upgrade for the smallest implementation cost.
2. **Room geography next.** Walk the issue between rooms (not desks). State-machine edges become path-finding goals. Most of M17's current code stays, but the *spatial primitives* change.
3. **Holdout seals** (QA, Review, Library/scouts). Visible-contract: closed doors, sealed envelopes, verdict scrolls. Teaches the player how the system maintains adversarial integrity without explanation.
4. **Wave / Spec / Parallel-build ritual.** The single most distinctive moment in the system. Scout fan-out animation, spec posting, builder tethers. The first time a player sees this, they understand they're not looking at a kanban.
5. **Auditor + autonomy-gate beacon.** Quietly absent 99% of the time, dramatic when it fires. Sells the "the company can run itself but you set the rules" fantasy.
6. **Backstage corkboard.** The slow-burn meta-loop. Last because it only feels real after the rest of the company has been working for a while.
7. **Zoom modes** (building / floor / room / persona). Needed to handle scale; not needed for the first 50 issues.

---

## Closing principle

The office is not a kanban with sprites. It's a model of a specific operational system that has hierarchy (project → issue → wave → work-package), holdouts (QA, review, scouts), modes (interactive / supervised / autonomous), and a feedback loop (retro → improvement candidate → skill-coach → next run). **Every visual primitive in the office should map to one of those, and the ones that don't map should be cut.**

The fantasy survives because it's not metaphorical — it's a faithful render of what's actually running.
