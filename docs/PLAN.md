# Goose Hub — Personal Command Centre for AI-Driven Software Delivery

> **Status:** v2.2, final PRD
> **Owner:** Shaun Nesbitt
> **Product:** Goose Hub (the app)
> **Engine:** Factory (the orchestration layer that powers Goose Hub)
> **Purpose:** the constitution. Agents and humans read this before any work. Not a build spec; a build spec is a GitHub issue.
> **Reading discipline:** read end-to-end before editing. Disagreements get filed as `factory:docs` issues.
>
> **Changes in v2.2:**
> - Staging restructured from "Stages 0-6" to milestone-based vertical slices (M0–M18)
> - All 21 adversarial-review fixes folded in
> - Governance has explicit bootstrap-creation exception
> - Issue vs PR state made explicit (issue is the work item; PR is an artefact)
> - Honest sandboxing language (supervised mode is observational, not isolated)
> - Worktree isolation reframed as workflow boundary, not isolation boundary
> - Local DB authority clarified (operational state, not work-item state)
> - Agent.thought reframed as decision summary with redaction rules
> - Label conflict resolution rules
> - Fallback never down-tiers on critical/high or holdouts
> - Tiered retrospectives (light by default, deep on triggers)
> - Slices include only relevant surfaces
> - YAML scope clarified (no product-workflow YAML; CI YAML is fine)
> - Costs labelled estimated when inferred
> - Source-agnostic language for Jira/Bitbucket
> - Stack locked: Node + pnpm + TypeScript + Drizzle + SQLite + React + Vite + shadcn/ui + Biome + Vitest + Playwright + Zod

---

## 1. North star

Goose Hub is a personal command centre for AI-assisted software delivery. It ingests work from many funnels, triages and decomposes it through agent-driven skill chains, and ships software via supervised or autonomous workflows against any target repository. Each project plugs into its own source of truth (GitHub Issues to start; Jira later for Work), runs at a chosen autonomy level, and stores its work where the work belongs — in the project's own issue tracker. Goose Hub aggregates and observes; it never centralises authority over work that belongs elsewhere.

The system improves itself by running on itself: every Goose Hub feature is filed as a GitHub issue against the Goose Hub repo, picked up by Factory, and shipped as a PR.

Built **for one user first** (Shaun, locally). Generic plugability is a side effect of clean abstractions, not a goal.

---

## 2. Why this exists

- I run many AI agents across many projects (work, personal monorepo, side projects) and need glanceable, observable, controllable orchestration.
- I want a single space where ideas land, get refined, get decomposed, get built, get reviewed, and get retrospected — without chasing them through fifteen tools.
- I want autonomy where I trust it (personal monorepo) and human gates where I don't (work, client code).
- The big players (Anthropic, OpenAI, GitHub, Linear) are building harnesses too. I am not building this to sell a competing harness. I am building this to be my personal command centre, to demonstrate deep understanding of the category as a portfolio piece, and to make myself materially more effective as a senior engineer.
- Goose Hub is itself a portfolio artefact. It is allowed to be opinionated.

---

## 3. Foundational principles

These are non-negotiable. Every later decision derives from them.

1. **Build Goose Hub using Goose Hub.** Bootstrap with manual mode. Expand to autonomous as confidence grows.
2. **Agents recommend, the orchestrator decides, humans approve gates.** Agents do not own state. They produce structured output; the orchestrator validates it, applies rules, decides the next state, and moves the work item.
3. **Structured outputs over vibes.** Every agent run produces JSON conforming to its skill's published schema. Free text is allowed inside fields, never as the envelope. Invalid output fails the run.
4. **Vertical slices, never horizontal layers.** Each feature ships end-to-end (data + API + UI + tests for one user-visible behaviour). "The database layer" is never an issue.
5. **TDD with slice-local tests.** Tests live alongside the slice. Integration tests live in `tests/integration/` and exercise slices as black boxes.
6. **State of truth lives in the repo it concerns; Goose Hub owns operational state, not work-item authority.** Authoritative work-item state lives in the source of truth (GitHub Issues + labels in the target repo, Jira tickets, Linear issues). Goose Hub's local SQLite is authoritative for runtime history, persona stats, budgets, locks, and inbox notes — operational concerns. The orchestrator never holds work-item state in memory across ticks.
7. **TypeScript for product code; markdown for prompts.** No YAML for product workflows. GitHub Actions CI YAML in `.github/workflows/` is allowed and expected — that's CI, not product logic.
8. **Supervised by default, autonomous by configuration.** Each project picks its mode. Modes are per-project and overridable per-issue.
9. **Validator as holdout.** Reviewers and QA agents never see implementation reasoning, plans, decision summaries, or chat history. They check outcome against the original issue. Holdouts are never enhanced by advisors; advisors elsewhere are explicit.
10. **Governance files are immutable to Factory after creation.** `MISSION.md`, `FACTORY_RULES.md`, `CLAUDE.md`, project configs, and persona configs cannot be **modified** by any Factory PR. They can be **created** by the bootstrap workflow under explicit conditions (section 26.5). PR check hard-fails on modification of governance paths outside bootstrap.
11. **Per-project budget caps.** Token budgets, parallel agent caps, retry limits, flood protection, advisor budgets, all per project.
12. **Boring, transparent heuristics beat fancy ML when trust matters.** No vector DBs. No embedding services. Three-tier matching (keyword → code search → Claude semantic fallback) is the established pattern.
13. **Isolation strategy fits the autonomy level. Supervised mode is observational, not isolated.** Tool-layer sandboxing in supervised mode is defense-in-depth against accidents, not protection against a malfunctioning agent. The real safety mechanism in supervised mode is the human PR review gate. Autonomous mode requires Docker isolation precisely because the human gate is removed.
14. **Pluggability through interfaces.** Source-of-truth, agent runtime, skill, model provider, tool, storage — all behind interfaces. Implementations are swappable.
15. **Reference code is evidence, not architecture.** The existing Slack-bot harness contains useful patterns. It informs but does not define Goose Hub. A reference audit (M1) gates any port.
16. **Each target repo is unique.** Bootstrap inspects the repo's stack and adapts: detects build/test commands, ensures `CLAUDE.md` exists, updates it with project-specific guidance. Goose Hub never assumes one stack fits all.
17. **The constitution is not a build spec.** This document is read as context. Build instructions come from individual GitHub issues with concrete acceptance criteria. Agents that try to build "from the document" instead of "from an issue" are working incorrectly.

---

## 4. Domain model

- **Goose Hub** — the product. The app, UI, and runtime.
- **Factory** — the engine inside Goose Hub: orchestrator, workflows, agent runtime, tool layer, workspaces, budgets, telemetry.
- **Target Project** (or just **Project**) — a unit of work Factory operates on. Has its own source of truth, mode, budgets, governance. Configured under `target-projects/<slug>/`. Points at one or more target repositories.
- **Target Repository** — the actual codebase agents clone, investigate, and modify. Lives outside Goose Hub.
- **Source of Truth** — the system holding work-item state for a project. Lives at the project level, not the repo level (a Jira workspace covers many Bitbucket repos; a single GitHub repo's Issues covers one repo). v0: GitHub Issues per repo.
- **Work Item** — a unit of work in the source of truth. Identified by repo-qualified ref (`shaunnez/diamond-ingestion#42`) for GitHub, or workspace-qualified ref for Jira. Carries type, priority, mode, current state.
- **State** — the lifecycle position of a work item. Stored on the **issue**, not the PR. PRs are artefacts attached to issues; PR labels are decorative only.
- **Workflow** — a TypeScript module composing nodes that takes a work item from state to state.
- **Node** — a single async function inside a workflow.
- **Lane** — a UI column on the Kanban. Visual grouping of states. Pure display; never drives behaviour.
- **Agent Run** — one invocation of an AI agent with role, prompt, tool allowlist, budget, output schema.
- **Role** — Triager, Griller, PRD-Writer, Decomposer, Researcher, Investigator, Developer, QA, Reviewer, Retrospector, Advisor.
- **Persona** — a named instance of a role with personality, history, performance metrics. Project-scoped.
- **Skill** — a packaged capability: prompt + role + tool bundle list + model config + JSON output schema. Versioned markdown plus a TypeScript schema file.
- **Tool Bundle** — a named set of related tools. Roles compose allowlists from bundles plus per-role extras.
- **Workspace** — an ephemeral working directory containing a git worktree of the target repo. A *workflow boundary*, not an *isolation boundary*. Worktrees share `.git`, hooks, and refs with the parent repo.
- **Vertical Slice** — a self-contained, end-to-end feature folder inside a target repo. Slices include only the surfaces they genuinely touch (a workflow-only slice has no `ui.tsx`); `slice.test.ts` and `README.md` are required.
- **Funnel** — an input channel that produces work items: direct, Inbox UI, research lane, conversation capture, external webhook, Slack `/capture` (M15+).
- **Inbox** — project-agnostic capture for raw notes. Lives in Goose Hub's local SQLite. Promotes to a chosen target repo's issue tracker.
- **Mode** — autonomy level: `interactive`, `supervised`, `autonomous`.
- **Gate** — a workflow node that pauses awaiting human approval.
- **Milestone** — a GitHub-native bucket of work items, scoped per repo. Used for sprint scheduling. One is "active" at a time per project.
- **Improvement Candidate** — retrospective-flagged change to a prompt, config, or skill. Becomes a Factory issue once approved.
- **Governance** — immutable rules in `MISSION.md`, `FACTORY_RULES.md`, `CLAUDE.md`. Per-target-repo `CLAUDE.md` is created by bootstrap, then locked.
- **Advisor** — a higher-tier model that reviews a primary agent's output before commit, in fresh context. Verdict: proceed/revise/abort. Never used on holdouts. Never used to do work.
- **Decision Summary** — a single-sentence event emitted by an agent at a decision point. Not raw chain-of-thought. Stored in the event stream after secret redaction.
- **Bootstrap** — the workflow that onboards a new target project: detects stack, ensures CLAUDE.md, installs labels, scaffolds project config. Has explicit governance-creation exception.

---

## 5. Architecture overview

### 5.1 The shape

```
┌─────────────────────────────────────────────────────────────┐
│                     Goose Hub (this app)                    │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐   │
│  │     UI       │   │  Orchestrator│   │  Agent runtime │   │
│  │ React + Vite │◄─►│  (stateless) │──►│  (Claude CLI)  │   │
│  └──────┬───────┘   └──────┬───────┘   └───────┬────────┘   │
│         │                  │                   │            │
│         └──────────────────┼───────────────────┘            │
│                            ▼                                │
│                    ┌──────────────┐                         │
│                    │ Event Stream │ ◄── SSE                 │
│                    │   (SQLite)   │                         │
│                    └──────────────┘                         │
│                            ▲                                │
│         ┌──────────────────┼──────────────────┐             │
│         │                  │                  │             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ State Source │  │   Tool Layer │  │  Workspaces  │       │
│  │   adapters   │  │ (bundles +   │  │ (git worktree│       │
│  │  (per repo)  │  │  sandbox)    │  │  per run)    │       │
│  └──────┬───────┘  └──────────────┘  └──────┬───────┘       │
└─────────┼────────────────────────────────────┼──────────────┘
          ▼                                    ▼
   ┌─────────────────┐                 ┌──────────────────┐
   │  Per-project    │                 │  Target repos    │
   │  issue trackers │                 │  (cloned to      │
   │  (GitHub /      │                 │  ephemeral       │
   │  Jira / Linear) │                 │  workspaces)     │
   └─────────────────┘                 └──────────────────┘
```

### 5.2 Three concepts that must stay separate

| Concept | Lives in | Owns | Changes when |
|---|---|---|---|
| **State** | Source of truth (GitHub label, Jira status) | Lifecycle position of a work item | New stage added to the workflow |
| **Workflow** | `core/orchestrator/workflows/*.ts` | Code that transitions between states | Logic of a stage changes |
| **Lane** | `ui/kanban/lanes.config.ts` | Visual grouping of states on the board | UI layout changes |

### 5.3 Multi-project source of truth

Each project owns its issue tracker. Goose Hub aggregates across them.

```
shaunnez/goose-hub             ← Goose Hub itself
shaunnez/diamond-ingestion     ← Diamond
shaunnez/phaser-game           ← Phaser
<work>/<jira-workspace>        ← Work (Jira when M14 lands)
```

There is no central issue store. The Inbox is the only project-agnostic capture, living in Goose Hub's local SQLite until promoted into a target.

### 5.4 Issue vs PR

The **issue** is the work item. State labels (`factory:in-progress`, `factory:needs-qa`, etc.) live on the issue. PR labels are optional decorative status only.

When a PR is opened from a Dev workflow, the issue moves from `factory:dev-ready` → `factory:in-progress`. PR merge moves the issue to `factory:retrospecting`. PR closed without merge moves the issue back to `factory:needs-fix` (if retries remain) or `factory:needs-human` (if exhausted or human-rejected).

The issue stays open through retrospective and only closes at `factory:done`.

### 5.5 Statelessness vs operational authority

The orchestrator does not hold work-item state across ticks. Each tick is a pure function of `(project config, source of truth, local operational state)` → `(zero or one workflow dispatch)`.

**State of truth (per project, per repo):** authoritative work-item state. Lives in the source of truth.
**Goose Hub operational authority (local SQLite):** runtime history, persona stats, budgets, locks, inbox, project_state, governance audit. Goose Hub IS authoritative for these. Wipe the DB and you lose history; the work-item state survives in the source of truth.

This distinction matters: agents and future you should not underbuild durability for operational state on the assumption "it's all in GitHub anyway." It is not.

---

## 6. Repository layout

This reflects the actual layout as of M11 (mid-milestone). Future directories are annotated with the milestone that introduces them. CONTEXT.md is the canonical record of resolved implementation decisions; ADRs justify them long-form.

```
goose-hub/
├── MISSION.md                           # immutable: what this system is for
├── FACTORY_RULES.md                     # immutable: hard rules Factory must obey
├── CLAUDE.md                            # how AI agents should approach this repo
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── biome.json
├── .github/
│   └── workflows/                       # CI YAML — allowed, expected
├── target-projects/                     # config + governance per project (@goose-hub/target-projects, see ADR 0015)
│   ├── index.ts                         # exports targetProjectsRoot path anchor
│   ├── goose-hub-self/
│   │   ├── MISSION.md
│   │   ├── FACTORY_RULES.md
│   │   ├── project.config.ts
│   │   └── personas/
│   └── nannymudnz/                      # M10: second registered project (color #059669)
│       ├── MISSION.md
│       ├── project.config.ts
│       └── personas/
├── skills/                              # composable skill packages (M5+, @goose-hub/skills workspace pkg)
│   ├── package.json                     # exports: { "./*": "./*" }
│   ├── triage/
│   │   ├── skill.config.ts              # SkillConfig (toolBundles, modelPin, freshContext, role, contextSchema)
│   │   ├── prompt.md                    # versioned system prompt; ends with [decision] footer
│   │   ├── schema.ts                    # Zod output schema
│   │   ├── slice.test.ts                # always required
│   │   ├── eval/eval.json               # at least one eval case
│   │   └── README.md                    # always required
│   └── ...
├── slices/                              # named orchestrator workflow slices (M5+)
│   │                                    # Each slice is one workflow OR a self-contained helper module.
│   │                                    # Named by what it does (NOT numbered).
│   │                                    # NOT UI component slices — those live in apps/web/src/components/
│   ├── investigate/                     # M6 workflow (#197)
│   ├── fix-issue/                       # M7 supervised dev workflow (#183)
│   ├── qa/                              # M8 holdout workflow
│   ├── review/                          # M8 holdout workflow
│   ├── resolve-conflict/                # M8+ helper slice — conflict-resolver agent dispatch
│   ├── retry-escalate/                  # M8 retry counter + escalation logic (imported by qa/, review/)
│   ├── holdout-boundary-test/           # M8 regression slice — proves holdout context filtering
│   ├── fix-feedback/                    # M9 fix-loop after qa/review failure (factory:qa-failed → factory:needs-fix)
│   ├── cost-tracking/                   # M9 helper slice for agent_run_costs writes
│   └── ...                              # every slice contains at minimum workflow.ts (or feature module),
│                                        # slice.test.ts, README.md
├── core/                                # @goose-hub/core workspace package
│   ├── package.json
│   ├── types.ts
│   ├── state-machine/
│   │   ├── states.ts                    # canonical state enum
│   │   ├── transitions.ts               # legal transition table
│   │   └── conflict-resolver.ts         # label conflict rules
│   ├── state-source/
│   │   ├── interface.ts
│   │   ├── github-labels.ts
│   │   ├── jira.ts                      # M14
│   │   └── linear.ts                    # stub
│   ├── event-stream/
│   │   ├── store.ts
│   │   └── sse.ts
│   ├── db/
│   │   ├── schema.ts
│   │   ├── db.ts
│   │   └── migrate.ts
│   ├── projects/                        # M10+ (see ADR 0021); multi-project loader + per-project scheduler
│   │   ├── loader.ts                    # loadProjects() / getProjectBySlug() — reads target-projects/*/project.config.ts
│   │   └── scheduler.ts                 # startPerProjectScheduler() — one independent setInterval per project
│   │                                    # NOTE: per-project locking and workflow dispatch live in
│   │                                    # apps/server/src/shared/dispatch.ts, not here.
│   ├── agent-runtime/                   # M4+
│   │   ├── interface.ts
│   │   ├── claude-cli.ts
│   │   ├── context-assembly.ts          # was fresh-context.ts in plan; see ADR 0009
│   │   ├── advisor.ts                   # M7
│   │   ├── fallback.ts
│   │   ├── models.ts
│   │   ├── output-validator.ts
│   │   ├── schema-bridge.ts
│   │   └── hooks/                       # future
│   ├── tool-layer/                      # M4+
│   │   ├── bundles.ts
│   │   ├── allowlist.ts
│   │   ├── sandbox.ts                   # includes denylist; see ADR 0010
│   │   ├── secret-redaction.ts
│   │   └── pre-tool-use-hook.ts
│   ├── workspaces/                      # M4+
│   ├── persona/                         # M9+ (singular — accumulatePersonaStats)
│   │   └── accumulate.ts                # accumulatePersonaStats — called by every workflow
│   ├── retrospective/                   # M9+ (shared Zod schemas for retro skill output)
│   │   └── schemas.ts
│   ├── cost/                            # M9+ (see ADR 0016)
│   │   ├── extract.ts                   # costFromCliEnvelope / costFromApiUsage
│   │   ├── repository.ts                # recordCost / queryCosts
│   │   ├── skill-stage.ts               # skill → stage mapping
│   │   └── types.ts
│   ├── workflows/                       # M9+ (see ADR 0017); cross-caller workflows only
│   │   └── retrospective.ts             # runRetrospectiveWorkflow — tier selection + skill dispatch
│   └── connectors/
│       └── github/                      # M7+ (#184/#186)
│           ├── open-pr.ts
│           └── merge-pr.ts
├── apps/
│   ├── cli/                             # `goose status`, `goose tick`, etc.
│   │   └── src/index.ts
│   ├── server/                          # Hono API + SSE event stream
│   │   └── src/
│   │       ├── index.ts
│   │       ├── projects.ts
│   │       ├── source.ts
│   │       └── active-milestone.ts
│   └── web/                             # React + Vite + shadcn/ui (introduced M2)
│       ├── index.html
│       ├── vite.config.ts
│       ├── playwright.config.ts
│       ├── e2e/                         # Playwright specs
│       └── src/
│           ├── App.tsx
│           ├── main.tsx
│           ├── components/
│           │   ├── board/               # Kanban board + issue cards
│           │   ├── chrome/              # app shell, sidebar, top bar
│           │   │   └── slots/           # project switcher, milestone selector
│           │   ├── detail/              # full-takeover issue detail page
│           │   └── ui/                  # shared primitives (Pill, Button, etc.)
│           ├── lib/                     # api client, lane config, utilities
│           └── state/                   # React context providers
└── docs/
    ├── PLAN.md                          # this document
    ├── exit-audit.md
    ├── reference-audit.md               # produced in M1
    ├── adr/
    └── retros/
```

### 6.1 Slices include only relevant surfaces

A slice has at minimum `slice.test.ts` and `README.md`. Other files (`data.ts`, `api.ts`, `ui.tsx`, etc.) exist only when there's real content. A workflow-only slice has no UI file. A CLI-only slice has no UI or API. Forcing empty boilerplate files is forbidden.

### 6.2 Slices vs core

- Slice code is shippable in isolation; deleting the slice + reverting registration removes the feature cleanly.
- Slices import from core through public interfaces; never reach into core internals.
- Slices never import from other slices; cross-slice integration goes through core.

---

## 7. Pluggability — the interfaces

### 7.1 `StateSource`

```ts
export interface StateSource {
  projectId: string
  repoRef: string                       // "shaunnez/diamond-ingestion" or workspace-qualified

  listOpenWork(): Promise<WorkItem[]>
  getItem(itemId: string): Promise<WorkItem>
  listMilestones(): Promise<Milestone[]>
  getActiveMilestone(): Promise<Milestone | null>

  transitionState(itemId: string, from: State, to: State, note?: string): Promise<void>
  comment(itemId: string, body: string): Promise<void>
  attach(itemId: string, artifact: Artifact): Promise<void>
  createIssue(input: CreateIssueInput): Promise<WorkItem>

  watchForUpdates(callback: (event: SourceEvent) => void): Promise<Subscription>
}

export interface WorkItem {
  id: string                            // global: "github:shaunnez/diamond-ingestion#42"
  externalId: string
  repoRef: string
  title: string
  body: string
  type: 'feature' | 'bug' | 'chore' | 'research'
  priority: 'critical' | 'high' | 'medium' | 'low'
  mode: 'interactive' | 'supervised' | 'autonomous'
  state: State
  parentId?: string
  authorIsOwner: boolean
  milestoneId?: string
  schedule: 'current' | 'next' | 'later' | 'blocked-by'
  exec: 'serial' | 'parallel'
  dependsOn: string[]                   // parsed from body, repo-qualified
  blocks: string[]
  createdAt: Date
}
```

### 7.2 `AgentRuntime`

```ts
export interface AgentRuntime {
  spawn(spec: AgentSpec): Promise<AgentRun>
}

export interface AgentSpec {
  role: Role
  promptFile: string
  context: Record<string, unknown>
  contextAllowlist: ContextKey[]        // explicit list of allowed keys (holdout enforcement)
  toolBundles: BundleName[]
  toolExtras?: ToolName[]
  modelTier: ModelTier
  budgets: AgentBudgets
  workspace: WorkspacePath
  freshContext: boolean
  outputSchema: ZodSchema
}
```

The runtime composes the final tool allowlist by unioning bundles + extras. Validates structured output. Wraps with fallback and (optionally) advisor logic. Enforces context allowlist (holdout enforcement).

### 7.3 `Tool` and bundles

```ts
export const ToolBundles = {
  core: ['read', 'work-item-read'],
  read: ['read', 'search', 'work-item-read'],
  write: ['write', 'work-item-comment'],
  shell: ['bash', 'test'],
  validate: ['diff', 'test', 'playwright'],
  web: ['web-fetch'],
  workItemAdmin: ['work-item-create', 'work-item-label', 'work-item-link'],
}
```

### 7.4 `ModelProvider`, `Connector`, `Storage`

Same as v2.1. v0 ships Claude CLI as ModelProvider; GitHub, Playwright, local filesystem as connectors; local filesystem as Storage.

---

## 8. Project configuration

```ts
// target-projects/goose-hub-self/project.config.ts
const config: ProjectConfig = {
  id: 'goose-hub-self',
  name: 'Goose Hub (self)',
  slug: 'goose-hub-self',

  source: {
    kind: 'github',
    repo: 'shaunnez/goose-hub',
    stateMachine: 'labels',
  },

  targetRepo: {
    cloneUrl: 'git@github.com:shaunnez/goose-hub.git',
    defaultBranch: 'main',
    localPath: '~/code/goose-hub',
  },

  stack: {
    runtime: 'node',
    packageManager: 'pnpm',
    buildCommand: 'pnpm build',
    testCommand: 'pnpm test',
    lintCommand: 'pnpm lint',
    typecheckCommand: 'pnpm typecheck',
    e2eCommand: 'pnpm test:e2e',
    detectedAt: '2026-04-30T00:00:00Z',
  },

  mode: 'supervised',
  storage: { kind: 'local', path: '~/.factory/data/goose-hub-self' },
  repos: ['shaunnez/goose-hub'],

  agentConfig: {
    runtime: 'claude-cli',
    rolesModels: {
      triager:        { primary: 'haiku',  fallback: 'haiku',  advisor: null },
      griller:        { primary: 'opus',   fallback: 'sonnet', advisor: null },
      'prd-writer':   { primary: 'opus',   fallback: 'sonnet', advisor: 'opus' },
      decomposer:     { primary: 'sonnet', fallback: 'haiku',  advisor: null },
      investigator:   { primary: 'opus',   fallback: 'sonnet', advisor: null },
      developer:      { primary: 'sonnet', fallback: 'sonnet', advisor: 'opus' },
      qa:             { primary: 'sonnet', fallback: null,     advisor: null },  // holdout
      reviewer:       { primary: 'sonnet', fallback: null,     advisor: null },  // holdout
      retrospector:   { primary: 'sonnet', fallback: 'haiku',  advisor: null },
      researcher:     { primary: 'opus',   fallback: 'sonnet', advisor: null },
    },
    fallbackPolicy: {
      // Per-priority rules. See section 17.
      'critical': 'same-tier-only',
      'high':     'same-tier-only',
      'medium':   'allow-down-tier',
      'low':      'allow-down-tier',
    },
    toolAllowlists: {
      triager:      { bundles: ['core'], extras: ['work-item-label'] },
      griller:      { bundles: ['core'], extras: ['work-item-comment'] },
      'prd-writer': { bundles: ['read', 'core'], extras: ['work-item-comment'] },
      decomposer:   { bundles: ['read', 'core', 'workItemAdmin'] },
      investigator: { bundles: ['read', 'core'] },
      developer:    { bundles: ['read', 'write', 'shell'] },
      qa:           { bundles: ['read', 'shell', 'validate'] },
      reviewer:     { bundles: ['read', 'validate'] },
      retrospector: { bundles: ['core'], extras: ['event-read', 'persona-stats'] },
      researcher:   { bundles: ['web', 'workItemAdmin'] },
    },
    advisorMode: {
      enabled: true,
      triggerOn: { priorities: ['critical', 'high'] },
      maxAdvisorBudgetUsd: 1,
      disableInAutonomous: true,
    },
    retrospectivePolicy: {
      defaultTier: 'light',
      deepTriggers: ['qa-failed', 'retries-ge-2', 'budget-exceeded', 'needs-human', 'priority-high', 'priority-critical', 'first-run-of-skill'],
    },
  },

  budgets: {
    dailyTokens: 5_000_000,
    maxParallelAgents: 3,
    maxRetries: 2,
    maxIssuesPerDayFromNonOwners: 3,
    maxBashSeconds: 120,
    perWorkflowMaxUsd: 5,
    perAgentMaxUsd: 2,
    perAdvisorMaxUsd: 1,
  },

  governance: {
    immutablePaths: [
      'MISSION.md',
      'FACTORY_RULES.md',
      'CLAUDE.md',
      'target-projects/**/MISSION.md',
      'target-projects/**/FACTORY_RULES.md',
      'target-projects/**/project.config.ts',
      'target-projects/**/personas/**',
      'docs/PLAN.md',
    ],
  },

  isolation: {
    mode: 'native',                     // 'docker' for autonomous projects
  },

  archiveAfterDays: 7,

  visibility: 'always_visible',
  machineScope: undefined,

  color: '#7c3aed',
  icon: 'goose',
}
```

---

## 9. State machine

Single source of state truth: GitHub labels in the target repo. Defined in `core/state-machine/states.ts`.

### 9.1 Issue states

```
[opened]
  → factory:triaging
      → factory:rejected → factory:archived
      → factory:accepted
          → (by type)
              feature  → factory:grilling → factory:prd-drafting → factory:prd-review (gate) → factory:decomposing → factory:issues-created
              bug      → factory:investigating → factory:investigation-complete → factory:dev-ready
              chore    → factory:dev-ready
              research → factory:research-pending → factory:research-complete
          → factory:dev-ready (for bug/chore/decomposed feature children)
              → factory:in-progress (PR opened against issue)
                  → factory:needs-qa
                      → factory:qa-failed → factory:needs-fix → (back to in-progress) | factory:needs-human (after retries)
                      → factory:needs-review
                          → factory:needs-fix → (back to in-progress) | factory:needs-human
                          → factory:approved (gate in supervised; auto-merge in autonomous)
                              → factory:retrospecting
                                  → factory:done → factory:archived (after archiveAfterDays)
```

### 9.2 State location

State labels live on the **issue**, not the PR. The PR is an attached artefact. PR-side labels (e.g. GitHub auto-applied "merged") are decorative. The issue stays open through retrospective and closes at `factory:done`.

When a PR is closed without merging:
- If the human rejected at the gate → issue moves to `factory:needs-fix` (counts as a retry)
- If retries exhausted → `factory:needs-human`
- If human explicitly cancelled → `factory:rejected`

### 9.3 Label conflict resolution

GitHub labels are flexible. Manual edits or partial transitions can leave conflicts. Resolution rules in `core/state-machine/conflict-resolver.ts`:

- **Zero `factory:*` labels on an open issue** → treat as `factory:triaging`
- **Two or more `factory:*` state labels** → orchestrator picks the most-advanced state in canonical order, removes the others, emits `state.conflict-resolved` event
- **Unknown `factory:*` label** → ignored, warning logged
- **`factory:archived` + any active state** → archived wins; active labels removed
- **Manual edit during active workflow** → orchestrator's next tick re-reads state. The in-flight workflow may emit `state.changed-during-run` and abort; next tick picks up from current state.

These rules must have unit tests (M1 exit criterion).

### 9.4 Auxiliary labels

- `priority:critical | high | medium | low`
- `mode:supervised | autonomous`
- `type:feature | bug | chore | research`
- `schedule:current | next | later | blocked-by`
- `exec:serial | parallel`
- `factory:rate-limited`
- `factory:budget-exceeded`
- `factory:tool-violation`
- `factory:improvement-candidate`
- `factory:advisor-flagged`
- `factory:blocked-by-dependency`
- `factory:docs`
- `factory:bootstrap-pr` (used by bootstrap to bypass governance immutability for *creation* only)

### 9.5 The full state list (canonical)

```
factory:triaging
factory:accepted
factory:rejected
factory:grilling
factory:prd-drafting
factory:prd-review
factory:decomposing
factory:issues-created
factory:research-pending
factory:research-complete
factory:investigating
factory:investigation-complete
factory:gate-pending
factory:dev-ready
factory:in-progress
factory:needs-qa
factory:qa-failed
factory:needs-review
factory:needs-fix
factory:approved
factory:merge-conflict
factory:retrospecting
factory:needs-human
factory:done
factory:archived
```

---

## 10. Lanes

Pure UI display. `ui/kanban/lanes.config.ts`. Default 11 lanes (2 hidden by default):

| Lane | States |
|---|---|
| Triage | triaging, accepted |
| Discover | grilling, prd-drafting, prd-review (gate), decomposing, issues-created |
| Research | research-pending, research-complete |
| Investigation | investigating, investigation-complete |
| Dev | dev-ready, in-progress, needs-fix, qa-failed |
| QA | needs-qa |
| Review | needs-review, approved (gate) |
| Retrospective | retrospecting |
| Blocked | needs-human, tool-violation, budget-exceeded, rate-limited |
| Done | done |
| Archive | archived (hidden by default) |
| Rejected | rejected (hidden by default) |

Projects can override lane config (hide, merge, reorder) without touching state machine or workflow code.

---

## 11. Workflows

TypeScript modules in `core/orchestrator/workflows/`. Each exports `run(ctx)`. Workflows are stateless across ticks — re-entrant from any state.

### 11.1 v0 workflows

| Workflow | Triggers on | Notes |
|---|---|---|
| `triage-batch` | `factory:triaging` (multiple) | Max 10 issues per run, body trunc 2KB |
| `grill-and-prd` | `factory:grilling` | Pauses at `prd-review` gate; advisor on PRD draft |
| `decompose-prd` | `factory:decomposing` | Outputs vertical slices as child issues |
| `investigate` | `factory:investigating` | Three-tier repo match, structured findings; playwright-repro for bugs |
| `fix-issue` | `factory:dev-ready` | TDD-first dev; advisor on plan; opens PR |
| `run-qa` | `factory:needs-qa` | Holdout, no advisor, no down-tier fallback |
| `run-review` | `factory:needs-review` | Holdout, no advisor, no down-tier fallback |
| `retrospective-light` | `factory:retrospecting` (default) | Thin retro: 3-bullet summary, obvious improvement candidates only |
| `retrospective-deep` | `factory:retrospecting` (when triggers met) | Full retro with persona analysis, full improvement candidates |
| `archive-sweep` | scheduled daily per project | Done/Rejected → Archived after `archiveAfterDays` |
| `research-analyse` | `factory:research-pending` | URL → JSON → optional candidate feature |
| `bootstrap-project` | one-off, manual invocation | Detects stack, ensures CLAUDE.md, installs labels, scaffolds project config |

### 11.2 The orchestrator tick

```ts
export async function tick(projectId: string): Promise<void> {
  const project = await loadProject(projectId)
  if (!isProjectActive(project)) return
  if (await isAtBudgetLimit(project)) return
  if (await hasActiveRun(project)) return    // one workflow at a time per project (M11+ relaxes this)

  const source = createStateSource(project.source)
  const items = await source.listOpenWork()
  const next = await pickHighestPriorityEligible(items, project)
  if (!next) return

  const workflow = pickWorkflow(next, project)
  if (!workflow) return

  await acquireLock(project)
  try {
    await dispatchWorkflow(workflow, next, project)
  } finally {
    await releaseLock(project)
  }
}
```

### 11.3 Trigger sources

- **Webhook** (supervised): GitHub event from any registered target repo → API endpoint → `tick(projectId)`
- **Cron** (autonomous, M16+): scheduled tick every N hours
- **Manual** (interactive): UI "Run Next" button → `tick(projectId)`
- **Self-trigger after gate approval**: webhook → `tick(projectId)`
- **Daily archive sweep**: scheduled per project

---

## 12. Milestones and scheduling

GitHub Milestones in the target repo for sprint grouping. One active per project, stored in `project_state` table.

### 12.1 Active milestone

```sql
project_state (
  project_id PRIMARY KEY,
  active_milestone_number INTEGER,
  active_milestone_set_at TIMESTAMP,
  active_milestone_set_by TEXT,
  ...
)
```

UI button, API, CLI all set this. Fallback: lowest-numbered open milestone with at least one open issue.

### 12.2 Scheduling labels

`schedule:current | next | later | blocked-by`

### 12.3 Concurrency labels

`exec:serial | parallel`

### 12.4 Dependencies

Body-level, parsed by `core/state-source/github-labels.ts`:
- `Depends on #42` (same repo)
- `Depends on shaunnez/diamond-ingestion#42` (cross-repo)
- `Blocks #71` (reverse mapping)
- Tolerant parser: also accepts `depends on`, `Depends-On`, `blocked by`. Anything else ignored, not error.

Cross-repo deps require the dependency repo to be a registered project. Otherwise the issue moves to `factory:needs-human` with a comment explaining the unresolvable dep.

### 12.5 Dependency-aware moves

```bash
goose task move <issue-ref> --to=current --with-dependencies
goose task move <issue-ref> --to=current --ignore-dependencies
```

UI confirmation dialog when moving issues with dependencies. Default `--with-dependencies`.

### 12.6 Sprint review at milestone end

When all issues in a milestone are `done`/`archived`/`rejected`, auto-create a `type:chore` review issue summarising what shipped, what got rejected, what carried over. Links retrospectives.

---

## 13. The skill chain

Each skill is `prompt.md` (versioned system prompt) + `schema.ts` (Zod output) + `skill.config.ts` (role, contextSchema, toolBundles, modelTier, budgets). Output validation enforced; invalid output fails the run. Per-skill default budgets resolve through `core/agent-runtime/budgets.ts` (see CONTEXT.md "Centralized Skill Budgets").

The sub-sections below describe the **production skill chain** — skills wired into a workflow. The repo also contains **test/helper skills** that are not part of the chain: `echo-test`, `echo-test-holdout` (M4 spike, holdout-boundary regression), `repo-match` (called from inside Triage), `evidence-post`, `bug-enhance`, `playwright-repro`, `resolve-conflict`, `spec-author`, `advise-on-plan`. They follow the same skill-package convention but do not own a state transition.

### 13.1 Triage

Two verdicts: accept or reject. Labels `type:*`, `priority:*`, optionally `mode:*`.

### 13.2 Grill-me (M13)

Mat Pocock pattern. Human-in-loop chat. Issue at `factory:grilling`. Output: refined intent doc as comment.

### 13.3 Write-PRD (M13, with optional advisor)

Fresh-context. Reads only refined intent. Outputs structured PRD. If advisor enabled and `priority:high|critical`, advisor reviews in fresh context. One revision pass max.

### 13.4 Decompose-to-issues (M13)

Reads approved PRD. Outputs vertical slices as GitHub issues *in the same target repo*. Each child is end-to-end shippable, parent-referenced, milestone+scheduling+concurrency labelled.

### 13.5 Investigate (M6)

Three-tier repo matcher. Investigator agent reads code in workspace, produces structured findings. For `type:bug`, also triggers `playwright-repro`.

### 13.6 Implement (M7, with optional advisor on plan)

TDD-first. Plan → optional advisor → tests → implementation → tests pass → lint pass → PR opened. Uses project's stack commands.

### 13.7 QA (M8, holdout — no advisor, no down-tier fallback)

Fresh-context. Reads original issue, PR diff, slice's tests, project commands. Does NOT read investigation, implementation reasoning, decision summaries.

### 13.8 Review (M8, holdout — no advisor, no down-tier fallback)

Fresh-context after QA passes. Same context as QA + QA results. Verdict: approved | needs-fix | needs-human.

### 13.9 Retrospective (M9, tiered)

**Light retro (default):** thin 3-bullet summary, obvious improvement candidates only. ~10% of retro cost.

**Deep retro (triggered):** full schema. Triggers (configurable per project):
- Failed QA at any point
- ≥2 retry attempts
- Budget exceeded
- Escalation to needs-human
- `priority:high` or `priority:critical`
- First run of a new skill

### 13.10 Research-analysis

Given URL, fetches transcript or text, runs structured analysis. Output stored as comment. If `relevance >= 0.7`, candidate `type:feature` issue created in the target repo. Research issues never auto-trigger builds.

### 13.11 Bootstrap-project (M12)

1. Verify GitHub access
2. Detect stack (read `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, etc.)
3. Audit `CLAUDE.md` (create if missing, propose human-reviewable updates if present)
4. Install `factory:*` label set on the repo
5. Scaffold `target-projects/<slug>/` with `project.config.ts`, `MISSION.md`, `FACTORY_RULES.md`, `personas/` seeds
6. Open a PR in Goose Hub repo registering the new project, tagged `factory:bootstrap-pr` (this label allows the governance check to permit creation of governance files in this PR only)

Webhook installation is **deferred** to manual setup; bootstrap outputs instructions.

---

## 14. Structured output schemas

Per-skill Zod schemas. v0 includes:

- TriageOutput
- RepoMatchOutput
- InvestigationOutput
- QAOutput
- ReviewOutput
- LightRetroOutput, DeepRetroOutput
- ResearchOutput
- BootstrapOutput
- AdvisorOutput

Schemas are versioned by folder if they ever break (`skills/triage/v1`, `v2`). Migration is manual when the time comes.

(Schemas as defined in v2.1 sections 14.1–14.8, with minor additions for `LightRetroOutput`.)

---

## 15. Modes and gates

### 15.1 Modes

| Mode | Trigger | Gates | Use case |
|---|---|---|---|
| `interactive` | User on demand | All gates manual | Active investigation, exploration |
| `supervised` | Webhook from source | PRD approval, Review approval = human gates | Work, client code, Goose Hub itself |
| `autonomous` | Cron tick (M16+) | Holdout validator only | Personal monorepo, low-stakes side projects |

### 15.2 Gate behaviour

```ts
async function gate(ctx: WorkflowContext, kind: GateKind): Promise<GateResult> {
  if (ctx.project.mode === 'autonomous') {
    return { proceed: true, reason: 'autonomous-mode-skip' }
  }
  await ctx.source.transitionState(ctx.workItem.id, currentState, 'factory:gate-pending')
  ctx.emit({ type: 'gate.awaiting-human', kind })
  return { proceed: false, reason: 'awaiting-human' }
}
```

### 15.3 Per-issue mode override

`mode:supervised` or `mode:autonomous` label overrides project default.

---

## 16. Advisor mode

### 16.1 What it is

Higher-tier model that reviews a primary agent's output before commit, in fresh context. Verdict: `proceed`, `revise`, `abort`. Never used to do work.

### 16.2 Where it applies (v0)

- **PRD writing** (M13) — advisor reviews PRD draft for completeness
- **Dev planning** (M7) — advisor reviews implementation plan before code is written

### 16.3 Hard rules

1. Never on QA. Never on Review. Holdouts stay holdouts.
2. Always fresh context. Sees only original task + primary's output. No chat history, no plan reasoning, no decision summaries.
3. Verdict is `proceed`/`revise`/`abort`. Never produces work artefacts.
4. Maximum **one revision pass**. Second flag escalates to `factory:needs-human`.
5. **Disabled by default in autonomous mode.** Cost-spiral guard. Explicit opt-in per project.
6. Triggers on `priority:high|critical` only by default.
7. Advisor budget is separate (`perAdvisorMaxUsd`). When exceeded, advisor is **skipped** but the skip is **timeline-visible** (`advisor.budget-skipped` event). Workflow proceeds with primary output as-is.

---

## 17. Fallback and model policy

### 17.1 Fallback wrapping

`core/agent-runtime/fallback.ts` wraps every primary call. On primary error (rate limit, timeout, content filter, transport failure), fallback runs once. Logged as `model.fallback-triggered`.

### 17.2 Fallback policy by priority

`core/budgets/fallback-policy.ts` enforces:

- **`priority:critical`** → fallback must be **same-tier or better** (e.g. Sonnet→Opus, never Sonnet→Haiku). If no same-tier fallback configured, escalate to `factory:needs-human`.
- **`priority:high`** → same as critical.
- **`priority:medium`** → down-tier fallback allowed.
- **`priority:low`** → down-tier fallback allowed.
- **Holdouts (QA, Reviewer)** → no down-tier fallback regardless of priority. If primary fails, escalate (do not silently degrade independent validation).

### 17.3 Configuration

Per-role `rolesModels` declares `primary`, `fallback`, `advisor`. `fallback: null` means "no fallback; escalate on primary failure."

---

## 18. Isolation strategy

### 18.1 Layer 1: tool-layer sandboxing (all modes)

Path sandboxing + bash denylist + per-role tool allowlist. **Defense in depth, not a sandbox.** Catches obvious mistakes; cannot prevent a determined or malfunctioning agent from causing damage.

```ts
const guardPath = (path: string, ctx: ToolCtx) => {
  if (!resolve(path).startsWith(resolve(ctx.workspace.root) + '/')) {
    throw new ToolViolation('path outside workspace', { path })
  }
}

const BASH_DENY: RegExp[] = [
  /\brm\s+-rf?\s+\//,
  /\bsudo\b/,
  /\bchmod\s+-R\b/,
  /\bmv\s+\S+\s+\/\s*$/,
  />\s*\/dev\//,
  /\bdocker\s+/,
  /\bcurl[^|]*\|\s*sh/,
]
```

Known weakness: `python -c`, `node -e`, `find -delete`, npm postinstall scripts, symlink traversal, and many other patterns can bypass regex denylist. The real safety in supervised mode is the human PR review.

### 18.2 Layer 2: Docker per agent run (M16, autonomous mode)

Projects with `isolation.mode: 'docker'`: every agent run executes inside fresh container. Image: minimal alpine + node + git + claude-cli. Workspace bind-mounted. Network restricted to allowlist. Required for autonomous mode because the human gate is removed.

### 18.3 Layer 3: machine-scoped projects (Work)

Work projects declare `machineScope`. Factory checks condition before loading. **Important:** machine-scoping prevents accidental *spawning* of work-mode workflows. It does NOT prevent *cached* operational state from previous runs from being on a non-work machine. Real Work data isolation requires either separate database files per machine scope or strict policy that Work projects only run on Work machines.

For v0, the policy is: do not register a `machine_scoped` project on a personal machine. Operational consequences of doing so (cached agent outputs, retrospectives, persona stats containing work code snippets) are user responsibility.

---

## 19. Workspaces and target repos

### 19.1 Workspace lifecycle

```
agent run starts
    ↓
git worktree add ~/.factory/workspaces/<run-id> <branch>
    ↓
agent operates inside ~/.factory/workspaces/<run-id>
    ↓
agent commits, pushes branch, opens PR
    ↓
on success or timeout:
  git worktree remove ~/.factory/workspaces/<run-id>
```

### 19.2 Worktrees are workflow boundaries, not isolation boundaries

The worktree is removed after a run. The underlying repo's `.git`, hooks, packed refs, lock files, shared package caches, and remote state may have been modified (branches pushed, hooks triggered, npm postinstall scripts run, etc.).

Do not assume "workspace removed" means "no side effects." It means "this run's working tree is gone." Side effects on `.git` and remotes persist.

### 19.3 Vertical slices in target repos

Decompose outputs slices in the target repo's `slices/` folder (when the convention is adopted by that repo). Repos that don't follow the convention fall back to existing structure — Goose Hub still works, just without slice-test guarantee. Bootstrap detects existing structure and updates the target repo's `CLAUDE.md` accordingly.

---

## 20. Funnels

1. **Direct** — file an issue manually in the target repo
2. **Inbox UI** — capture modal in Goose Hub. Lands in project-agnostic Inbox. Promote-to-project converts to issue *in the chosen target repo*.
3. **Research lane** — submit URL → analysis → research issue → optional candidate feature
4. **Conversation capture** — paste chat snippet → triage → draft issues
5. **External webhook** — Jira/Linear webhooks (M14+)
6. **Slack `/capture`** — M15+ only

---

## 21. UI surfaces

In priority order (status as of M11 mid-milestone):

1. Global chrome (sidebar, top bar, command palette) — shipped (M2+)
2. Kanban — per-project shipped (M2); All Projects aggregated shipped (M10)
3. Inbox (project-agnostic capture, target-repo picker on promote) — shipped (M3+)
4. Task detail — slide-in tabs: Overview, Investigation, PRD (M13), Code, QA, Review, Retrospective, Timeline, Chat (M13), Costs. All non-M13 tabs shipped through M9.
5. Roster (personas with metrics) — shipped (M9); cross-project filter at `/projects/all/roster` (M10)
6. Milestones (set-active per project, sprint review) — per-project active milestone shipped (M10); sprint review surface still pending
7. Settings → Projects (read-only per-project config viewer) — shipped (M10). Models, hooks, budgets, governance, lane overrides editing surfaces still pending
8. Project bootstrap wizard (M12+)
9. Office tab (M17 skin, optional)

Costs in UI are labelled **estimated** when inferred from Claude CLI; **exact** when authoritative (see CONTEXT.md "Cost Module").

---

## 22. Agent decision summaries and observability

> **Three observability streams (see CONTEXT.md "Decision Summary" entries for the canonical design and ADR 0018 for the `kind` taxonomy):**
> 1. **Canonical decision summaries** — `decisionSummaries: Array<{kind, summary, evidence?}>` in each skill's Zod schema; orchestrator extracts from validated terminal output and emits as `agent.decision-summary` events post-validation.
> 2. **Live `[decision]` markers** — best-effort mid-run progress in `[decision] KIND: <one sentence>` form, scanned out of the transcript by the PostToolUse hook. `KIND` is constrained to `DecisionKindSchema` in `core/agent-runtime/decision-types.ts`; unknown kinds coerce to `UNKNOWN`.
> 3. **Tool-call audit (`agent.tool-call`)** — automatic per-call event from the PreToolUse hook with redacted inputs. No reasoning, no skill-author burden. Distinct stream at distinct cadence.

### 22.1 What they are

Single-sentence events emitted by an agent at decision points. Examples:
- "Selected payments-api as primary repo based on keyword match + code search hits"
- "Implementation plan: add validation in src/api/handlers.ts and update tests in slices/0042"
- "Tried query X, got no results, switching to query Y"

**Not raw chain-of-thought.** Not stream-of-consciousness logs. Decision summaries.

### 22.2 Constraints

Agents must NOT include in decision summaries:
- Raw credentials, API keys, tokens
- Large file contents (>200 chars per summary)
- PII
- Full conversation history
- Code review reasoning when the agent is a holdout

`core/tool-layer/secret-redaction.ts` redacts known secret patterns (env-var-style, AWS-style, GitHub-token-style) before persisting events. Redaction is best-effort; agents must still write summaries that don't contain secrets.

### 22.3 Holdout enforcement

QA and Review agents declare `contextAllowlist` to opt in to a small set of keys (e.g. `workItem`, `prDiff`, `sliceTests`, `projectCommands`). The orchestrator filters `spec.context` against this allowlist in `assembleSpawnContext()` before XML rendering, so keys like `investigationFindings` or `devDecisionSummaries` are never injected. A disallowed key on a holdout role emits a `tool.violation` event (one per key) — see ADR 0014 and CONTEXT.md "Holdout Enforcement Internals".

### 22.4 Event taxonomy

```
workflow.started, workflow.node.started, workflow.node.completed, workflow.node.failed, workflow.completed
agent.spawned, agent.decision-summary, agent.tool.call, agent.tool.result, agent.message, agent.terminated
advisor.invoked, advisor.verdict, advisor.revision-triggered, advisor.budget-skipped
model.fallback-triggered, model.escalated-to-human-no-fallback
state.transitioned, state.conflict-resolved, state.changed-during-run
pr.opened, pr.merged, pr.closed
budget.warning, budget.exceeded, flood-protection.triggered
gate.awaiting-human, gate.approved, gate.rejected
tool.violation, governance.violation, governance.bootstrap-allowed
retrospective.improvement-flagged, persona.stats-updated
milestone.activated, milestone.completed
bootstrap.stack-detected, bootstrap.claude-md-updated, bootstrap.labels-installed
```

---

## 23. Personas

Per-card named instances per role with persistent stats. M9 ships personas with stats; self-improvement *suggestions* defer until later (M9 records candidates; doesn't auto-apply).

### 23.1 Persona model

```ts
interface Persona {
  id: string
  name: string
  role: Role
  projectId: string
  bio: string
  avatar: string
  preferredModelTier?: ModelTier
  preferredTools?: ToolName[]
  stats: PersonaStats
}

interface PersonaStats {
  cardsCompleted: number
  successRate: number
  confidenceCalibration: number
  avgTokensPerTask: number
  avgDurationMinutes: number
  toolUsageHistogram: Record<ToolName, number>
  commonFailureModes: string[]
  level: number
  xp: number
  badges: Badge[]
}
```

Project-scoped. Seed 3 per role per project. Stats in DB; configs in `target-projects/<slug>/personas/`.

---

## 24. Local database

Single SQLite file: `~/.factory/data/factory.db`. Drizzle ORM. Backed up periodically (manual responsibility for v0; documented runbook).

Tables: `project_state`, `agent_runs`, `events`, `personas`, `inbox_notes`, `budget_counters`, `governance_audit`, `improvement_candidates`, `flood_protection`, `milestone_meta`.

Goose Hub IS authoritative for everything in this DB. Wipe = loss of operational history. Inbox notes are the only authoritative-only-here data; backup of `factory.db` is a real concern.

---

## 25. Budgets, locks, flood protection

- **Per agent run:** `perAgentMaxUsd`
- **Per advisor run:** `perAdvisorMaxUsd` (skip silently to workflow, visibly to UI)
- **Per workflow:** `perWorkflowMaxUsd`
- **Per project per day:** `dailyTokens`
- **Locks:** one workflow per project at a time (M11 relaxes for multi-issue parallel)
- **Flood protection:** non-owner issues capped per day per project
- **Tool violations:** hard fail, label `factory:tool-violation`, human review

---

## 26. Governance

### 26.1 Seed files (immutable after creation)

`MISSION.md`, `FACTORY_RULES.md`, `CLAUDE.md` in repo root.

### 26.2 Per-project governance

Each `target-projects/<slug>/` has its own `MISSION.md`, `FACTORY_RULES.md`. Override or extend root.

### 26.3 Per-target-repo `CLAUDE.md`

Bootstrap creates or updates target repo `CLAUDE.md`. After creation, immutable to Factory.

### 26.4 PR check

```ts
async function checkGovernance(diff: Diff, project: ProjectConfig, prLabels: string[]): Promise<GovernanceResult> {
  const isBootstrap = prLabels.includes('factory:bootstrap-pr')
  const violations: string[] = []
  for (const file of diff.changedFiles) {
    if (matchesAny(file.path, project.governance.immutablePaths)) {
      if (file.status === 'added' && isBootstrap) {
        // Allowed: bootstrap is creating governance files for the first time
        continue
      }
      violations.push(`${file.status}:${file.path}`)
    }
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations }
}
```

### 26.5 Bootstrap exception

Governance files can be **created** (`status === 'added'`) in PRs tagged `factory:bootstrap-pr`. They cannot be modified or deleted, ever, by any Factory PR. The bootstrap label is itself protected: only the bootstrap workflow can apply it. Manual application of the label by a human is permitted (humans can do anything via direct repo access; this is fine).

---

## 27. Non-negotiable rules (FACTORY_RULES.md content)

1. The Reviewer and QA agents never see implementation reasoning, plans, decision summaries, or chat history. They check outcome against original issue.
2. Triage has only two verdicts: accept or reject. No "needs human" middle state.
3. Governance files cannot be **modified** by any Factory PR. They can be **created** only in PRs tagged `factory:bootstrap-pr`. Hard-fail PR check otherwise.
4. One workflow at a time per project (M11+ may relax to one workflow per work item with project-level lock removed).
5. Per-project budget caps enforced before workflow start and at every agent spawn.
6. Flood protection: non-owner issues capped at `maxIssuesPerDayFromNonOwners`.
7. Every workflow node has a max budget. Triage batches max 10 issues, body trunc 2KB.
8. Fix attempts capped at `maxRetries`. After cap, escalate `factory:needs-human`.
9. Fix steps run in fresh agent context. Validator on next pass is true holdout.
10. Skills are versioned markdown with JSON schemas. Inline prompts forbidden in code.
11. Every feature ships as a vertical slice including only the surfaces it touches; `slice.test.ts` and `README.md` required.
12. Tool calls outside an agent's role allowlist are rejected at dispatcher with logged event.
13. No new heavyweight dependencies (vector DB, embedding service, etc.) without explicit human approval and an ADR.
14. The orchestrator is stateless across ticks. Work-item state lives in source of truth; operational state in local DB.
15. Autonomous mode requires Docker isolation. Supervised mode runs natively (and is observational, not isolated).
16. QA runs before Review. Sequential. Review never sees a PR that QA didn't validate.
17. Every agent run produces JSON conforming to its skill schema. Invalid output fails the run.
18. Retrospective runs after every successful merge. Light by default; deep on triggers. Improvement candidates surface as Factory issues in the relevant target repo.
19. Agents emit `agent.decision-summary` events at decision points (single-sentence, no chain-of-thought, no secrets, no PII). Silent agents fail review.
20. Advisor never runs on QA or Review. Holdouts remain holdouts.
21. Advisor revisions capped at one. After that, escalate to human.
22. Advisor disabled by default in autonomous mode. Explicit opt-in per project.
23. Each project's source of truth lives in its own repository's issue tracker (or workspace, for Jira/Linear). Goose Hub never centralises authority over work items.
24. Cross-repo dependencies (`Depends on owner/repo#N`) require the dependency repo to be a registered target project. Otherwise the issue moves to `factory:needs-human`.
25. Bootstrap is required before any other workflow runs against a target project. No workflows on unbootstrapped projects.
26. State labels live on **issues**, not PRs. PR labels are decorative only.
27. Fallback never down-tiers on `priority:critical` or `priority:high`. Fallback is forbidden on holdouts (QA, Reviewer); on primary failure, escalate.
28. CI YAML in `.github/workflows/` is allowed and expected. Product workflow YAML is forbidden — product workflows are TypeScript modules in `core/orchestrator/workflows/`.

---

## 28. Milestone plan (M0–M18)

The plan is staged as **vertical-slice milestones**. Each milestone is a working capability, not a layer. M0 is preamble (no GitHub milestone). M1–M18 are real GitHub Milestones in `shaunnez/goose-hub`. M17 and M18 are optional polish.

For every milestone:

1. **Outcome** — what user-facing capability exists at the end
2. **Included scope** — what's in
3. **Explicit exclusions** — what's deliberately NOT in
4. **Dependencies** — earlier milestones required
5. **Exit criteria** — the specific test that proves done
6. **Why vertically useful** — what value ships
7. **Rough GitHub issues** — the slices that fall out of decompose
8. **Defer list** — features moved to later milestones

---

### M0. Preamble

**Outcome:** the foundation exists outside of any GitHub milestone — repo, immutable docs, decisions made, ready to file the first issue.

**Included scope:**
- Repo created at `shaunnez/goose-hub`
- Stack confirmed (Node + pnpm + TypeScript + Drizzle + SQLite + React + Vite + shadcn/ui + Biome + Vitest + Playwright + Zod)
- `MISSION.md` written and committed (extracted from sections 1–2 of this document)
- `FACTORY_RULES.md` written and committed (extracted from section 27)
- `CLAUDE.md` (root) written and committed (how AI agents should approach this repo)
- This document committed at `docs/PLAN.md`
- Reference audit decision: **audit happens in M1, not before M1** — no porting of existing harness code occurs in M0
- First GitHub Milestone created in the repo: "M1: Bootstrap Source of Truth"
- Open questions resolved (section 31)

**Explicit exclusions:**
- No code beyond config files
- No CLI yet
- No DB schema
- No reference code ported

**Dependencies:** none

**Exit criteria:** the repo exists, the four immutable docs are merged, and "M1" milestone exists in GitHub Issues with at least one issue inside.

**Why vertically useful:** turns the plan into a thing in the world. Without M0, every subsequent milestone has nothing to attach to.

**Rough GitHub issues:** none — M0 is hand-done.

**Defer list:**
- Reference audit → M1
- DB schema → M1
- CLI → M1

---

### M1. Bootstrap Source of Truth

**Outcome:** Goose Hub can read its own GitHub issues from the command line and report state, with all conflict cases handled.

**Included scope:**
- `core/state-machine/states.ts` — typed enum of all 23 canonical states
- `core/state-machine/transitions.ts` — legal transition table (which states can move to which)
- `core/state-machine/conflict-resolver.ts` — rules from section 9.3
- `core/state-source/interface.ts` and `core/state-source/github-labels.ts`
- Local SQLite schema via Drizzle: `project_state`, `events`, `governance_audit` tables (others added later)
- `target-projects/goose-hub-self/project.config.ts`
- `target-projects/goose-hub-self/MISSION.md` and `FACTORY_RULES.md`
- Manual installer script: `scripts/install-labels.ts` — installs `factory:*` labels on the target repo (bootstrap full workflow comes in M12)
- CLI: `goose status <project-slug>` reads real GitHub issues, prints active milestone, issues, current factory state per issue, label conflict warnings, transition validity summary
- Reference audit: `docs/reference-audit.md` documenting reusable patterns from existing harness, what to port, what to avoid
- GitHub Actions CI: lint + typecheck + test

**Explicit exclusions:**
- No UI
- No agents
- No workflows beyond what `goose status` does (read-only)
- No webhook handling
- No Inbox
- No write operations from Goose Hub to GitHub (only the manual label installer script writes)

**Dependencies:** M0

**Exit criteria:** running `goose status goose-hub-self` against the real `shaunnez/goose-hub` repo prints the live state of issues with conflict warnings where applicable. Unit tests pass for all 7 conflict resolution cases (section 9.3). Reference audit document committed.

**Why vertically useful:** proves the foundation. Confirms the abstraction works against real GitHub before any UI or agents are built. Without this, every later milestone has unverified bedrock.

**Rough GitHub issues:**
1. Define typed state enum in `core/state-machine/states.ts`
2. Define legal transition table in `core/state-machine/transitions.ts`
3. Implement label conflict resolver with unit tests
4. SQLite schema and Drizzle migrations for `project_state`, `events`, `governance_audit`
5. `StateSource` interface
6. `GitHubLabelsSource` implementation
7. `scripts/install-labels.ts` — install factory:* labels on a repo
8. `target-projects/goose-hub-self/` config files
9. `goose status <slug>` CLI command
10. Reference audit document
11. GitHub Actions CI workflow

**Defer list:**
- Webhook handling → M2 or M3
- Write transitions from Goose Hub → M2 or M3
- Inbox capture → M3
- UI of any kind → M2

---

### M2. First Operable UI

**Outcome:** a working UI that reads real GitHub issues, displays them in a Kanban, and supports one minimal write action: manually transitioning an issue through a valid state change. Read-mostly with one write path.

**Included scope:**
- `apps/server` skeleton: serves API for the UI, hosts SSE event stream
- `apps/web`: React + Vite + shadcn/ui scaffold
- App shell: left sidebar (project switcher, milestone selector), top bar
- Project switcher (only goose-hub-self for now)
- Milestone selector (reads milestones from GitHub via the StateSource adapter; sets active milestone in `project_state`)
- Kanban board with the 9 default-visible lanes
- Issue cards showing title, state, priority, type
- Issue detail drawer (read-only for now): description, labels, timeline of events from local DB
- One write action: "Transition state" button on issue detail. Validates against legal transition table; rejects illegal transitions with a clear error.
- Timeline panel showing events from `events` table
- Playwright happy-path test: open app, select project, see issues, open detail, transition state successfully

**Explicit exclusions:**
- No agents
- No workflows
- No gate handling beyond reading state
- No Inbox UI
- No fake agent runs
- No cost tracking
- No advisor or fallback (no agents to apply them to)

**Dependencies:** M1

**Exit criteria:** Playwright happy-path passes against real GitHub data. User can: open Goose Hub, see goose-hub-self's Kanban with real issues, click an issue, manually transition it from one valid state to another (e.g. `factory:triaging` → `factory:accepted`), see the new state reflected on GitHub within seconds.

**Why vertically useful:** proves the UI is connected to the real source of truth. The shape of every later milestone (cards, drawer, timeline, transitions) is validated against real data, not mocks.

**Rough GitHub issues:**
1. `apps/server` API skeleton with SSE endpoint
2. `apps/web` Vite + React + shadcn/ui scaffold
3. App chrome: sidebar + top bar
4. Project switcher component
5. Milestone selector component (reads + writes active milestone)
6. Kanban board layout with lane config
7. Issue card component
8. Issue detail drawer (read-only view + state transition button)
9. Timeline panel (reads events table)
10. Manual state transition flow with legal-transition validation
11. Playwright happy-path test

**Defer list:**
- Gate states/approval UI → M3
- Fake agent runs → M3
- Inbox UI → M3
- Cost tracking → M9 (deep retro brings it)
- All Projects view → M10

---

### M3. Manual Workflow Cockpit

**Outcome:** the full manual workflow can be operated through Goose Hub — including gate handling, fake agent runs (placeholders for the runtime spike to come), and a richer task detail experience. No real agents yet, but the entire shape of the workflow is exercised.

**Included scope:**
- Gate-pending state surfaced prominently on issue detail
- Approve / reject / request-changes actions on gated states (`factory:prd-review`, `factory:approved`)
- Fake agent runs: "Start fake triage", "Start fake investigation" buttons that emit canned `agent.spawned`, `agent.decision-summary`, `agent.terminated` events with hardcoded delays. Validates the timeline UX without real agents.
- Fake structured outputs (canned JSON) attached to fake runs
- Fake logs streamed via SSE during fake runs
- Inbox UI: capture modal, list view, promote-to-project flow with target-repo picker
- Manual workflow actions: move state, add comment, attach link, assign milestone, change priority/schedule labels
- Cost/duration placeholders on cards (showing "—" or "estimated $0.00")
- Improved timeline events: state transitions, fake agent events, gate decisions, manual actions all visible
- Playwright tests: capture-to-promote flow, gate-pending → approve → next state, fake agent run lifecycle visible in timeline

**Explicit exclusions:**
- No real agents
- No real Claude CLI invocation
- No retrospective
- No real cost tracking (placeholders only)
- No advisor or fallback
- No autonomous mode
- No real workflows in `core/orchestrator/workflows/` — fake handlers only

**Dependencies:** M2

**Exit criteria:** user can drive a synthetic feature from `factory:triaging` all the way to `factory:done` entirely through the UI using fake agent runs and manual gates. Playwright tests cover capture, gate, full lifecycle.

**Why vertically useful:** proves the *whole product shape* before any real agent risk. If something is wrong in the workflow concept, this is where it surfaces — cheaply.

**Rough GitHub issues:**
1. Gate-pending state UI surface
2. Approve/reject/request-changes actions
3. Fake agent run dispatcher (emits canned events on a timer)
4. Fake structured output attachment
5. Inbox capture modal
6. Inbox list view + promote-to-project
7. Target-repo picker on promotion
8. Manual workflow actions (label edits, milestone, schedule)
9. Improved timeline event rendering
10. Cost/duration placeholders
11. Playwright tests for full manual lifecycle

**Defer list:**
- Real agents → M4
- Real cost tracking → M9
- Retrospective → M9
- Multi-project → M10

---

### M4. Controlled Claude CLI Runtime Spike

**Outcome:** the `AgentRuntime` interface is real and runs Claude CLI as a subprocess for one tightly-scoped use case (e.g. echo-back-JSON validation). Fresh-context, decision-summary events, output-schema validation, and secret redaction are all in place. No production workflows use it yet.

**Included scope:**
- `core/agent-runtime/interface.ts`
- `core/agent-runtime/claude-cli.ts` — wraps Claude CLI as subprocess
- `core/agent-runtime/fresh-context.ts` — context allowlist enforcement
- `core/event-stream/store.ts` — append-only event store with secret redaction
- `core/tool-layer/secret-redaction.ts` — patterns for env-var, AWS, GitHub-token-style redaction
- `core/agent-runtime/fallback.ts` — fallback wrapping with policy enforcement (section 17)
- One trivial skill: `skills/echo-test/` — agent receives a structured prompt, returns canned-shape JSON. Used to prove the runtime end-to-end.
- CLI: `goose run-agent --skill=echo-test --input='{"foo":"bar"}'` — runs the skill, streams events, validates output, prints result
- Decision-summary events emitted from the test skill
- Output schema validation: invalid JSON fails the run with a clear error
- Tool layer: bash denylist + path sandboxing + tool allowlist (no agents using tools yet, but the layer is in place for M5+)

**Explicit exclusions:**
- No real triage, investigation, or dev agent
- No advisor mode
- No worktree creation (workspace is just `~/.factory/workspaces/<run-id>` empty dir)
- No webhook handling
- No production workflows wired into orchestrator
- No retrospective
- No persona stats

**Dependencies:** M3

**Exit criteria:** running `goose run-agent --skill=echo-test ...` produces a successfully validated run with decision-summary events visible in the UI's Timeline. Holdout test: a second variant skill `echo-test-holdout` confirms that when `contextAllowlist` excludes a key, the runtime refuses to inject it. Secret redaction unit tests pass.

**Why vertically useful:** proves the dangerous part (running real AI with real subprocess and tool access) in a contained way. From here, every subsequent skill is "do this same thing but with a real prompt."

**Rough GitHub issues:**
1. `AgentRuntime` interface
2. Claude CLI subprocess wrapper
3. Fresh-context allowlist enforcement
4. Event store with append-only semantics
5. Secret redaction patterns and unit tests
6. Output schema validation pipeline
7. Fallback wrapping with priority-aware policy
8. Tool layer (bundles, allowlist, sandbox, denylist)
9. `skills/echo-test/` — trivial echo-back skill
10. `goose run-agent` CLI command
11. Decision-summary event integration with timeline UI
12. Holdout enforcement test (`skills/echo-test-holdout/`)

**Defer list:**
- Real prompts (triage, investigate, dev) → M5+
- Worktree creation → M6 (when investigation needs a real repo)
- Advisor mode → M7
- Tool execution against real targets → M5+

---

### M5. Real Triage and Repo Matching

**Outcome:** real Claude-driven triage and repo matching. New issues created in `shaunnez/goose-hub` are auto-classified, labelled, and have repo candidates attached.

**Included scope:**
- `skills/triage/` — full prompt + schema + config
- `skills/repo-match/` — three-tier matcher (keyword → code search → semantic fallback)
- Workflows: `triage-batch.ts`
- Webhook handling: GitHub issue creation triggers `tick(goose-hub-self)` → triage runs
- Repo candidate model: candidates attached as a comment + structured data in `events`
- UI: triage results visible in issue detail (type, priority, repo candidates with confidence and evidence)
- UI: human override on repo selection
- Manual repo allowlist for goose-hub-self (just `shaunnez/goose-hub` for now)

**Explicit exclusions:**
- No investigation yet
- No dev workflow yet
- No grill-me / PRD / decompose
- No advisor on triage
- No multi-repo matching (only matches against the one allowlisted repo)
- No Bitbucket adapter yet (M14)

**Dependencies:** M4

**Exit criteria:** filing a new issue in `shaunnez/goose-hub` results in: triage runs within 60 seconds, issue gets `type:*` and `priority:*` labels, repo candidate attached as comment, state moves to `factory:accepted`. Human can override repo selection through the UI.

**Why vertically useful:** the first real agent value. Issues file → automatic classification. Replaces a manual step with a real working agent.

**Rough GitHub issues:**
1. `skills/triage/` full implementation
2. `skills/repo-match/` three-tier matcher
3. `triage-batch` workflow
4. Webhook endpoint and verification
5. Repo candidate data model and storage
6. Issue detail UI for triage results
7. Repo override UI
8. End-to-end test: file issue, see triage complete, override repo

**Defer list:**
- Advisor on triage → won't do; triage is too cheap
- Multi-repo matching → M14
- Investigation skill → M6

---

### M6. Investigation Workflow

**Outcome:** for `type:bug` issues, an investigator agent reads the target repo (in a worktree), produces structured findings, identifies key files, states confidence, and surfaces open questions. For bugs, also captures Playwright repro of the broken behaviour.

**Included scope:**
- `core/workspaces/worktree.ts` — git worktree creation and cleanup
- `skills/investigate/` — investigator skill with structured output
- `skills/playwright-repro/` — captures broken-behaviour screenshots/video for bugs
- Workflow: `investigate.ts` — handles `factory:investigating` → `factory:investigation-complete`
- Tool: `read` (filesystem read within workspace), `search` (ripgrep against workspace)
- Investigation tab in task detail (findings, confidence, key files, open questions)
- Code tab in task detail (Playwright captures rendered with before-state)
- Holdout enforcement: investigator's decision-summaries saved but not exposed to QA/Reviewer in M8

**Explicit exclusions:**
- No dev workflow yet
- No write operations against the workspace
- No Playwright in CI yet (Playwright is for capturing repro only at this point)
- No advisor on investigator (already opus-tier)
- No multi-repo investigation (one repo per project for v0)

**Dependencies:** M5

**Exit criteria:** filing a `type:bug` issue with a clear repro description results in: triage runs (M5), investigation runs, structured findings appear in the Investigation tab, key files highlighted, confidence stated, Playwright before-state captured. Issue ends in `factory:investigation-complete` and is moved to `factory:dev-ready` ready for M7.

**Why vertically useful:** the first real read-against-target-repo agent. Bugs become actionable artefacts before any code is written.

**Rough GitHub issues:**
1. Worktree creation and cleanup
2. `read` and `search` tools with workspace sandboxing
3. `skills/investigate/` full implementation
4. `skills/playwright-repro/` for bug capture
5. `investigate` workflow
6. Investigation tab UI
7. Code tab UI with Playwright capture rendering
8. End-to-end bug investigation test

**Defer list:**
- Dev workflow → M7
- QA Playwright validation → M8
- Multi-repo investigation → much later
- Self-improving investigator prompt → never auto-applied; M9 records suggestions

---

### M7. Supervised Dev Workflow

**Outcome:** the developer agent picks up `factory:dev-ready` issues, opens worktrees, writes a plan (advisor-reviewed for high/critical), writes failing tests, writes implementation, runs tests + lint, opens a PR. Human approves the PR through the gate.

**Included scope:**
- `skills/implement/` — TDD-first developer skill
- `skills/advise-on-plan/` — advisor for developer plan, fresh context
- `core/agent-runtime/advisor.ts` — advisor wrapping for runtime
- Workflow: `fix-issue.ts` — handles `factory:dev-ready` → `factory:in-progress` → PR opened
- Tools: `write` (workspace-bound write), `bash` (with denylist), `test` (runs project's `testCommand`)
- PR opened with link back to issue, triggers `factory:in-progress`
- Issue detail Code tab now shows live diff
- Human approval gate on `factory:approved` (M8 will add QA + Review before this state)
- Until M8 ships, the workflow goes straight to `factory:approved` (gate) — QA/Review states exist but the workflow skips them

**Explicit exclusions:**
- No QA agent yet (M8)
- No Review agent yet (M8)
- No retrospective yet (M9)
- No autonomous mode
- No multi-project parallel dev
- No advisor budget budgeting beyond simple cap

**Dependencies:** M6

**Exit criteria:** a `type:chore` or `type:bug` (with M6 investigation complete) issue can run end-to-end through Dev: plan written, advisor reviews if priority high/critical, tests written, implementation written, all tests pass, lint passes, PR opens, human approves at the gate, PR merges, issue closes. Test on a small Goose Hub feature shipped this way.

**Why vertically useful:** Dev is the value-creating step. Everything before this is preamble; this is where Goose Hub actually ships software. Even without QA and Review, the human reviewing every PR is the real safety net (principle 13).

**Rough GitHub issues:**
1. `write`, `bash`, `test` tools with sandboxing
2. `skills/implement/` TDD-first
3. `skills/advise-on-plan/` advisor skill
4. `core/agent-runtime/advisor.ts` wrapping
5. `fix-issue` workflow
6. PR opening via GitHub connector
7. Live diff in Code tab
8. Human approval gate UI on `factory:approved`
9. End-to-end chore-shipping test

**Defer list:**
- QA → M8
- Review → M8
- Retrospective → M9
- Autonomous → M16

---

### M8. QA and Review Holdouts

**Outcome:** sequential QA → Review runs after Dev. Both are holdouts: fresh context, no implementation reasoning, no decision summaries from the Developer. QA runs first; if it passes, Review runs. Both must pass for `factory:approved`.

**Included scope:**
- `skills/qa/` — runs lint, tests, Playwright (project's `testCommand` + `lintCommand` + `e2eCommand`)
- `skills/review/` — diff review against original issue
- Holdout enforcement: `contextAllowlist` for QA and Review excludes implementation reasoning
- Workflow: `run-qa.ts` — handles `factory:needs-qa` → `factory:needs-review` or `factory:qa-failed`
- Workflow: `run-review.ts` — handles `factory:needs-review` → `factory:approved` or `factory:needs-fix` or `factory:needs-human`
- Updated `fix-issue` workflow to transition to `factory:needs-qa` after PR opens (instead of straight to `factory:approved` as in M7)
- QA tab and Review tab in task detail with verdicts visible
- Retry logic: `factory:qa-failed` and `factory:needs-fix` count toward `maxRetries`; fix runs are fresh-context
- Fallback policy enforced: no down-tier on holdouts; if primary fails, escalate

**Explicit exclusions:**
- No retrospective yet (M9)
- No advisor on QA or Review (rule 20)
- No batched parallel QA (sequential one-at-a-time)

**Dependencies:** M7

**Exit criteria:** a Dev-completed PR runs through QA (passes or fails appropriately), then Review (passes or fails appropriately), with neither agent able to access the Developer's reasoning. Holdout enforcement test: explicit attempt to inject Dev decision-summaries into QA/Reviewer fails at the runtime layer with `tool.violation` event. Retry-then-escalate path tested: a deliberately-broken implementation cycles `needs-fix` twice then ends in `factory:needs-human`.

**Why vertically useful:** trust capability. Once M8 ships, Goose Hub can ship code with confidence. Independent validation by holdout agents is the difference between "AI wrote some code" and "AI shipped a tested, reviewed change."

**Rough GitHub issues:**
1. `skills/qa/` full implementation
2. `skills/review/` full implementation
3. Holdout enforcement at runtime layer
4. `run-qa` workflow
5. `run-review` workflow
6. Update `fix-issue` to transition through QA/Review states
7. QA tab UI
8. Review tab UI
9. Retry-and-escalate logic
10. Fallback policy enforcement (no down-tier on holdouts)
11. Holdout boundary test (deliberate context injection attempt)

**Defer list:**
- Retrospective → M9
- Advisor on QA/Review → forbidden, never
- Parallel QA across multiple PRs → M10/M11

---

### M9. Retrospective and Learning Loop

**Outcome:** every successful merge ends with a retrospective. Light retro by default; deep retro on triggers. Persona stats accumulate. Improvement candidates are recorded for human review.

**Included scope:**
- `skills/retrospective-light/` — thin 3-bullet summary, obvious improvement candidates only
- `skills/retrospective-deep/` — full schema with persona analysis
- Workflow: `retrospective.ts` — chooses light vs deep based on `retrospectivePolicy`
- Retrospective tab in task detail
- Persona stats accumulation: every agent run updates the persona's stats in DB
- Roster UI: per-role list of personas with metrics, drill-in to history
- `improvement_candidates` table: stores retro suggestions
- Approved improvement candidates surface as new Factory issues (manual approve through Roster UI for now)
- Real cost tracking: agent runs persist actual or estimated cost; cost dashboard shows per-stage breakdown
- Costs labelled "estimated" when from Claude CLI; "exact" when authoritative

**Explicit exclusions:**
- No automatic application of self-improvement suggestions (humans must approve)
- No persona auto-suggested model downgrades yet (recorded but not applied)
- No multi-project Roster yet (Roster is per-project for now)

**Dependencies:** M8

**Exit criteria:** completing a Goose Hub feature (file issue → triage → investigate or skip → dev → QA → review → merge) results in: retrospective auto-runs after merge, light or deep based on triggers, results visible in Retrospective tab, persona stats updated, improvement candidates appear in Roster. Cost dashboard shows real numbers.

**Why vertically useful:** the feedback loop. Every merge teaches the system. Without M9, every issue is independent; with M9, the system can actually improve over time (with human approval gates).

**Rough GitHub issues:**
1. `skills/retrospective-light/` and `skills/retrospective-deep/`
2. `retrospective` workflow with tier-selection logic
3. Retrospective tab UI
4. Persona stats schema and accumulation logic
5. Roster UI per role
6. Improvement candidates table and surfacing
7. Improvement-candidate-to-Factory-issue flow
8. Cost dashboard
9. Estimated vs exact cost labelling

**Defer list:**
- Auto-applied self-improvement → indefinitely (always human-gated)
- Cross-project Roster → M10
- Persona-driven model auto-routing → never auto; suggested only

---

### M10. Multi-project Orchestration

**Outcome:** Goose Hub can manage more than one target project. Project switcher works across multiple registered projects. All Projects view aggregates Kanban across them. Per-project ticks, budgets, and locks all work in parallel.

**Included scope:**
- Multiple projects registered via hand-edited `target-projects/<slug>/` directories (full bootstrap workflow comes in M12)
- Project switcher shows multiple projects with color stripes
- All Projects board: aggregated Kanban with cards from all projects, color-stripe per project
- Per-project orchestrator ticks (each project's tick is independent; one workflow per project lock)
- Per-project budgets and counters
- Per-project active milestone independence
- Cross-project Roster (filterable by project)
- Settings UI: per-project config viewing (read-only for now; editing is human-driven file edits)
- At least two projects registered: `goose-hub-self` and one other (suggest a small personal repo with one-or-two test issues)

**Explicit exclusions:**
- No dependency-aware scheduling yet (M11)
- No bootstrap workflow yet (M12 — projects are registered by hand for now)
- No Jira yet (M14)
- No autonomous mode yet (M16)

**Dependencies:** M9

**Exit criteria:** with `goose-hub-self` and a second small project both registered: file an issue in each, both go through their independent triage → ... → done lifecycles, All Projects view shows both, Roster shows personas from both, per-project budgets enforce independently.

**Why vertically useful:** the system is no longer a single-purpose tool for building itself. It can drive multiple projects. Big psychological and practical step toward "command centre."

**Rough GitHub issues:**
1. Project registration loader (read all `target-projects/*/project.config.ts`)
2. Project switcher with color stripes
3. All Projects aggregated board
4. Per-project tick scheduler
5. Per-project budget counters and locks
6. Per-project active milestone management
7. Cross-project Roster
8. Settings UI for project config viewing
9. End-to-end test: two projects, two issues, two independent lifecycles

**Defer list:**
- Dependency-aware scheduling → M11
- Project bootstrap workflow → M12

---

### M11. Dependency-aware Scheduling

**Outcome:** the scheduler respects `Depends on` and `Blocks` body-level dependencies, including cross-repo. Issues with unmet dependencies are blocked from dispatch. UI surfaces blocked status. Move-with-dependencies is implemented.

**Mid-milestone status (2026-05-06):** halfway through. M11.01 (dependency parser) shipped via PR #497. The parser lives at `core/state-source/dependency-parser.ts` (not `github-labels.ts` as originally planned), exports `parseDependencies()` returning typed `DependencyRef[]`, and is colon-tolerant for `Depends on`, `Depends-On`, `Blocks`, `Blocked by`. Items 2–10 below remain open.

**Included scope:**
- Dependency parser in `core/state-source/dependency-parser.ts`: handles `Depends on #N`, `Depends on owner/repo#N`, `Blocks #N`, plus tolerant variants — **shipped (M11.01)**
- Cross-repo dependency resolution: requires the dep repo to be a registered project — pending
- Scheduler enhancement: filter eligible items by dependency satisfaction — pending
- `factory:blocked-by-dependency` label (or just use `schedule:blocked-by` from existing labels) — pending
- UI: dependencies visible on issue detail (links to dep issues with current state); blocked status surfaced on card — pending
- `goose task move <ref> --to=current --with-dependencies` and `--ignore-dependencies` CLI flags — pending
- UI confirmation dialog when moving an issue with dependencies — pending
- Cross-repo dep where the dep repo is unregistered → escalates to `factory:needs-human` — pending
- Multi-issue parallel: relax the project-level lock to allow multiple workflows on different work items in parallel, up to `maxParallelAgents`. (This is the breaking change to FACTORY_RULES rule 14 noted in v2.1's adversarial review; ADR documents it.) — pending

**Explicit exclusions:**
- No graphical dependency tree visualisation
- No critical-path analysis
- No auto-creation of cross-project deps
- No auto-promotion of `schedule:next` items when current sprint completes (manual for now)

**Dependencies:** M10

**Exit criteria:** create issue A with `Depends on #B` referencing an open issue B. Scheduler refuses to dispatch A. Close B. Scheduler picks up A. Cross-repo case tested with a dep across `goose-hub-self` and the second project from M10. Move-with-deps tested. Multi-parallel tested with two non-conflicting issues.

**Why vertically useful:** dependencies are how real software work organises. Without this, sprints are unrealistic — every multi-step feature has implicit ordering that the system can't enforce.

**Rough GitHub issues:**
1. Dependency parser with tolerant variants
2. Cross-repo dependency resolver
3. Scheduler dependency-satisfaction filter
4. UI: dependency visibility on issue detail
5. UI: blocked status on card
6. Move-with-dependencies CLI and UI
7. Unregistered cross-repo dep → escalate to needs-human
8. Multi-parallel relaxation of project lock
9. ADR documenting the rule-4 modification
10. Tests: same-repo dep, cross-repo dep, unregistered dep, move-with-deps, parallel non-conflicting

**Defer list:**
- Graphical dep tree → never (over-engineered)
- Auto-promotion of next sprint → much later

---

### M12. Project Bootstrap Workflow

**Outcome:** running `goose project bootstrap <repo-ref>` onboards a new target project end-to-end: stack detected, CLAUDE.md proposed, labels installed, project config scaffolded, registration PR opened with `factory:bootstrap-pr` label. Webhook setup is documented but manual.

**Included scope:**
- `core/bootstrap/stack-detector.ts` — detects runtime, package manager, build/test/lint/typecheck/e2e commands from common files (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Gemfile`, etc.)
- `core/bootstrap/claude-md-auditor.ts` — creates `CLAUDE.md` if missing; if present, propose updates as a human-reviewable diff
- `core/bootstrap/label-installer.ts` — idempotent installation of `factory:*` label set
- Workflow: `bootstrap-project.ts` — orchestrates the steps, opens PR with `factory:bootstrap-pr` label
- Governance PR check: allows `added` (creation) of governance paths in PRs labelled `factory:bootstrap-pr`
- CLI: `goose project bootstrap <repo-ref>`
- UI: bootstrap wizard surfacing detected stack, CLAUDE.md preview/diff, labels-to-install confirmation, webhook setup instructions
- Webhook installation deferred — bootstrap outputs runbook instructions for the user to set up manually

**Explicit exclusions:**
- No automatic webhook installation
- No fully automatic CLAUDE.md merge (always human-reviewed PR)
- No multi-repo bootstrap (one repo per project for now)
- No clever stack inference beyond what's obvious from common files
- No bootstrap of `goose-hub-self` (it was hand-bootstrapped in M0/M1)

**Dependencies:** M11

**Exit criteria:** running `goose project bootstrap shaunnez/some-existing-repo` succeeds: detected stack visible, CLAUDE.md proposed (or update diff shown), labels installed, registration PR opens in `goose-hub` repo with `factory:bootstrap-pr`, governance check passes (allowing creation of new `target-projects/<slug>/`), human merges, project is registered. Test on a real personal repo of your choice (e.g. Phaser game).

**Why vertically useful:** the system can absorb new projects without hand-editing files. Big step toward general usefulness.

**Rough GitHub issues:**
1. Stack detector for Node, Python, Go, Rust, Ruby
2. CLAUDE.md auditor (create + diff)
3. Label installer (idempotent)
4. `bootstrap-project` workflow
5. Governance PR check bootstrap exception
6. `goose project bootstrap` CLI
7. Bootstrap wizard UI
8. Webhook setup runbook documentation
9. End-to-end bootstrap test on a real repo

**Defer list:**
- Auto-webhook → later
- Multi-repo bootstrap → never (one repo, one project; multi-repo projects are M14's Jira-style abstraction)
- Auto-merge of bootstrap PR → never (always human)

---

### M13. Discover Lane

**Outcome:** for `type:feature` issues, the system can take a vague idea and turn it into vertical slice issues automatically. Grill-me runs as a chat session with the user. Write-PRD produces a structured PRD. Decompose-to-issues breaks the PRD into shippable child slices.

**Included scope:**
- `skills/grill-me/` — Mat Pocock pattern, structured interrogation, human-in-loop
- `skills/write-prd/` — fresh-context PRD writer
- `skills/advise-on-prd/` — advisor for PRD draft (optional, triggered by priority)
- `skills/decompose-issues/` — outputs vertical slices as GitHub issues with parent reference
- Workflow: `grill-and-prd.ts`
- Workflow: `decompose-prd.ts`
- UI: grill-me chat panel inside task detail
- UI: PRD tab with structured rendering and approval gate
- PRD review gate (human approves)
- Decompose populates child issues with milestone, schedule, exec, dependencies
- Sprint review skill (auto-creates milestone-end review issue)

**Explicit exclusions:**
- No grill-me in Slack (M15)
- No automatic PRD merging (always human-approved)
- No multi-PRD batching
- No PRD versioning beyond plain comment edits

**Dependencies:** M9 (retrospective infrastructure required), M11 (dependency-aware scheduling required for decompose to set deps correctly)

**Exit criteria:** file a `type:feature` issue with a vague title. Grill-me chat runs in UI; user converges. Write-PRD produces structured PRD. Human approves. Decompose creates child issues with proper labels and dependencies. Each child runs through the normal lifecycle (M5–M9). Test by shipping one feature this way.

**Why vertically useful:** the system can now handle features end-to-end, not just bugs and chores. This is when "I have an idea" becomes "I have shipped slices" with minimal manual decomposition.

**Rough GitHub issues:**
1. `skills/grill-me/` full implementation
2. `skills/write-prd/` full implementation
3. `skills/advise-on-prd/` advisor variant
4. `skills/decompose-issues/` full implementation
5. `grill-and-prd` workflow
6. `decompose-prd` workflow
7. Grill chat UI
8. PRD tab UI with approval gate
9. Sprint review auto-issue creation
10. End-to-end feature shipping test

**Defer list:**
- Slack grill-me → M15
- Multi-PRD batching → never
- PRD versioning → much later

---

### M14. Work Mode Foundation

**Outcome:** Goose Hub can drive a Jira-backed project. Jira tickets in, Bitbucket repo context found via repo matching, investigation possible. The first time Goose Hub touches Work, it does it through a real abstraction — not a special case.

**Included scope:**
- `core/state-source/jira.ts` — Jira state source adapter (read tickets, comment, transition status)
- Jira state mapping: Jira statuses ↔ `factory:*` states
- `core/connectors/bitbucket.ts` — Bitbucket repo read/search adapter, ported with concepts from reference audit
- Bitbucket repo matching using ported concepts
- Confluence URL support: simple link rendering only (no ingestion)
- `target-projects/work-shift4/project.config.ts` — sample Work project config
- Machine-scoping enforced: project hidden when `WORK_MACHINE` env var not present
- `apps/cli` `goose work` namespace for Work-specific testing
- Investigation runs against Bitbucket repos (worktree creation supports Bitbucket clone URLs)

**Explicit exclusions:**
- No full Bitbucket PR lifecycle (open PRs to Bitbucket — read-only for v0)
- No full Confluence ingestion
- No Slack work approvals
- No autonomous Work mode (autonomous always opt-in per project)
- No Work-specific budget defaults (use whatever the user configures)

**Dependencies:** M13 (full skill chain operational)

**Exit criteria:** with `WORK_MACHINE=true` set, register a Work project. File a Jira ticket. Goose Hub triages it (ported triage skill works against Jira), suggests a Bitbucket repo, runs investigation in a Bitbucket worktree, produces findings. Without `WORK_MACHINE`, the project is hidden from the UI and the orchestrator refuses to tick.

**Why vertically useful:** Goose Hub becomes useful for the day job. Even without write/PR support, investigation alone is a real time-saver. Architecturally, this milestone is the proof that the abstractions hold up beyond GitHub.

**Rough GitHub issues:**
1. `core/state-source/jira.ts` Jira adapter
2. Jira status ↔ `factory:*` mapping
3. Bitbucket connector (read/search)
4. Bitbucket repo matching adapter
5. Confluence URL support
6. Machine-scoping enforcement
7. Bitbucket worktree handling
8. `goose work` CLI namespace
9. End-to-end Work investigation test

**Defer list:**
- Bitbucket PR opening → much later
- Full Confluence ingestion → much later
- Autonomous Work mode → never auto; always opt-in
- Slack work approvals → M15

---

### M15. Slack Capture and Gate Notifications

**Outcome:** Slack `/capture` command creates Inbox notes from anywhere. Gate-pending events notify in Slack with a link back to Goose Hub.

**Included scope:**
- Slack bot registration (one-time setup)
- `/capture` slash command: posts text to Slack, returns confirmation, creates Inbox note in Goose Hub
- `/capture-bug`, `/capture-feature` variants that create candidate issues directly with appropriate type labels
- Webhook from Slack to `apps/server`
- Notification on gate-pending events: DM with issue title, link to Goose Hub, brief context
- Notification on `factory:needs-human` escalations
- Slack settings UI in Goose Hub (per-project)
- Status command: `/goose status <project>` summarises active milestone, in-progress, blocked

**Explicit exclusions:**
- No grill-me in Slack
- No streaming agent activity into Slack
- No bot conversational interface
- No Slack-as-source-of-truth for any project
- No Slack-based PR review gates (still UI-based)

**Dependencies:** M14

**Exit criteria:** install Slack bot in user's workspace. Run `/capture quick idea about something` from any channel. Inbox note appears in Goose Hub within 5 seconds. File an issue that hits `factory:prd-review` or `factory:approved`. Slack DM arrives with link. Click link, approve in UI.

**Why vertically useful:** lowers capture friction dramatically. Most idea-loss happens because capture isn't fast enough; Slack `/capture` is the lowest-friction surface available. Notifications close the loop on gates without forcing UI-watching.

**Rough GitHub issues:**
1. Slack bot registration runbook
2. `/capture` slash command + Inbox-note creation
3. `/capture-bug` and `/capture-feature` variants
4. Slack webhook receiver
5. Gate-pending notifications
6. `factory:needs-human` notifications
7. Slack settings UI
8. `/goose status` summary command
9. End-to-end capture-to-promote test

**Defer list:**
- Grill-me in Slack → never (UI is better for chat)
- Streaming activity → never (timeline is the place)
- Slack as source of truth → out of scope

---

### M16. Autonomous Mode and Docker Isolation

**Outcome:** projects can be flagged `mode: autonomous` with `isolation.mode: 'docker'`. Cron-driven ticks run unsupervised. Docker isolation boundary is real, not aspirational. First low-stakes project (likely the Phaser game or similar) is moved to autonomous mode with strict budget caps and 4-hour cadence.

**Included scope:**
- Docker base image: alpine + node + git + claude-cli, minimal surface
- `core/tool-layer/sandbox.ts` Docker mode: every agent run runs `docker run` with workspace bind-mount, network allowlist, CPU/memory caps
- Network allowlist: Anthropic API, GitHub API, npm registry (configurable per project)
- Cron scheduler: per-autonomous-project, configurable cadence (default 4h)
- Autonomous mode skips human gates between QA and merge (auto-merge if both pass)
- Advisor disabled by default in autonomous mode (cost-spiral guard)
- Strict budget caps: lower defaults than supervised mode
- Manual escape hatch: `goose autonomous pause <project>` halts the cron immediately
- Observability: every autonomous run still emits the full event stream; user can review activity in the morning

**Explicit exclusions:**
- No autonomous mode for `goose-hub-self` (always supervised; building yourself with no human gate is too risky)
- No autonomous Work projects (rule)
- No multi-machine cron (single-machine for v0)
- No fancy resource scheduling beyond simple parallel caps
- No webhook-driven autonomous (cron only, for predictability)

**Dependencies:** M15 (notifications needed for needs-human escalations from autonomous runs)

**Exit criteria:** flag the Phaser game (or similar low-stakes project) as autonomous. File a `type:bug` issue. Wait 4 hours. Confirm: triage, investigation, dev, QA, review, merge, retrospective all run unsupervised inside Docker containers. Notification arrives if anything escalates to `factory:needs-human`. Run for 2 weeks and review.

**Why vertically useful:** the actual "factory" that ships software while you sleep. Up to here, Goose Hub is supervision-amplification. From here, it's productive without supervision (within strict bounds).

**Rough GitHub issues:**
1. Docker base image and build
2. Docker sandbox mode in tool layer
3. Network allowlist enforcement
4. Cron scheduler per autonomous project
5. Auto-merge in autonomous mode
6. Autonomous-specific budget defaults
7. `goose autonomous pause` escape hatch
8. Per-project escape-hatch UI button
9. End-to-end autonomous test on Phaser project

**Defer list:**
- Multi-machine cron → much later
- Resource scheduling → much later
- Autonomous Goose Hub-self → never

---

### M17. Goose Mode Skin (optional)

**Outcome:** spatial UI skin that visualises agent activity as an office metaphor. Glanceable view of 30+ agents at once. Pure UI, no behaviour change.

**Included scope:**
- New "Office" tab alongside Kanban
- Pixel-art top-down office layout (one floor per project)
- Agent state indicators above desks: speech bubble, question mark, thought bubble, coffee cup, exclamation, check
- Movement: agents walk between rooms when state changes
- Click desk → existing task detail panel
- Phaser.js canvas for the office, embedded in React tab
- Same SSE event stream drives Office and Kanban

**Explicit exclusions:**
- No new orchestration behaviour
- No mobile Office view
- Optional milestone — drop entirely if not desired

**Dependencies:** M16 (parallel-agent UX is most useful when there's actually parallel autonomous activity)

**Exit criteria:** Office tab works alongside Kanban for at least 3 active projects. Watching agents work feels glanceable.

**Why vertically useful:** purely a delight feature. No correctness gain. Listed because it's been a recurring theme; treat as optional.

**Rough GitHub issues:**
1. Phaser.js canvas embedded in React tab
2. Office layout (pixel-art tilesets)
3. Agent sprite + state indicators
4. Movement engine (state-change → walk-between-rooms)
5. Click-through to task detail
6. Multi-floor (per-project) navigation

**Defer list:**
- Mobile Office → never
- Voice or sound effects → never

---

### M18. Portfolio Polish (optional)

**Outcome:** Goose Hub is presentable as a portfolio piece. Demo data, public-safe demo mode, walkthrough docs, screenshots, video script, positioning copy.

**Included scope:**
- Demo data generator: synthetic project with synthetic issues that demonstrate the lifecycle without real credentials
- Demo mode flag: hides real projects, shows demo project, blocks any external API calls
- Walkthrough documentation: blog-style articles explaining how Goose Hub works
- Screenshots and short Loom-style video script
- Positioning copy: "what is this", "who is it for", "why I built it" for portfolio + LinkedIn
- Public-facing landing page (separate from app, hosted on Vercel or similar)

**Explicit exclusions:**
- No public hosting of the app itself (still local-only)
- No multi-user features
- No "try Goose Hub" hosted demo
- Optional milestone — drop if not pursued

**Dependencies:** M16 (need autonomous to demo "ships while you sleep")

**Exit criteria:** anyone landing on the portfolio site understands what Goose Hub is in under 60 seconds, sees concrete evidence (screenshots, video, blog post), and can decide whether to engage further.

**Why vertically useful:** Goose Hub as portfolio asset for the services business. Optional because the building exercise itself was the primary goal; portfolio framing is bonus value.

**Rough GitHub issues:**
1. Demo data generator
2. Demo mode flag
3. Walkthrough article 1: architecture
4. Walkthrough article 2: a feature shipped autonomously
5. Walkthrough article 3: lessons learned
6. Screenshots and Loom video script
7. Positioning copy
8. Landing page

**Defer list:**
- Hosted demo → never
- Multi-user → never

---

## 29. Decisions left for later

These do not block M0:

- UI component library specifics (shadcn/ui default, Radix primitives if more control needed)
- Hosting for orchestrator: local-only at first, small VPS for cron later
- Webhook surface during dev: ngrok
- Default model provider: Anthropic direct in v0, OpenRouter as swappable `ModelProvider` later
- M17 / M18 inclusion: revisit after M16

---

## 30. Open questions to resolve at M0

1. Repo name confirmed: `goose-hub`. Engine references stay as "Factory" in code and docs. ✓
2. Stack confirmed: Node + pnpm + TypeScript + Drizzle + SQLite + React + Vite + shadcn/ui + Biome + Vitest + Playwright + Zod. ✓
3. Database: SQLite via Drizzle. ✓
4. Persona pool seed: 3 per role per project on creation. TS files in `target-projects/<slug>/personas/`.
5. Grill-me UI: synchronous chat in app for v0.
6. Budgets for `goose-hub-self`: same per-project budgets, treat like any other project.
7. GitHub Projects (the GH product): skipped for v0. ADR recorded.
8. Sequential QA → Review confirmed. ✓
9. Lane names confirmed: Triage, Discover, Research, Investigation, Dev, QA, Review, Retrospective, Blocked, Done, Archive (+ Rejected hidden). ✓
10. Source-of-truth lives at the project level (per repo for GitHub; per workspace for Jira). ✓
11. Advisor mode: PRD-writer (M13) and Developer (M7) only in v0; never on holdouts. ✓
12. Issue is the work item; PR is an artefact. ✓
13. Bootstrap creates governance files via `factory:bootstrap-pr` label exception. ✓
14. State machine enforcement lands in M1, used by UI from M2. ✓

---

## 31. Design brief (for Claude design, separate session)

Surfaces in priority order:

1. Global chrome (sidebar with project switcher and milestone indicator, top bar with capture/search/command palette/profile)
2. Kanban (per-project + All Projects, dense, project color stripe, personas, confidence tag, live activity ticker, cost so far, blocking state, milestone tag)
3. Task detail (slide-in tabs from section 21, gates prominent, retrospective tabbed)
4. Inbox (looser than Kanban, target-repo picker on promote)
5. Roster (persona leaderboard per role, drill-in, self-improvement suggestions, cross-project filterable from M10)
6. Milestones (set-active button, sprint review summary cards)
7. Settings (per-project config, skills, models, hooks, budgets, governance, lane overrides)
8. Project bootstrap wizard (M12)

Visual direction: dark mode native, sharp sans-serif (Inter/Söhne) + monospace (JetBrains Mono), low-saturation palette except state indicators. Dense, keyboard-first, senior-engineer aesthetic. References: Linear, Vercel dashboard, Raycast, Anthropic Console. Avoid: Notion soft, Jira bureaucratic, AI-assistant cute.

Ship surface-by-surface: chrome → Kanban → task detail. Pause for feedback.

---

## 32. How to use this document

For humans:

1. Read end-to-end before editing.
2. If something is wrong or missing, file an issue tagged `factory:docs` in `shaunnez/goose-hub`.
3. Resolve open questions (section 30) at M0. Record decisions as ADRs.
4. Start M0 only after seed files (`MISSION.md`, `FACTORY_RULES.md`, `CLAUDE.md`, root project config) are written.

For agents:

1. This is `docs/PLAN.md`. **It is the constitution, not a build spec.** Read it for context. Build from individual GitHub issues with concrete acceptance criteria.
2. If a task contradicts a principle (section 3) or rule (section 27), reject the task with a comment citing the violation.
3. If a task is ambiguous, look here first. Domain model (section 4) and interfaces (section 7) usually resolve it.
4. If still unsure, label `factory:gate-pending` and request human input. Do not guess on architectural decisions.
5. Every PR modifying code under `core/` requires an ADR in `docs/adr/`.
6. Every new slice must include `slice.test.ts` and `README.md`. Other files (data.ts, api.ts, ui.tsx) only when there's real content.
7. Every new prompt must be markdown under `skills/<name>/`. Inline prompts in code fail review.
8. Every agent run must produce JSON conforming to its skill schema. Free-text-only outputs fail.
9. Emit `agent.decision-summary` events at decision points. Single sentence. No chain-of-thought. No secrets. No PII.
10. Bootstrap is required before any other workflow runs against a target project. Do not skip it.

---

## 33. The single sentence

**Goose Hub is a local-first command centre powered by Factory: a stateless orchestrator over per-project sources of truth, running role-scoped agents (with optional fallbacks and advisors, but never on holdouts) through versioned skill chains in workspaces (sandboxed, not isolated) under per-project budgets, supervised at gates the project chooses, building software in vertical slices that each project's own issue tracker drives — with every run reflected back as a tiered retrospective that improves the next one.**

---

## 34. The 18-milestone overview at a glance

| # | Milestone | Outcome (1 line) | Optional? |
|---|---|---|---|
| M0 | Preamble | Repo + immutable docs + decisions made | No |
| M1 | Bootstrap Source of Truth | `goose status` reads real GitHub issues | No |
| M2 | First Operable UI | Read GitHub + one manual write | No |
| M3 | Manual Workflow Cockpit | Full manual lifecycle with fakes | No |
| M4 | Controlled Claude CLI Spike | Real runtime, contained skill | No |
| M5 | Real Triage and Repo Matching | First real agent value | No |
| M6 | Investigation Workflow | Bugs become actionable artefacts | No |
| M7 | Supervised Dev Workflow | Goose Hub ships its own code | No |
| M8 | QA and Review Holdouts | Trust capability | No |
| M9 | Retrospective and Learning Loop | Feedback loop | No |
| M10 | Multi-project Orchestration | Beyond goose-hub-self | No |
| M11 | Dependency-aware Scheduling | Realistic sprint scheduling | No |
| M12 | Project Bootstrap Workflow | Onboard new projects | No |
| M13 | Discover Lane | Features end-to-end | No |
| M14 | Work Mode Foundation | Jira + Bitbucket investigation | No |
| M15 | Slack Capture and Gate Notifications | Lower capture friction | No |
| M16 | Autonomous Mode and Docker | Ships while you sleep | No |
| M17 | Goose Mode Skin | Pixel-art office | Optional |
| M18 | Portfolio Polish | Public-facing presence | Optional |

---

## 35. Adversarial review summary

v2.1's adversarial review surfaced 21 fixes. v2.2 lands all of them. Key resolutions:

- **Governance bootstrap exception** (rule 3, section 26.5): governance files can be **created** in PRs tagged `factory:bootstrap-pr`; never modified.
- **Stage 1 agent contradiction**: resolved by milestone restructure. M1 has no agents; M4 introduces controlled runtime; M5 is first real agent.
- **Issue vs PR state**: explicit in section 5.4 and rule 26. State labels live on issues; PR labels are decorative.
- **Honest sandboxing**: principle 13 and section 18 acknowledge supervised mode is observational, not isolated.
- **Worktree language**: section 19.2 reframes worktrees as workflow boundaries, not isolation.
- **Stateless reframe**: principle 6 and section 5.5 distinguish work-item authority (external) from operational authority (local DB).
- **Decision summaries, not raw thoughts**: section 22 + secret redaction.
- **Machine-scoping is accident-prevention, not isolation**: section 18.3.
- **Label conflict resolution**: section 9.3 with rules and required tests.
- **Source-agnostic language**: domain model and section 5.3 talk about projects and sources, not GitHub-specific.
- **Soften "never split"**: section 7 acknowledges multiple authoritative artefacts (PR, ticket, doc, approval thread); one authoritative *lifecycle* state per work item.
- **Advisor budget skip**: visible in timeline, silent to workflow (section 16.3 #7).
- **Fallback never down-tiers on critical/high or holdouts**: rule 27, section 17.2.
- **Tiered retrospectives**: section 13.9, light by default, deep on triggers.
- **Slices include only relevant surfaces**: section 6.1, rule 11.
- **YAML scope**: principle 7, rule 28 — CI YAML allowed, product YAML forbidden.
- **Costs labelled estimated when inferred**: section 9 of M9 scope, UI rule.
- **Constitution vs build spec**: principle 17, rule for agents in section 32.

One open contradiction is intentional and documented:
- Rule 4 (one workflow per project) is relaxed in M11 to allow multi-issue parallel up to `maxParallelAgents`. This is a deliberate breaking change captured in M11's scope and an ADR; the rule will be amended at that point.

---

End of v2.2.
