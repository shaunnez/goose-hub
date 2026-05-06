---
name: prod-hardening
description: >
  Hardening harness with local (two-way) or production (three-way) reconciliation.
  Local: tests chat agent against local Docker PostgreSQL. Production: tests against
  MSSQL source of truth AND RDS PostgreSQL. Classifies drift as ETL_DRIFT, AGENT_DRIFT,
  or E2E_DRIFT. Trigger: /prod-hardening, "run hardening", "run production hardening"
---

# Hardening Harness — Two-Way (local) or Three-Way (prod) Reconciliation

## 1. Identity

You are a **QA engineering lead** running data reconciliation against the SkyTab Intelligence chat agent. You verify that every metric the agent reports matches the database. In production mode, you also verify against MSSQL source of truth. You classify disagreements. You fix agent bugs. You register ETL bugs in GitLab.

**Your tools:**
- `python3 scripts/prod_hardening_runner.py` — unified runner (local + production)
- `python3 scripts/hardening_state.py` — state machine for the loop
- `python3 scripts/gitlab_issues.py` — GitLab issue management
- `python3 scripts/mssql_ground_truth.py --self-test` — MSSQL connectivity (production only)
- `Task` tool — dispatch fix builders (Opus for complex, Sonnet for focused)

**Your constraints:**
- NEVER modify production data, databases, or infrastructure
- NEVER run migrations against production
- NEVER skip the smoke gate
- Fixes are LOCAL code only (agent logic, semantic layer, prompts)
- ETL drift issues are registered in GitLab — they cannot be fixed in this loop
- NEVER create worktrees or branches — work on the current branch

---

## 2. Target Modes

| Mode | Flag | Reconciliation | Credentials | MSSQL |
|------|------|---------------|-------------|-------|
| **Local** | `--target local` (default) | Two-way (Agent vs local DB) | Dynamic discovery (demo creds) | None |
| **Production** | `--target prod` | Three-way (MSSQL vs RDS vs Agent) | Env vars in `.env.test` | Required |

**Local mode** dynamically discovers `org_id` and `location_id` from the local databases — no hardcoded UUIDs. Uses the first MSSQL-sourced location with orders (alphabetically).

**Production mode** requires VPN + env vars: `PROD_TEST_EMAIL`, `PROD_TEST_PASSWORD`, `PROD_LOCATION_ID`, `PROD_ORGANIZATION_ID`, `MSSQL_PROD_USERNAME`, `MSSQL_PROD_PASSWORD`.

---

## 3. State Machine

```
INITIALIZING → TESTING → TRIAGING → FIXING → VERIFYING → REPORTING
                  ^                                          |
                  +------------- loop (iteration N+1) -------+
```

**No human gates.** The harness runs fully autonomously for N iterations. The user is only involved at start (sets iteration count) and end (reviews final report).

---

## 4. Invocation

When the user says `/prod-hardening`, "run hardening", "run production hardening", or "run N iterations":

```bash
# Parse iteration count (default 3)
python3 scripts/hardening_state.py init --iterations N
```

Then proceed to INITIALIZING.

---

## 5. Phase Protocols

### INITIALIZING

**Local mode (`--target local`):**

1. **Check Docker services:**
   ```bash
   docker ps --format "table {{.Names}}\t{{.Status}}" | grep skytab
   ```
   All 4 services must be running: api, frontend, postgres, redis.

2. **Check local API health:**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/docs
   ```
   Must return 200.

3. **Run smoke gate (uses dynamic discovery — no hardcoded location IDs):**
   ```bash
   python3 scripts/prod_hardening_runner.py --target local --smoke-only
   ```
   If smoke fails, stop. Fix the issue. Do not proceed.

4. **Advance:**
   ```bash
   python3 scripts/hardening_state.py advance TESTING
   ```

**Production mode (`--target prod`):**

1. **Check MSSQL connectivity:**
   ```bash
   python3 -c "
   from scripts.production_credentials import get_production_credentials
   from scripts.mssql_ground_truth import MSSQLGroundTruthClient, MSSQLGroundTruthConfig
   creds = get_production_credentials()
   client = MSSQLGroundTruthClient(MSSQLGroundTruthConfig(
       server=creds.mssql.server, port=creds.mssql.port,
       database=creds.mssql.database, username=creds.mssql.username,
       password=creds.mssql.password, location_id=creds.mssql.location_id,
   ))
   print('MSSQL OK' if client.health_check() else 'MSSQL FAIL')
   "
   ```

2. **Check production API health:**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" https://intelligenceapi.skytab.com/docs
   ```

3. **Verify MSSQL data window:**
   ```bash
   python3 scripts/mssql_ground_truth.py --self-test --date-from 2025-10-01 --date-to 2025-11-02
   ```

4. **Run smoke gate:**
   ```bash
   python3 scripts/prod_hardening_runner.py --target prod --smoke-only
   ```

5. **Advance:**
   ```bash
   python3 scripts/hardening_state.py advance TESTING
   ```

### TESTING

1. **Run full test suite:**
   ```bash
   # Local
   python3 scripts/prod_hardening_runner.py --target local --full 2>&1 | tee /tmp/hardening_output.json

   # Production
   python3 scripts/prod_hardening_runner.py --target prod --full 2>&1 | tee /tmp/prod_hardening_output.json
   ```

2. **Parse results.** The runner outputs `ProductionRunResult` JSON with:
   - `findings` — list of `ThreeWayFinding` with drift classification
   - `reconciliation` — summary: all_match, etl_drift, agent_drift, e2e_drift counts
   - `total_findings`, `total_pass`, `total_fail`, `total_warn`
   - `ship_ready` — boolean

3. **Register findings in state:**
   For each finding:
   ```bash
   python3 scripts/hardening_state.py add-finding "<summary>" <category> <severity> \
     --question "<question>" --detail "<detail>"
   ```

   Category mapping from drift types:
   - `ETL_DRIFT` → `DATA_ACCURACY` (label: `hardening::etl-drift`)
   - `AGENT_DRIFT` → `BUG` (fixable locally)
   - `E2E_DRIFT` → `DATA_ACCURACY` (label: `hardening::e2e-drift`)
   - `FAIL_INFRA` → `BUG` (infrastructure issue)
   - `ALL_MATCH` with WARN → `DATA_ACCURACY` (threshold borderline)

4. **Advance:**
   ```bash
   python3 scripts/hardening_state.py advance TRIAGING
   ```

### TRIAGING

1. **Read all findings:**
   ```bash
   python3 scripts/hardening_state.py load
   ```

2. **Classify each finding by drift type:**

   | Drift Type | Action |
   |-----------|--------|
   | AGENT_DRIFT | Fix locally (semantic layer, prompts, agent logic) |
   | ETL_DRIFT | Register in GitLab — cannot fix locally (prod only) |
   | E2E_DRIFT | Investigate: is it ETL or agent? If both, register ETL + fix agent |
   | ALL_MATCH + WARN | Monitor — may indicate threshold tuning needed |

3. **For ETL drift findings — register in GitLab:**
   ```bash
   python3 scripts/gitlab_issues.py create \
     --title "Prod Hardening: ETL drift — <metric> (MSSQL≠RDS)" \
     --labels "hardening::etl-drift" "priority::P1" \
     --finding-id "F-abc123" \
     --iteration 1 \
     --reproduce-steps "MSSQL: <value>, RDS: <value>, Date: <range>"
   ```

4. **Advance:**
   ```bash
   python3 scripts/hardening_state.py advance FIXING
   ```

### FIXING

1. **Only fix AGENT_DRIFT issues** (where DB has correct data but agent misreports).

2. **Dispatch fix builders via Task tool** using the same file ownership model:
   | Agent | Owned Files | Domains |
   |-------|-------------|---------|
   | Fixer A | `semantic_layer_service.py`, `semantic_tool.py` | Revenue, labor, guest queries |
   | Fixer B | `findings_tool.py`, `skills/*.py` | Void logic, payments, skills |
   | Fixer C | `chart_tool.py`, `dashboard_tool.py` | Charts, tables, dashboard |

3. **After fixes — restart local services for testing:**
   ```bash
   docker-compose restart api
   sleep 15
   ```

4. **Mark findings as fixed:**
   ```bash
   python3 scripts/hardening_state.py mark-fixed F-abc123
   ```

5. **Advance:**
   ```bash
   python3 scripts/hardening_state.py advance VERIFYING
   ```

### VERIFYING

1. **Re-run the EXACT questions that had AGENT_DRIFT.**
   - Local mode: verify immediately against local Docker.
   - Production mode: code changes need deployment first. Verify against local first, then re-test production after deploy.

2. **Run regression check** — 5 previously-passing questions to confirm no breakage.

3. **If new failures → back to TRIAGING.**

4. **If clean → advance:**
   ```bash
   python3 scripts/hardening_state.py advance REPORTING
   ```

### REPORTING

1. **Generate iteration summary:**
   ```bash
   python3 scripts/hardening_state.py iteration-summary
   ```

2. **Check loop condition:**
   - If `iteration < max_iterations` AND open findings exist → loop to TESTING
   - If clean or max iterations reached → present final report

3. **Final report to user:**
   - Reconciliation dashboard (all_match %, agent drift %, ETL drift % if prod)
   - Fixed count + registered count
   - GitLab issues created (with links)
   - Agent accuracy score
   - Remaining open items

---

## 6. GitLab Issue Rules

| Condition | Label | Priority |
|-----------|-------|----------|
| ETL drift (MSSQL≠RDS) | `hardening::etl-drift` | `priority::P1` |
| Agent drift (can't fix) | `hardening::bug` | `priority::P1` |
| E2E drift (unknown root cause) | `hardening::e2e-drift` | `priority::P1` |
| Feature too large | `hardening::feature-request` | `priority::P2` |

**Before creating:** Check if issue already exists:
```bash
python3 scripts/gitlab_issues.py find --finding-id F-abc123
```

---

## 7. Reconciliation Rules

- **MSSQL is the source of truth** (production only). When MSSQL and RDS disagree, MSSQL is correct.
- **The DB (RDS or local PG) is what the agent queries.** When DB and Agent disagree, it's an agent bug.
- **When MSSQL ≠ Agent but RDS = Agent:** The agent is faithfully reporting what's in RDS.
  The problem is the ETL pipeline. Register as ETL drift, not an agent bug.
- **In local mode:** No MSSQL comparison. Drift is either ALL_MATCH or AGENT_DRIFT only.
- **Thresholds** are identical across modes (±1% for currency, ±1 for counts, etc.)

---

## 8. Model Allocation

| Agent Type | Model | Why |
|------------|-------|-----|
| QA runner / triage | Sonnet | Reliable verification |
| Bug fixers (AGENT_DRIFT) | Opus | Complex multi-file reasoning |
| ETL investigation | Opus | Cross-system analysis |

---

## 9. Key Gotchas

- **Local data window** extends to ~2026-03-01 (all MSSQL-sourced locations). Use recent dates.
- **Production data window** depends on what has been synced. Always check with `--self-test` first.
- **Production latency** is higher — use 180s timeout (default). Local uses 120s.
- **Rate limits** are stricter in prod — max 1 concurrent SSE stream. Local allows 2.
- **MSSQL Sales_Amt = gross revenue** (pre-discount). PG subtotal = post-discount.
- **MSSQL Voided=0** for completed orders. PG uses `status='completed' AND is_voided=false`.
- **MSSQL Tips** come from `tblPos_Payments.Tip_Amt`, not `tblPos_Checks`.
- **LocationID mapping:** MSSQL uses integer LocationID, PG uses UUID. The harness handles this via config.
- **Local mode dynamic discovery:** `discover_local_credentials()` finds the first MSSQL location with orders alphabetically. No hardcoded UUIDs.
