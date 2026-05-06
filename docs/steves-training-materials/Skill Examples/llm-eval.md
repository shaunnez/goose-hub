# LLM Eval - Agent Trace Analysis

Run a comprehensive LLM evaluation of agent traces from Langfuse.

**Arguments:** `$ARGUMENTS` - Optional category filter: `all`, `revenue`, `labor`, `forecast`, `simulation`, `product`, `server`, `operations`, `tax`, `payments`, `guest`, `analysis`, `chart`

---

## STEP 1: Prepare Traces

Run this command to fetch and chunk traces:

```bash
python3 scripts/llm_eval_prepare.py $ARGUMENTS --limit 100
```

Read the metadata to get chunk count:
```bash
cat /tmp/eval_metadata.json
```

---

## STEP 2: Spawn Eval Agents

For EACH chunk file, spawn a parallel Task agent (subagent_type="general-purpose").

**IMPORTANT:** Read `/tmp/eval_metadata.json` first to see how many chunks exist.

**Agent prompt for chunk N:**

```
You are an LLM evaluator. Read `/tmp/eval_chunk_N.json` and evaluate EVERY trace.

**Output format for each trace:**
### Trace [idx]: "[query]"
**Verdict:** PASS | FAIL | PARTIAL
**Tools Used:** [list or None]
**Reasoning:** [1-2 sentences]
**Issue (if any):** [detailed description of what went wrong]
**Root Cause (if FAIL/PARTIAL):** [likely cause - e.g., "daypart aggregation not filtering by date", "DigitalTwin doesn't accept location_id"]
**Fix Needed (if FAIL/PARTIAL):** [specific fix - e.g., "Add date filter to _breakdown_revenue_by_daypart()", "Remove location_id from DigitalTwin init"]
**File to Fix (if known):** [e.g., "backend/app/services/semantic_layer_service.py"]

**Verdict criteria:**
- PASS: Correct tool choice, accurate data, helpful response
- PARTIAL: Right approach but minor issues (truncation, tool failure with recovery)
- FAIL: Wrong data, tool failures without recovery, empty response, impossible numbers

**Accuracy benchmarks (Macon location, October 2025):**
- Gross revenue: ~$103.9K
- Net revenue: ~$102.6K
- Guest count: ~7,269
- Order count: ~3,919
- Labor %: ~32.7%
- SPLH: ~$47
- Void rate: ~0.8%
- Tax rate: ~9.3%
- Top server (Cynthia): ~$24K

**Skip these known issues:**
- "0 days of data available" - forecasting data gap
- "missing input_data argument" - known bug
- "DigitalTwin" errors - known bug
- FK constraint on first try if retry works

At the end, output:
## Summary
- PASS: X
- PARTIAL: X
- FAIL: X
- Critical issues: [list any FAIL or major PARTIAL issues]
```

---

## STEP 3: Consolidate Results

After all agents complete, create an **actionable issue log** with specific fixes:

1. **Collect all FAIL and PARTIAL traces** with full detail
2. **Group by root cause** - same underlying bug may affect multiple traces
3. **Identify the specific fix** for each issue
4. **Map to files** that need to be changed
5. **Prioritize** by impact (how many traces affected)

Create report at `docs/Plans/llm-eval-YYYYMMDD.md` with:

### Required Sections:

**1. Summary Stats** - Pass/Fail/Partial counts

**2. Issues to Fix** (grouped by root cause):
```
### Issue: [Root Cause Description]
- **Traces Affected:** X, Y, Z
- **Symptom:** What the user sees wrong
- **Root Cause:** Why it's happening
- **Fix:** Specific code change needed
- **File:** Exact file path
- **Priority:** P0/P1/P2
```

**3. Files to Modify** - Deduplicated list of files with all issues in each

**4. Fix Order** - Recommended sequence to fix issues

---

## STEP 4: Output Summary

Output a summary with **specific actionable fixes**:

```markdown
## LLM Eval Results

| Metric | Value |
|--------|-------|
| Traces | X |
| PASS | X (Y%) |
| PARTIAL | X (Y%) |
| FAIL | X (Y%) |

---

## Fixes Required

### P0 - Critical (breaks functionality)

#### 1. Daypart Aggregation Returns Impossible Numbers
- **Traces:** 28, 74
- **Symptom:** Daypart totals $708K when monthly revenue is $103K
- **Root Cause:** Query missing date filter, aggregating all historical data
- **Fix:** Add `WHERE business_date BETWEEN :date_from AND :date_to` to daypart breakdown query
- **File:** `backend/app/services/semantic_layer_service.py` line ~1340 `_breakdown_revenue_by_daypart()`

#### 2. DigitalTwin Simulation Broken
- **Traces:** 44, 45, 46, 47
- **Symptom:** "DigitalTwin.__init__() got unexpected keyword argument 'location_id'"
- **Root Cause:** simulation_tool.py passing location_id but DigitalTwin doesn't accept it
- **Fix:** Remove location_id from DigitalTwin instantiation or add it to DigitalTwin.__init__()
- **File:** `backend/app/agents/dashboard_agent/tools/simulation_tool.py`

### P1 - High (incorrect data)

#### 3. [Next issue...]
...

---

## Files to Modify (in order)

1. `backend/app/services/semantic_layer_service.py`
   - Fix daypart aggregation date filter

2. `backend/app/agents/dashboard_agent/tools/simulation_tool.py`
   - Fix DigitalTwin location_id argument

3. ...
```

---

## Category Filters

| Category | Matches |
|----------|---------|
| `all` | Everything (default) |
| `revenue` | revenue, sales, gross, net, discount |
| `labor` | labor, staff, server, shift, splh, schedule |
| `forecast` | forecast, predict, expect, tomorrow, busy |
| `simulation` | what if, simulate, scenario, impact |
| `product` | product, menu, item, category, pmix |
| `server` | server, waiter, tip, performance, ranking |
| `operations` | void, comp, refund, variance |
| `tax` | tax, compliance, rate |
| `payments` | payment, cash, credit, card |
| `guest` | guest, customer, party, table |
| `analysis` | analyze, investigate, why, explain |
| `chart` | chart, graph, visualize, show, breakdown |

---

## Quick Examples

```
/llm-eval                  # All traces
/llm-eval forecast         # Just forecasts
/llm-eval labor            # Just labor queries
/llm-eval --limit 50       # Last 50 traces
```

---

## Files

| File | Purpose |
|------|---------|
| `scripts/llm_eval_prepare.py` | Fetch & chunk traces |
| `scripts/llm_eval_consolidate.py` | Consolidate results |
| `/tmp/eval_chunk_*.json` | Chunked trace data |
| `/tmp/eval_metadata.json` | Chunk count & metadata |
| `docs/Plans/llm-eval-*.md` | Final reports |
