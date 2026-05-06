# Training: Building a Data Quality Check / Drift Detection Loop

How to build layered drift detection harnesses and N-way data reconciliation loops.
Covers ORM drift, schema drift, and multi-source reconciliation (source-of-truth vs
replica vs application). The companion template at the end is pluggable.

---

## Two Patterns: Static Drift vs Live Reconciliation

### Pattern 1: Static Drift Detection

Compares two things that should match: your ORM models vs the actual database schema,
your API contracts vs the actual responses, your TypeScript types vs the backend models.

**Use when:** You have a code representation and a live system, and they should agree.

### Pattern 2: Live Reconciliation (N-Way)

Compares multiple live data sources: source-of-truth database vs replica vs what the
application reports. Classifies disagreements by root cause.

**Use when:** Data flows through a pipeline (source -> ETL -> replica -> app) and you
need to know WHERE drift enters.

---

## Pattern 1: The Layered Drift Harness

### Architecture

A drift harness checks alignment between code and reality in layers, from coarse to
fine:

| Layer | Check | Requires DB | Example |
|-------|-------|-------------|---------|
| 1 | **Schema Presence** | Yes | Do all ORM tables exist in the database? |
| 2 | **Column Alignment** | Yes | Phantom columns (in ORM, not DB) + missing columns (in DB, not ORM) |
| 3 | **Type Alignment** | Yes | SQLAlchemy type vs `information_schema` type/precision/length |
| 4 | **Nullable Alignment** | Yes | Nullable flag drift between ORM and DB |
| 5 | **FK Integrity** | Yes | Foreign key target resolution |
| 6 | **Forbidden Attributes** | No | Renamed column usage in application code (grep) |
| 7 | **Import Validation** | No | ORM attribute access verification (AST/grep) |
| 8 | **Module Import Test** | No | Catch `AttributeError` on actual module import |

**Why this order:** Layers 1-5 require database connectivity. Layers 6-8 are
code-only checks that can run in CI without a database. The ordering also goes from
"does it exist?" to "is it used correctly?"

### Output Format

Each layer produces structured results:

```json
{
  "layer": 2,
  "name": "Column Alignment",
  "status": "FAIL",
  "findings": [
    {
      "type": "PHANTOM",
      "table": "orders",
      "column": "legacy_status",
      "detail": "Column exists in ORM but not in database"
    },
    {
      "type": "MISSING",
      "table": "orders",
      "column": "fulfillment_id",
      "detail": "Column exists in database but not in ORM"
    }
  ]
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All layers pass (with optional WARN) |
| 1 | Drift detected (any FAIL finding) |
| 2 | Infrastructure error (can't connect to DB or parse models) |

### Fix Patterns by Layer

| Layer | Finding | Fix |
|-------|---------|-----|
| 2 (phantom) | Column in ORM, not in DB | Remove from ORM model |
| 2 (missing) | Column in DB, not in ORM | Add to ORM model (match DB exactly) |
| 3 (type) | Type mismatch | Fix the ORM type to match `information_schema` |
| 4 (nullable) | Nullable flag mismatch | Fix the ORM `nullable` parameter |
| 5 (FK) | FK target doesn't resolve | Fix the relationship definition |
| 6 (forbidden) | Using renamed column name | Use the correct attribute name (message tells you) |
| 7 (invalid access) | Attribute doesn't exist on model | Check model for correct column name |
| 8 (import error) | Module crashes on import | Traceback shows exactly which attribute is wrong |

### When to Run

- After any model change
- After any migration
- After any query migration (raw SQL -> ORM)
- Before shipping features that touch the data layer
- In CI on every push (target)

---

## Pattern 2: N-Way Reconciliation

### The Three Sources

| Source | Role | Example |
|--------|------|---------|
| **Source of Truth** | Authoritative data | MSSQL production database, upstream API |
| **Replica** | Where your app actually queries | PostgreSQL RDS, local Postgres, data warehouse |
| **Application** | What the app reports to users | API responses, chat agent answers, dashboard values |

### Drift Classification

When sources disagree, the root cause determines the label:

| Source of Truth | Replica | Application | Classification | Who Fixes |
|----------------|---------|-------------|---------------|-----------|
| $100 | $100 | $95 | **APP_DRIFT** | Your team (agent logic, queries, rounding) |
| $100 | $95 | $95 | **ETL_DRIFT** | Data engineering (pipeline bug) |
| $100 | $95 | $90 | **E2E_DRIFT** | Both teams (ETL + app errors compound) |
| $100 | $100 | $100 | **ALL_MATCH** | Nobody (healthy) |

**Key insight:** When source-of-truth and replica disagree, it's NEVER the
application's fault -- the app faithfully reports what it queries. Don't file bugs
against the app for ETL drift.

### Reconciliation Protocol

```
1. Query source of truth: "What is revenue for location X on date Y?"
   -> MSSQL says $100

2. Query replica: same question
   -> PostgreSQL says $95

3. Ask application: same question (via API or chat)
   -> App says $95

4. Compare:
   - SOT vs Replica: $100 != $95 -> ETL_DRIFT
   - Replica vs App: $95 == $95 -> App is faithful
   - Classification: ETL_DRIFT (not app's fault)
```

### Two-Way vs Three-Way

| Mode | Sources | Use When |
|------|---------|----------|
| **Two-Way** (local) | Replica + Application | Testing locally, no source-of-truth access |
| **Three-Way** (production) | Source of Truth + Replica + Application | Full production reconciliation |

In two-way mode, drift is either ALL_MATCH or APP_DRIFT. You can't detect ETL drift
without the source of truth.

### Thresholds

Not all disagreements are bugs. Define tolerances:

| Metric Type | Tolerance | Example |
|-------------|-----------|---------|
| Currency | +/- 1% or $0.01 | Revenue: $100.00 vs $100.01 is OK |
| Count | +/- 1 | Guest count: 150 vs 149 may be OK |
| Percentage | +/- 0.5% | Labor %: 25.0% vs 25.3% is OK |
| Boolean | Exact | Is voided: must match exactly |

---

## Building the Reconciliation Loop

The reconciliation loop wraps the N-way check in a fix loop (see `05-fix-loop.md`):

```
INITIALIZING -> TESTING -> TRIAGING -> FIXING -> VERIFYING -> REPORTING
                   ^                                            |
                   +------------- loop (iteration N+1) ---------+
```

**TRIAGING differences from a standard fix loop:**

| Drift Type | Action |
|-----------|--------|
| APP_DRIFT | Fix locally (query logic, rounding, filter bugs) |
| ETL_DRIFT | Register in issue tracker (cannot fix locally) |
| E2E_DRIFT | Investigate: split into ETL component (register) + app component (fix) |
| ALL_MATCH + WARN | Monitor (threshold borderline -- may indicate future drift) |

**FIXING scope:** Only APP_DRIFT issues are fixable in the loop. ETL_DRIFT issues
get registered and tracked. This is a hard boundary -- the loop never modifies
upstream data or pipelines.

---

## Companion Script Architecture

### Drift Harness Script

```python
# scripts/verify_drift.py
#
# Flags:
#   --verbose          Human-readable output
#   --json             Machine-readable JSON
#   --layer N          Run specific layer only
#   --tables t1,t2     Check specific tables only
#
# Output: JSON array of LayerResult objects
# Exit: 0 (clean), 1 (drift), 2 (infra error)
#
# Each LayerResult:
#   layer: int
#   name: str
#   status: "PASS" | "FAIL" | "WARN"
#   findings: list[Finding]
```

### Reconciliation Script

```python
# scripts/reconciliation_runner.py
#
# Flags:
#   --target local|prod     Two-way or three-way
#   --full                  All metrics
#   --smoke-only            Quick health check
#   --json                  Machine-readable
#
# Output: ReconciliationResult JSON
#   findings: list[NWayFinding]
#   reconciliation: {all_match: N, etl_drift: N, app_drift: N, e2e_drift: N}
#   ship_ready: bool
```

### Ground Truth Client

```python
# scripts/source_of_truth_client.py
#
# Wraps connection to source-of-truth database
# Methods:
#   health_check() -> bool
#   query_revenue(location_id, date_range) -> Decimal
#   query_guests(location_id, date_range) -> int
#   query_metric(metric_name, location_id, date_range) -> Any
#
# Config: environment variables for credentials
# Self-test: --self-test flag verifies connectivity + data window
```

---

## Pluggable Templates

### Template A: Static Drift Harness Skill

```markdown
---
name: drift
description: >
  {{Domain}} drift detection and integrity verification. Runs the unified
  {{LAYER_COUNT}}-layer harness against the live {{data_source}} and codebase.
  Trigger: /drift, "run drift check", "check {{domain}} drift"
---

# {{Domain}} Drift Detection Skill

## What This Does

Runs `scripts/{{drift_script}}.py` -- the unified {{LAYER_COUNT}}-layer verification
harness -- and reports results.

## Layers

| Layer | Check | Requires {{data_source}} |
|-------|-------|--------------------------|
| 1 | {{check_1}} | Yes |
| 2 | {{check_2}} | Yes |
| 3 | {{check_3}} | Yes |
| 4 | {{check_4}} | No |
| 5 | {{check_5}} | No |

## How to Run

```bash
# Full scan (all layers, all targets)
{{run_command}} --verbose

# Specific layer
{{run_command}} --layer 3

# JSON output for CI
{{run_command}} --json

# Code-only checks (no {{data_source}} needed)
{{run_command}} --layer 4
```

## Interpreting Results

- **0 failures, 0 warnings** = clean
- **Failures in Layer 1** = {{interpretation_1}}
- **Failures in Layer 2** = {{interpretation_2}}
- **Failures in Layer N** = {{interpretation_N}}

## Exit Codes

- `0` = all layers pass
- `1` = drift detected
- `2` = infrastructure error

## When to Run

- After any {{model_type}} change
- After any migration
- Before shipping features that touch {{domain}}
- In CI on every push

## Fixing Drift

| Layer | Finding | Fix |
|-------|---------|-----|
| 1 | {{finding}} | {{fix}} |
| 2 | {{finding}} | {{fix}} |
```

### Template B: N-Way Reconciliation Loop Skill

```markdown
---
name: {{reconciliation-name}}
description: >
  {{Domain}} reconciliation with {{two_or_three}}-way comparison.
  {{Source description}}. Classifies drift as {{DRIFT_TYPES}}.
  Trigger: /{{reconciliation-name}}, "{{trigger}}"
---

# {{Domain}} Reconciliation Harness

## 1. Identity

You are a **QA engineering lead** running data reconciliation against
{{system_under_test}}. You verify that every metric reported matches the database.
{{If three-way: You also verify against the source of truth.}}
You classify disagreements. You fix app bugs. You register ETL bugs.

**Your tools:**
- `python3 scripts/{{runner_script}}.py` -- unified runner
- `python3 scripts/{{state_script}}.py` -- state machine
- `python3 scripts/{{issue_script}}.py` -- issue tracker
- `Task` tool -- dispatch fix builders

**Your constraints:**
- NEVER modify {{source_of_truth}} data
- NEVER run migrations against production
- NEVER skip the smoke gate
- Fixes are LOCAL code only ({{fixable_scope}})
- {{ETL_type}} drift issues are registered -- they cannot be fixed in this loop

## 2. Target Modes

| Mode | Flag | Comparison | {{Source}} |
|------|------|-----------|------------|
| Local | `--target local` | Two-way (App vs local DB) | None |
| Production | `--target prod` | Three-way ({{SOT}} vs {{Replica}} vs App) | Required |

## 3. State Machine

```
INITIALIZING -> TESTING -> TRIAGING -> FIXING -> VERIFYING -> REPORTING
                   ^                                            |
                   +------------- loop (iteration N+1) ---------+
```

## 4. Drift Classification

| {{SOT}} | {{Replica}} | App | Classification | Action |
|---------|-------------|-----|---------------|--------|
| $100 | $100 | $95 | APP_DRIFT | Fix locally |
| $100 | $95 | $95 | ETL_DRIFT | Register in issue tracker |
| $100 | $95 | $90 | E2E_DRIFT | Split: register ETL + fix app |
| $100 | $100 | $100 | ALL_MATCH | Healthy |

## 5. Thresholds

| Metric | Tolerance |
|--------|-----------|
| {{metric_1}} | {{tolerance_1}} |
| {{metric_2}} | {{tolerance_2}} |

## 6. Phase Protocols

(Same as fix loop -- see 05-fix-loop.md for the full pattern.
Key difference: TRIAGING routes ETL_DRIFT to issue tracker, APP_DRIFT to fix queue.)
```

---

**End of Data Quality Check Training Document**
