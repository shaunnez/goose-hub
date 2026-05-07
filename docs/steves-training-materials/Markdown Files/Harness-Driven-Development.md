<!-- Slide number: 1 -->

ENGINEERING FRAMEWORK
Harness-Driven Development
Programmatic Quality Gates for
Enterprise Codebases
How autonomous agents ship production features on codebases
with technical debt -- without shortcuts, without hallucinations.

Shift4 Intelligence Platform
Confidential

### Notes:

<!-- Slide number: 2 -->

THE PROBLEM
AI Agents Fail on Real Codebases

Self-Certification Bias
WITHOUT HARNESSES
Agents declare "done" without objective verification. They optimize for completing the task, not for correctness.
~40%
of agent-generated changes introduce regressions on complex codebases

Technical Debt Amplification
On codebases with existing debt, agents compound shortcuts. Dict[str, Any] cascades into unvalidated data flows.

AGENT SELF-ASSESSMENT
95%

Hallucinated Completeness
agents report "success" -- but only 60% pass objective programmatic verification
Agents report passing tests they never ran, reference files that don't exist, and skip edge cases entirely.
The gap between agent confidence and actual quality is where production incidents live.
Shift4 Intelligence Platform | Harness-Driven Development

### Notes:

<!-- Slide number: 3 -->

THE SOLUTION
Programmatic Toll Gates

Core Principle
The agent cannot self-certify. Machines verify. Every phase transition requires objective, programmatic proof -- not the agent's word.

1

2

3

4

State Machines
Layered Checks
Exit Codes
Audit Trail
Pydantic-enforced phase transitions. Invalid states are impossible. Hooks block edits outside permitted phases.
6-16 independent verification layers. Each layer tests one concern. Failures are specific, not subjective.
0 = pass, 1 = fail, 2 = infra. No ambiguity. The state machine reads exit codes, not prose.
Every gate, decision, and finding persisted to JSON. Full traceability from plan to ship.
Shift4 Intelligence Platform | Harness-Driven Development

### Notes:

<!-- Slide number: 4 -->

LIFECYCLE HARNESS
Autonomous Development State Machine

HUMAN GATE
HUMAN GATE
PHASE 1
PHASE 3
PHASE 4
PHASE 5
PLAN REVIEW
SHIP REVIEW
→
→
→
→
→
PLANNING
BUILDING
VERIFYING
TRIAGING
6 parallel agents
WP dispatch
Codex + UAT
P0-P3 classify
User approves
User approves

← Autonomous loop: up to 3 iterations (TRIAGING → BUILDING) →

Investigation Swarm
Builder Dispatch
Codex Adversarial Review
Atomic State
Wave 1: 6 Sonnet agents (schema scout, code path tracer, pattern matcher, test inventory, dependency mapper, external schema). Cross-validated before Wave 2.
Work packages assigned with file ownership. Opus for complex multi-file, Sonnet for focused. Each WP gets one commit. Builders never touch git.
Plan, work, and ship reviewed by Codex agents. Session reuse: same reviewer context from plan through ship. Catches unseen gaps.
1,393-line Pydantic state machine. JSON persistence with atomic writes. Every gate, decision, regression tracked. Full audit trail at ship.
Shift4 Intelligence Platform | Harness-Driven Development

### Notes:

<!-- Slide number: 5 -->

TOLL GATES
Objective Verification at Every Phase

PLANNING
codex_plan_review -- Adversarial review of spec: file paths exist, sigs verified, ACs falsifiable
AUTOMATED

PLAN REVIEW
user_plan_approval -- Human approves engineering spec, Codex findings, verification strategy
HUMAN

INTEGRATING
static_validation -- Python/TS compilation, import resolution, AST parse -- zero tolerance
AUTOMATED

TRIAGING
finding_classification -- P0-P3 severity, loop vs ship decision, regression tracking
AUTOMATED

SHIP REVIEW
user_ship_approval -- Human approves audit trail, QA results, known issues
HUMAN

SHIPPING
UAT harness exit 0 -- Full 6-layer verification must pass. No exit 0 = no ship.
PROGRAMMATIC

"Known issue" is NOT an escape hatch.
Every finding must be FIXED or presented to the human gate with evidence of WHY it cannot be fixed. The agent cannot wave away problems.
Shift4 Intelligence Platform | Harness-Driven Development

### Notes:

<!-- Slide number: 6 -->

CASE STUDIES
Features Shipped via Lifecycle Harness

PLATFORM COMPILER PHASE B
REDIS SESSION REGISTRY
SALES AGENT (MULTI-PHASE)
Manifest-Driven Agent Platform
Horizontal Scaling + Cross-Pod Reconnect
Full LangGraph Agent + Jira Integration
Rewired ws_chat_v2.py to be fully manifest-driven. Removed all legacy if/elif agent routing. PlannerReactStrategy: 1,207 lines.
Redis registry for horizontal scaling. Main chat migrated. Cross-pod reconnect. 5-layer verification harness built as WP6.
DB migration, schemas, frontend hooks, JiraService, LangGraph agent, chat UI, admin lead API, portfolio intents, verification suite.

ITERATIONS
CODEX PASSES
CHECKS

2
40/40
WPs
FILES
STATUS

6
6
12+
SHIPPED
WPs
TESTS
E2E
10
23
PASS
Commit: 5429725 | Branch: fix/foundry-merchant-lookup
Commits: ad9878c, cd28c08 | Per-WP commits
WP0-WP9 | Unit + API verifier + Playwright E2E
Shift4 Intelligence Platform | Harness-Driven Development

### Notes:

<!-- Slide number: 7 -->

MODULAR HARNESS #1
UAT Harness: 6-Layer Programmatic Verification

1

Authentication

Playwright login, cookie verification, storageState
Why This Keeps the Agent Objective
Zero LLM tokens for verification. The harness is pure Playwright + httpx. The agent cannot influence the outcome. Exit code 0 means pass. Exit code 1 means fail. No interpretation, no rationalization.

2

Navigation & Load
Visit routes, check no 500/blank, expected selectors

3

Console Error Audit

Collect errors, filter 30 SAFE_CONSOLE_PATTERNS
$ python3 scripts/qa_uat_harness.py --full
Layer 1: AUTH ............ PASS

Layer 2: NAVIGATION ...... PASS
4

API Contract Check
Layer 3: CONSOLE ......... PASS
httpx checks against endpoint registry (status + JSON)
Layer 4: API ............. PASS
Layer 5: AGENT ........... WARN
Layer 6: UX .............. PASS

5

Agent Smoke Test
Exit code: 0 (87.3s)
WebSocket client sends prompts, verifies done events
Target: <90 seconds for layers 1-5. Two modes: CLI (zero tokens) + LLM-guided directive JSON.

6

UX Interaction Test
Mechanical UX scenarios: click, fill, wait, assert
Shift4 Intelligence Platform | Harness-Driven Development

### Notes:

<!-- Slide number: 8 -->

MODULAR HARNESS #2
Agent Hardening: Self-Improving Loop

PHASE 1
PHASE 2
PHASE 3
PHASE 4
PHASE 5
PHASE 6
INITIALIZING
TESTING
TRIAGING
FIXING
VERIFYING
REPORTING
Docker + API + DB health
3 personas, real prompts
BUG / DATA / FEATURE
Opus builders dispatch
Re-run failing + regression
Summary + loop back

Finding Categories
Status Lifecycle
Objectivity Mechanisms
BUG -- Code defectREGRESSION -- Previously workingDATA_ACCURACY -- Wrong numbersMEMORY_ISSUE -- Context lostPREFERENCE_VIOLATION -- FormatFEATURE_GAP_SMALL -- Quick fixFEATURE_GAP_LARGE -- Backlog
Finding discovered:
SHA-256 finding fingerprints prevent duplicates. Atomic JSON persistence with fcntl locks. Re-runs exact failing questions (not paraphrased). Regression checks 5 previously-passing tests. Every finding has a status -- none disappear.
OPEN
Agent fixes locally:
FIXED
Can't fix? Escalate to GitLab:
REGISTERED
Shift4 Intelligence Platform | Harness-Driven Development

### Notes:

<!-- Slide number: 9 -->

GITLAB INTEGRATION
Automated Issue Management Pipeline
1

Discover
Structured Labels
Hardening harness tests agent as 3 restaurant owner personas. Findings auto-registered with SHA-256 fingerprint.

hardening::bug
hardening::regression
hardening::data-accuracy

hardening::memory
hardening::feature-request
2

Classify & Triage

hardening::preference-adherence
Each finding gets category (BUG, DATA_ACCURACY, etc.) and priority (P0-P3). Agent attempts fix locally first.

# Auto-create GitLab issue
3

Escalate to GitLab
python3 scripts/gitlab_issues.py create \
Unfixable findings auto-create GitLab issues with structured labels, priority, reproduce steps, and finding_id marker.
--title "Bug: Revenue off by 3%" \
--labels "hardening::data-accuracy" \
--priority "priority::P1" \
4

Retrieve & Close
--finding-id "F-a3c9e1" \
Future iterations find existing issues by finding_id. When fixed, auto-close with resolution note. Dedup prevents duplicates.
--iteration 2

# Dedup: find existing before creating
python3 scripts/gitlab_issues.py find \
--finding-id "F-a3c9e1"
Found: issue #42
Shift4 Intelligence Platform | Harness-Driven Development

### Notes:

<!-- Slide number: 10 -->

MODULAR HARNESSES #3 & #4
ORM Drift + Production Hardening

ORM Drift Detection
Production Hardening
16 Layers
3-Way Reconciliation
Schema alignment + code integrity verification against live PostgreSQL
MSSQL source of truth vs RDS vs Agent response
ETL_DRIFT: MSSQL != RDS (not agent's fault)

L1-4: Schema, columns, types, nullable
AGENT_DRIFT: RDS != Agent (agent bug)

L5: FK integrity resolution
E2E_DRIFT: All three disagree

L6-7: Forbidden attrs, import validation
ALL_MATCH: Source of truth confirmed

L8: Module import test (AttributeError)

Thresholds: Currency +/-1%, counts exact +/-1, percentages +/-0.5pp PASS / +/-1pp WARN / +/-2pp FAIL
L9-12: Query SQL, location guards, labels

L13-16: Defaults, text SQL, metrics

Local (2-way) or Prod (3-way) mode
38 ORM models | AST parsing | No DB changes
Shift4 Intelligence Platform | Harness-Driven Development

### Notes:

<!-- Slide number: 11 -->

COMPOSITION
Modular Harnesses Chain Into Full Pipelines

UAT HARNESS
HARDENING
ORM DRIFT
PROD HARDENING
RELOAD
RESEARCH
6 layers
6 phases
16 layers
7 layers
3 tiers
3-way reconcile
UI + API + Agent
Agent quality
Schema integrity
ETL accuracy
Investigation QA
Data accuracy
Example: Lifecycle SHIPPING Phase Pipeline

ORM Drift
Static Validation
UAT Smoke
UAT Full
Hardening
SHIP
→
→
→
→
→
Schema safe?
Compiles?
L1-L2 pass?
All 6 layers
Agent quality
Exit 0 only

Key Insight: Each Harness is an Independent Module
Every harness has: a CLI entry point, Pydantic models for all I/O, exit codes (0/1/2), JSON output, and no dependency on other harnesses. Teams compose them into pipelines matching their codebase's specific quality concerns.
Shift4 Intelligence Platform | Harness-Driven Development

### Notes:

<!-- Slide number: 12 -->

CONTEXT REPOSITORY
Documentation as the Knowledge Backbone
docs/ Directory: 15 Sections

How Agents Use the Context Repository

Architecture Reference
ARCH
10-section system overview, layered architecture
During PLANNING, investigation agents read these docs to ground their specs in reality. Every file path, function signature, and SQL column referenced in a plan is verified against actual documentation and code.

Data Architecture Reference
DATA
Two-schema pipeline, table reference, filtering

Agent Platform Guide
AGNT
ADDING_AN_AGENT.md: 1,655 lines, 5 contracts
Self-Check Quality Gate: "Every file path in spec exists in codebase" -- enforced before PLAN_REVIEW.

STBI Migration Bible
STBI
5 invariants, 7 critical gaps, truth hierarchy
For other teams: The docs/ directory IS the agent's memory. New engineers read docs. So do agents. Same source of truth, same context, same grounding.

Stored Procedure Reference
SP
51 STBI SPs documented, flag definitions

Migration + Discrepancy Log
MIGR
16 locations, rollback guide, FK indexes

SOPs + Runbooks
SOP
Plans as Living Artifacts
Deployment, development, troubleshooting
.claude/plans/ contains engineering specs with file:line references, Pydantic interface contracts, falsifiable ACs, and risk registers. These persist across sessions and codex reviews.
Shift4 Intelligence Platform | Harness-Driven Development

### Notes:

<!-- Slide number: 13 -->

ADOPTION RECIPE
Applying Harness-Driven Development to Any Codebase

Identify Quality Concerns
Build Pydantic Models First
Add Layers Incrementally
1

2

3

What breaks most? Schema drift? Data accuracy? UI regressions? API contracts? Each concern maps to a harness type.
Define findings, thresholds, verdicts, and reports as typed models. No Dict[str, Any]. The model IS the specification.
Start with 2-3 layers. Add more as you discover what breaks. Each layer has one concern, one exit code, one verdict.
Example: Payment gateway team needs API contract checks + data reconciliation
Example: MetricThreshold, AgentClaim, DBGroundTruth, Verdict enum
Example: Start with auth + navigation, add console audit later

What You Get
What It Costs
What It Saves
Agents that ship production code on codebases with 100K+ lines and years of technical debt -- because every phase transition is verified by machines, not by the agent's self-assessment.
One Pydantic state machine (~1,000 lines). Domain-specific verification layers (~500 lines each). Claude Code hooks for enforcement. Total: 2-5 days for the first harness, 1 day for each additional.
Zero regressions from 30+ features shipped through lifecycle. Every finding tracked. Every decision auditable. Every ship verified by 6+ programmatic layers.
Shift4 Intelligence Platform | Harness-Driven Development

### Notes:

<!-- Slide number: 14 -->

ENTERPRISE APPLICABILITY
Harness Catalog: Pick What You Need
Harness
Layers
Purpose
CLI
Best For
Lifecycle
6 phases
Full development orchestration
Feature development
lifecycle_state.py
UAT
6 layers
UI/API/agent verification
Web applications
qa_uat_harness.py
Hardening
6 phases
Agent quality + GitLab
AI/chat agents
hardening_runner.py
ORM Drift
16 layers
Schema + code integrity
Any ORM codebase
verify_orm_drift.py
Prod Hardening
3-way
Data reconciliation
ETL + data pipelines
prod_hardening_runner.py
Reload
7 layers
ETL accuracy + diagnosis
Data migrations
reload_harness.py

Payment Gateway
SkyTab POS
Data Platform
Any AI Agent
Lifecycle + UAT + Prod Hardening
Lifecycle + ORM Drift + UAT
Lifecycle + Reload + Prod Hardening
Lifecycle + Hardening + UAT
Shift4 Intelligence Platform | Harness-Driven Development

### Notes:

<!-- Slide number: 15 -->

THE BOTTOM LINE
The Agent Is Not the Product.The Harness Is.

LLMs will keep improving. Models will change. But the discipline of programmatic verification -- state machines, exit codes, layered checks, and audit trails -- that is the durable competitive advantage.

30+
0
6
100%
Features shipped
through lifecycle
Production regressions
from harness-verified code
Modular harnesses
ready to compose
Audit trail coverage
from plan to ship

Shift4 Intelligence Platform | Harness-Driven Development
Confidential -- For internal distribution

### Notes:
