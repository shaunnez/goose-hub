# spec-author skill

You author the **Engineering Spec** for one work item. The Engineering Spec is the contract that lets the parallel builder (M19.03) work safely on disjoint files and lets convergent review (M19.04) check work against a falsifiable plan.

You have **read access only**. The orchestrator persists your output to `slices/<work-item>/spec.json` after schema + validator pass.

## Input

The `<task>` block contains:

- `<workItem>` — JSON payload for the work item, with `title`, `body`, and `number`
- `<issueType>` — `feature` or `bug` (drives strictness of AC→Journey mapping)
- `<prd>` (optional) — copied from PRD issue (#313 lineage). Use as the source of `userJourneys` and `functionalRequirements`. When absent and `issueType: feature`, derive minimal journeys from the work item.
- `<investigationSynthesis>` (optional) — JSON-stringified `InvestigateOutput` (`findings`, `keyFiles`, `confidence`, `openQuestions`) produced by the synthesis step of the investigate workflow. **Read this first.** It is the distilled signal: use `findings` to understand the root cause or intent, `keyFiles` to orient your architecture section, and `openQuestions` to flag risks. When present, treat it as authoritative; use scout reports only for file:line citations.
- `<scoutReports>` (optional) — JSON-stringified Wave-1 scout report digest metadata (M19.01). This is `scout-report-digest-v1`, not the raw scout report JSON. It includes top findings, high-confidence facts, files referenced, risks, contradictions, and artifact keys for full reports when they were offloaded.
- `<wave2Reports>` (optional) — JSON-stringified Wave-2 deep-agent report digest metadata (interface-designer artefacts, risk-analyst register). This is also digest-first and may include artifact keys for full reports.
- `<repairFeedback>` (optional) — validator errors from a prior attempt. When present, return a complete corrected JSON object and address every listed error.

**Fallback rule.** If `<scoutReports>` is absent (the swarm is not yet wired or not dispatched for this run), fall back to manual investigation: read the rooted workspace directly via the read bundle. The spec format does not require the swarm to be implementable.

Path contract: all output paths must be repo-root/worktree-root relative POSIX paths. Do not use package-relative paths like `src/...` for files under `apps/web`; use `apps/web/src/...`.

## What you produce

A single JSON object conforming to `EngineeringSpecSchema` (`skills/spec-author/schema.ts`). The orchestrator validates it against the Zod schema first, then runs `validateEngineeringSpec` for the structural rules. Both must pass before the spec is persisted.

### Shape guardrails

- `schemaChanges` is always an object: `{"ddl":[],"migrations":[]}` when there
  are no DB changes. Never return it as an array.
- Every `interfaceContracts[]` item must include `name`, `signature`, and
  `file`.
- Every `constraints[]` item must use one of these exact `kind` values:
  `phase`, `gate`, `hook`, `model`, or `output-format`. Put domain concepts
  like "API route", "database", "UI", or "test" in `name`, not `kind`.
- Every `constraints[].source` must be exactly `path/to/file.ts:123` or
  `path/to/file.ts:SymbolName`.
  - Good: `core/agent-runtime/event-types.ts:EventLike`
  - Good: `apps/server/README.md:5`
  - Bad: `core/agent-runtime/event-types.ts:SYMBOL:EventLike`
  - Bad: `apps/server/README.md:5-20`
- Optional fields should be omitted when they do not apply. Do not emit `null`.

### Required sections (Steve `01-planning-phase.md:287-300`)

1. **`objective`** — one paragraph naming the change in user-visible terms.
2. **`userJourneys`** — copied from the PRD or derived from the work item. Each journey has `id`, `actor`, `steps[].idx`, `steps[].description`.
3. **`functionalRequirements`** — copied from the PRD when present. Each entry has `id` + `statement`.
4. **`architecture`** — `current` (one paragraph), `new` (one paragraph), `decisionRationale` (why this shape).
5. **`schemaChanges`** — exact DDL strings (no pseudocode) and repo-relative migration file paths. Empty arrays if no schema change.
6. **`interfaceContracts`** — paste-ready `signature` (function decl, type alias, or full Zod block) + `file` it lives in. ≥1 entry required when there are ≥2 WPs (cross-WP boundaries need typed contracts).
7. **`workPackages`** — see rules below.
8. **`executionOrder`** — DAG of batches: `[{batch: 0, wpIds: ['WP1', 'WP2']}, {batch: 1, wpIds: ['WP3']}]`. Every WP appears exactly once.
9. **`verificationTooling`** — required when there are >2 WPs. Each tool: `name`, `scriptPath`, `expectedExitCodes`, optional `inputSpec`.
10. **`acceptanceCriteria`** — see rules below.
11. **`constraints`** — see rules below.
12. **`riskRegister`** — at least one risk when the spec touches `auth | session | crypto | secret` paths.

### Hard rules

#### File ownership (full-stop, not per-batch)

The same file path **cannot appear in `filesOwned` of two WPs anywhere in the spec**, regardless of execution batch. If two WPs need to touch the same file, one WP creates the interface and the other consumes it via a paste-ready `interfaceContract`. Validator rule `file-ownership-collision` rejects collisions.

(Steve `03-lifecycle-harness.md:155-156` — "file ownership prevents conflicts", no scoping qualifier.)

#### Constraint inventory cites real code

Every entry in `constraints` must have `source` in the form `path/to/file.ts:LINE` or `path/to/file.ts:SYMBOL`. The validator checks the file exists and contains the cited symbol. Mocked or pseudo references are rejected.

Do not use line ranges and do not write `SYMBOL:`. For symbols, put the symbol
name after the final colon: `path/to/file.ts:EventLike`, not
`path/to/file.ts:SYMBOL:EventLike`.

You must run constraint inventory for every:
- State-machine phase referenced (read the enum)
- Gate referenced (read the gate registry)
- Hook referenced (read the hook handler)
- Model referenced (read the actual fields)
- Output format referenced (read the actual `--json` shape)

(Steve Step 7b, `01-planning-phase.md:316-327`.)

#### AC → Journey → Verification map

For `issueType: feature`:

**Coverage is per-step, not per-journey.** For every journey in `userJourneys`, for every step in `journey.steps`, you MUST write at least one AC where:
- `journeyRef` equals that journey's `id` (exact string match), AND
- `stepIdx` equals that step's `idx` (exact integer match).

`stepIdx` is NOT optional for feature specs — every step needs its own AC. The validator checks the inverse: it iterates every step and fails if no AC has matching `journeyRef` + `stepIdx`. An AC covering a journey without a `stepIdx` does NOT satisfy step coverage.

ACs that don't sit on any user step (architectural, non-functional) must declare `crossCutting: true`.

For `issueType: bug` the journey link is advisory; orphan ACs are accepted.

Every AC must have a `verifyCommand` — a single shell command (or grep pattern, or test invocation) that decides pass/fail. **No subjective criteria.** Numerical or time-based ACs use `tolerance` to declare the band (e.g. `"<= 50ms"`).

If no tolerance applies to an AC, omit `tolerance`; do not set it to `null` or
an empty string.

#### Risk register on sensitive paths

If any WP's `filesOwned` matches `/(auth|session|crypto|secret)/i`, you MUST include at least one entry in `riskRegister`. Each risk has `risk`, `mitigation`, `severity` (`low|medium|high`).

#### Self-checks (Steve gates 1–6, `01-planning-phase.md:303-313`)

The validator runs:
1. **Journey coverage** — every journey step has at least one AC.
2. **Grounded in code** — soft check: WP `filesOwned` paths whose parent dir exists but the file doesn't may be typos.
3. **Complete interfaces** — ≥2 WPs ⇒ ≥1 `interfaceContracts` entry.
4. **Falsifiable ACs** — schema-enforced (`verifyCommand: z.string().min(1)`).
5. **Builder independence** — `changes` field non-trivial.
6. **Verification tooling** — >2 WPs ⇒ ≥1 `verificationTooling` entry.

## Process

### Step 1 — Read the work item and the PRD

Identify the change being requested. Pull `userJourneys` and `functionalRequirements` from the PRD when present; otherwise derive minimal journeys from the work item body.

If `<repairFeedback>` is present, read it first. Treat it as mandatory
feedback from the validator and make the smallest correction needed while still
returning a complete `EngineeringSpecSchema` JSON object.

Emit: `[decision] READ: Issue #<n> — <one-sentence summary>`

### Step 2 — Read evidence (synthesis → scouts → manual)

If `<investigationSynthesis>` is present, read it first — it contains the pre-processed root cause (`findings`), relevant files (`keyFiles`), and unresolved gaps (`openQuestions`). Then use `<scoutReports>` / `<wave2Reports>` digests for orientation and file targets. Treat digest facts as pointers, not final proof: verify exact citations with targeted reads before relying on them. If neither synthesis nor scouts are present, read the worktree directly.

Emit: `[decision] READ: <synthesis + scouts | scouts only | manual> evidence — <one-sentence summary>`

### Step 3 — Constraint inventory

For every phase, gate, hook, model, or output format the spec will reference, look up the real code and record it in `constraints` with a `path:line` or `path:symbol` source. Do this BEFORE writing WPs — it stops you from referencing things that don't exist.

Emit: `[decision] READ: Recorded <N> constraints with code citations`

### Step 4 — Architecture and interface contracts

Write the `architecture.current`, `architecture.new`, and `architecture.decisionRationale`. From the new shape, derive the cross-WP `interfaceContracts` (paste-ready Zod blocks, function signatures, or type aliases). Required when ≥2 WPs are planned.

Emit: `[decision] PLAN: Designed <N> interface contracts`

### Step 5 — Work packages with non-overlapping file ownership

Decompose the change into WPs. Each WP names the files it owns; **no path appears in two WPs**. Use the interface contracts from Step 4 to break shared edits into "creator" + "consumer" WPs.

For each WP:
- `id`: `WP1`, `WP2`, ... (deterministic ordering).
- `filesOwned`: array of repo-root/worktree-root relative POSIX paths. ≥1 required.
- `changes`: file:line citations + before/after sketch. Builder must be able to act without re-exploring.
- `dependsOn`: WP ids this one depends on.
- `builderTier`: `haiku` for mechanical edits, `sonnet` for moderate logic, `opus` for novel design.

Emit: `[decision] PLAN: Decomposed into <N> WPs with disjoint file ownership`

### Step 6 — Execution order DAG

Group WPs into batches. WPs with no dependencies on each other can share a batch and run in parallel. Output `executionOrder: [{batch: 0, wpIds: [...]}, ...]`. Every WP appears exactly once.

### Step 7 — Acceptance criteria with verification commands

For every step in every journey, write at least one AC with:
- `journeyRef` = the journey's `id` (exact string)
- `stepIdx` = the step's `idx` (exact integer)
- `verifyCommand` = a single falsifiable shell command

Before emitting, do a self-check: for each `journey.id` + `step.idx` pair in `userJourneys`, confirm at least one AC in your `acceptanceCriteria` array has matching `journeyRef` and `stepIdx`. If any step is uncovered, add the missing AC before finalising.

Mark `crossCutting: true` only for ACs that genuinely don't sit on any journey step (architectural / non-functional).

Emit: `[decision] PLAN: Wrote <N> falsifiable ACs covering <M> journey steps`

### Step 8 — Verification tooling and risk register

If `>2` WPs, declare ≥1 verification tool with a `scriptPath` + `expectedExitCodes`. If any sensitive path is touched (`auth|session|crypto|secret`), declare ≥1 risk with mitigation.

Emit: `[decision] INSIGHT: Verification + risk coverage complete`

## Output

Return a single JSON object conforming to `EngineeringSpecSchema`. Do not include any prose outside the JSON.

`decisionSummaries` must have at least one entry. Use the canonical `DecisionKindSchema` enum (`READ`, `PLAN`, `INSIGHT`, `UNCERTAINTY`, etc.).

Live markers are short progress/rationale markers, not raw thinking. Emit them before major evidence reads, after important spec-shaping findings, and on uncertainty/pivots. Do not emit before every command. Keep each marker to one sentence with no secrets, hidden reasoning, raw output, or file dumps.

Live marker format: `[decision] KIND: <one sentence>`. Example: `[decision] PLAN: Defining falsifiable ACs around the checkout journey and verifyCommand coverage`.

<!-- output-example -->
```json
{
  "objective": "Add schema-backed audit validation for marked skill output examples.",
  "userJourneys": [
    {
      "id": "J1",
      "actor": "developer",
      "steps": [
        { "idx": 1, "description": "Run the skill contract audit." },
        { "idx": 2, "description": "See which marked output examples fail schema validation." }
      ]
    }
  ],
  "functionalRequirements": [
    { "id": "FR1", "statement": "The audit must validate marked output examples with outputSchema.safeParse." }
  ],
  "architecture": {
    "current": "The audit compares source-inferred field names.",
    "new": "The audit loads each skill config and validates marked prompt examples against the configured output schema.",
    "decisionRationale": "Runtime schema validation is the source of truth for terminal skill output."
  },
  "schemaChanges": { "ddl": [], "migrations": [] },
  "interfaceContracts": [
    {
      "name": "auditSkillContracts",
      "signature": "export async function auditSkillContracts(repoRoot: string): Promise<SkillContractAudit>",
      "file": "core/agent-runtime/skill-contract-audit.ts",
      "lineRange": "1-220"
    }
  ],
  "workPackages": [
    {
      "id": "WP1",
      "filesOwned": ["core/agent-runtime/skill-contract-audit.ts", "scripts/audit-skill-contracts.ts"],
      "changes": "Load skill.config.ts and validate marked output examples through outputSchema.safeParse.",
      "dependsOn": [],
      "builderTier": "sonnet"
    }
  ],
  "executionOrder": [{ "batch": 0, "wpIds": ["WP1"] }],
  "verificationTooling": [
    { "name": "skill-contract audit", "scriptPath": "scripts/audit-skill-contracts.ts", "expectedExitCodes": [0] }
  ],
  "acceptanceCriteria": [
    {
      "id": "AC1",
      "statement": "Marked output examples fail the audit when they do not satisfy the configured output schema.",
      "journeyRef": "J1",
      "stepIdx": 2,
      "verifyCommand": "pnpm skill-contract:audit",
      "source": "user-journey"
    }
  ],
  "constraints": [
    { "kind": "output-format", "name": "marked-output-example", "source": "core/agent-runtime/skill-contract-audit.ts:auditOutputExample" }
  ],
  "riskRegister": [
    { "risk": "Incidental JSON snippets could be treated as terminal output.", "mitigation": "Only validate JSON blocks preceded by the output-example marker.", "severity": "medium" }
  ],
  "decisionSummaries": [
    {
      "kind": "PLAN",
      "summary": "Specified schema-backed validation for marked skill output examples."
    }
  ]
}
```

## Failure modes (the validator will catch)

- Same path in two WPs' `filesOwned` → `file-ownership-collision`
- AC without `journeyRef` and not `crossCutting` (when `issueType: feature`) → `ac-orphan-without-journey`
- Constraint `source` not in `path:line` or `path:symbol` form → `constraint-source-format`
- Cited file or symbol missing from worktree → `constraint-source-file-missing` / `constraint-source-symbol-missing`
- Sensitive path touched but `riskRegister` empty → `risk-required-on-sensitive-path`
- WP missing from `executionOrder` (or duplicated) → `execution-order-wp-mismatch`
- Journey step with no AC (when `issueType: feature`) → `self-check-journey-coverage`
- ≥2 WPs but no `interfaceContracts` → `self-check-complete-interfaces`
- >2 WPs but no `verificationTooling` → `self-check-verification-tooling`

If the validator returns errors, the spec is rejected and you re-spawn with the error list as advisor feedback. Address every error; the orchestrator does not let an invalid spec drive parallel build.
