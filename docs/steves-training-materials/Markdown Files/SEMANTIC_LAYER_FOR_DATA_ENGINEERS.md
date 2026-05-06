# The Semantic Layer, Explained for Data Engineers

> **Audience.** You build the warehouse. You shape the marts. You write the
> migrations. This document is for you.
>
> **Goal.** Give you a clean mental model of *why* SkyTab Intelligence has a
> semantic layer at all, *what it actually encodes*, and *how it lets an LLM
> answer questions that no single SQL view could ever pre-compute*.
>
> **TL;DR.** The semantic layer is **a contract between meaning and rows**.
> It compiles human and database authority into a finite vocabulary of
> domains, metrics, and breakdowns that the LLM composes at query time. It is
> not a layer of abstraction "for cleanliness." It is what makes the
> combinatorial blowup of natural-language analytics tractable.

---

## 1. Why this layer has to exist

A restaurant operator asks four questions in one sentence:

> *"Why was last Saturday weird — was it labor cost, the discount on the steak,
> or those voids on table 14?"*

This single utterance touches:

- **Three domains** — labor (cost %, hours), product (discount on steak),
  operations (voids).
- **Two granularities** — daily summary (was Saturday weird?) and
  transactional raw (table 14 voids).
- **One implicit benchmark** — "weird" means "different from a normal
  Saturday at this location."
- **Two breakdowns** — by date, then by table/server.

A traditional report can only pre-compute *one* of these joins. The
combinatorics of how a human chains domains, breakdowns, time windows, and
benchmarks are effectively infinite — and unlike a fixed BI dashboard, you
*cannot* document every path. The fan-out alone would dwarf the data model.

So we don't try.

We give the LLM a **finite set of reusable primitives** — domains, metrics,
breakdowns, disclosure tiers, skills — and let it *compose* the answer at
query time. The semantic layer is the catalog of those primitives, plus the
SQL that materialises them.

> The layer's job is not to flatten the data. It is to give the LLM a
> vocabulary small enough to reason over, and rich enough that almost every
> sensible question is a recombination of primitives that already exist.

---

## 2. What "encoding" means here

Every cell in the semantic layer is a **claim about meaning**, sourced from
one of two authorities:

| Authority | Where it lives | Examples |
|---|---|---|
| **Database authority (STBI / MSSQL)** | Upstream POS schema; treat as canonical for transaction shape | `orders.business_date`, `payment_transactions.tip_amount`, the fact that `void_time` is a sync timestamp not a business date |
| **Human / process authority** | Domain experts, ops playbooks, support history; encoded by us in config + skills | "labor %" = `labor_cost / net_revenue`, "peak hour" = top 3 hours by net sales, "weird Saturday" = >1σ from the location's prior 8 Saturdays |

Both kinds of authority arrive as **the same artefact**: a field in
`DOMAIN_CONFIG`, or a step inside a `BaseSkill` subclass. The LLM does not
know — and does not need to know — which authority it came from.

The semantic layer is, in this sense, a **compiler**:

```
                                       ┌─────────────────────────┐
   STBI / MSSQL schema  ────────┐      │                         │
   Materialised views   ────────┤      │   SEMANTIC LAYER        │
   `mv_daily_*` rollups ────────┼─────▶│   (config + service +   │─────▶  LLM
                                │      │    skills + breakdowns) │      tool surface
   Ops playbooks        ────────┤      │                         │
   Support patterns     ────────┤      │   9 domains             │
   Definitional truths  ────────┘      │   60+ metrics           │
                                       │   30+ breakdowns        │
                                       │   3 disclosure tiers    │
                                       │   17 skills             │
                                       └─────────────────────────┘
```

If this looks like a feature store crossed with a metrics layer crossed with
a stored-procedure library — that is exactly what it is, by design. The new
constraint is the LLM, and the LLM rewards a *small, dense, compositional*
vocabulary over a sprawling, denormalised one.

---

## 3. The five primitives

The semantic layer is built from five things and only five things. Every new
piece of work fits one of these slots; if it doesn't, you are designing a
sixth primitive and we should talk before you ship.

### 3.1 Domain

Nine of them. Each one is a coherent slice of the operator's world that maps
cleanly to one or two source tables/views. Defined in
`backend/app/services/semantic_layer/config.py`.

```python
DOMAIN_CONFIG = {
    "revenue":  { "summary_view": "mv_daily_financial_metrics", ... },
    "labor":    { "summary_view": "mv_daily_financial_metrics",
                  "detail_table": "employee_shifts", ... },
    "guest":    { ... },
    "product":  { ... },
    "operations": { ... },
    "payments": { ... },
    "tax_compliance": { ... },
    "forecasting": { ... },
    "server":   { ... },
}
```

A domain answers one question: *which table am I going to roll up against?*
That's it. Domains are intentionally cheap and shallow. They are the LLM's
top-level filing cabinet.

### 3.2 Metric

A named, **defined** quantity inside a domain. Each metric carries:

- `name` — the wire/SQL name
- `label` — the human label the LLM uses in prose
- `unit` — `$`, `%`, `hrs`, `None`
- `lower_is_better` — yes, this is a model-facing field. The LLM uses it to
  describe direction without inventing one.

```python
"labor": {
    "metrics": [
        {"name": "labor_pct", "label": "Labor %", "unit": "%", "lower_is_better": True},
        ...
    ],
}
```

Metrics are the unit of meaning. They look like trivial dictionary entries —
they are not. Every row encodes a decision: *this number, with this name,
means this thing in this domain, and lower-is-better.* That is the human
authority surfacing as data.

### 3.3 Breakdown

A dimension you can group a metric by **inside its domain**. Examples:
`daypart`, `revenue_center`, `day_of_week`, `server`, `void_reason`,
`payment_method`, `location`.

The breakdown list per domain is enumerated. The LLM cannot ask for "group
by anything" — it can only ask for one of the listed dimensions, and the
service knows the SQL that implements it (in `breakdowns_*.py`).

This is what bounds the fan-out. A grand-total fact table has thousands of
columns; a domain × breakdown matrix has perhaps a hundred cells, and we
implement them deliberately.

### 3.4 Disclosure tier

Same idea you saw in the integration pattern doc, applied to data:

```python
class DisclosureLevel(str, Enum):
    SUMMARY = "summary"   # KPIs with status         (~500 tok,  <50 ms)
    DETAIL  = "detail"    # Breakdowns by dimension   (~2000 tok, <200 ms)
    RAW     = "raw"       # Transaction-level data    (~5000 tok, <500 ms)
```

The LLM can only see one tier per call. If it wants the next tier, that is a
new tool call with explicit consent from the caller. **This is the lever
that keeps the answer cheap when the question is broad, and lets the answer
be deep when the question narrows.**

`SUMMARY` returns metric values plus a `MetricStatus` (`excellent / good /
warning / critical`) inferred from per-location benchmarks. The status is
itself an encoding decision: we're saying "the operator does not need
percentiles, they need a verdict." That verdict comes from
`BenchmarkInferenceService` looking at the location's own history — not
hardcoded thresholds.

### 3.5 Skill

A **named human procedure**, frozen in code, that produces a `SkillResult`.
Skills are where ops playbooks and support institutional knowledge get
encoded once and re-used forever. A skill is *not* a tool the LLM picks
freely — it's a deliberate route the LLM is allowed to invoke when the
question matches the skill's intent.

Examples (from `backend/app/services/skills/`):

| Skill | What it encodes | Source of authority |
|---|---|---|
| `peak_hour_analysis` | "Peak = top 3 hours by net sales; concentration > 80% is a flag" | Ops practice |
| `void_investigation` | Forensic walk through `order_item_voids` joined with shift + manager | Loss-prevention playbook |
| `tip_compliance_audit` | Detect unreported cash tips by triangulating server, shift, payment method | IRS guidance + internal audit policy |
| `cash_variance_report` | Drawer counts vs cash sales reconciliation; thresholds per location | Finance team policy |
| `menu_engineering_cluster` | BCG matrix (stars/dogs/puzzles/horses) on item PMIX | Industry-standard analytical pattern |
| `staffing_optimizer` | Forecasted demand × labor cost target → schedule | Operations research |

Each skill is a **reproducible expert reading** of the same primitives the
LLM has access to. The skill has a name, a parameter contract, and a typed
result. The LLM doesn't get to write the SQL inside `peak_hour_analysis` —
it can only call it. That's the point.

> **The two halves of the layer.**
>
> *Configuration encodes the database's truth.* The metric `tip_amount`
> exists because `payment_transactions.tip_amount` exists; the field
> mapping in `RAW_FIELD_MAPPINGS` is a literal claim about the column.
>
> *Skills encode the human's truth.* `peak_hour_analysis` exists because a
> domain expert told us that "peak" means "top 3" with "concentration >
> 80%" as the watch line. No row in the warehouse contains that
> definition. The skill is the row.

---

## 4. How the LLM composes an answer

The deck (`tooling-philosophy-no-mcp.pptx`) covers the ReAct loop. Here is
what that loop looks like *against the semantic layer*, end to end, for the
"weird Saturday" question above.

```
USER:  "why was last Saturday weird — labor, the steak discount, or table 14?"

LLM (reason):  three claims to verify
   ─ claim A: labor was off    →  semantic_query(domain=labor,    summary, dates=[Sat])
   ─ claim B: discount on steak →  semantic_query(domain=product, detail,  breakdown=menu_item, dates=[Sat])
   ─ claim C: voids on table 14 →  semantic_query(domain=operations, raw,  filter={table:14}, dates=[Sat])

semantic_layer:
   ↳ A returns labor_pct=34.2% (status=critical, benchmark=27.5% trailing-8-Sat avg)
   ↳ B returns 4 menu_item rows; "ribeye" has 22% discount_pct vs domain avg 8%
   ↳ C returns 3 raw void records on table 14, voided_by="kelly", reason="customer_changed_mind"

LLM (synthesize):
   "Labor was 34.2% — about 7 points above your trailing 8-Saturday average,
    so most of the weirdness is there.  The ribeye had a 22% discount that
    day vs your usual 8%, which dragged net.  Table 14 had 3 voids by Kelly
    for 'customer changed mind' — small dollar impact (~$48) but worth a
    look."
```

Notice what *did not* happen:

- The LLM did not write SQL.
- The LLM did not invent the labor benchmark — `BenchmarkInferenceService`
  computed it from this location's history.
- The LLM did not pick a random breakdown — it picked `menu_item` because
  the *product* domain advertises it.
- The LLM did not reach for a "weird Saturday" view — there isn't one. The
  `MetricStatus=critical` flag *is* the verdict.

That third bullet is the core trick. The LLM is asking:

> *"Inside the slice you've handed me, how do I drill?"*

— and the semantic layer answers in a typed, enumerated way every time. The
LLM never has to explore the schema. It explores the **vocabulary**.

---

## 5. Why this beats "just teach the LLM SQL"

Two failure modes you have probably already considered.

**(a) "Give the LLM a SQL tool against the warehouse."** Tried. Fails for
predictable reasons:

- The model invents column names that don't exist (`orders.is_weekend`,
  `voids.was_suspicious`).
- It writes joins on the wrong key — `void_time::date` instead of
  `business_date` — and we have lost real money to that exact mistake.
- It doesn't know which view is materialised; it scans `orders` for a
  trailing-30 KPI and we're paying for full table scans every chat turn.
- It cannot enforce row-level tenant scoping. The semantic layer requires
  `location_ids` at construction (`SemanticLayerService.__init__` raises if
  empty) so there is no SQL path that *forgets* the tenant.

**(b) "Build a bigger BI cube."** Also tried, in spirit, with materialised
views. They are great, and we use them — `mv_daily_financial_metrics`,
`mv_daily_product_performance`, `ml_features_hourly` — but they are the
*storage* layer, not the *meaning* layer. A cube can tell you the labor cost
on Saturday. It can't tell you that 34.2% is bad *for this location*. That
takes a per-location benchmark and an inferred status, and those live above
the cube, in the semantic layer.

The semantic layer is the place where:

- The materialised view's row meets the operator's vocabulary.
- The benchmark inference meets the metric definition.
- The skill's expert procedure meets the LLM's request to invoke it.

It is the only place where all four authorities (DB, MV, benchmark, expert
procedure) can be reconciled into a single typed response.

---

## 6. Where the rows actually come from

Quick map for someone wiring up a new metric or domain. You will touch some
combination of these:

| Layer | What lives there | When you change it |
|---|---|---|
| **Source tables** (`pos_operational`) | `orders`, `order_items`, `order_item_voids`, `payment_transactions`, `employee_shifts` | When STBI/MSSQL upstream changes — Alembic migration |
| **Materialised views** | `mv_daily_financial_metrics`, `mv_daily_product_performance`, `ml_features_hourly` | When you need a new pre-aggregation; touch the migration + refresh schedule |
| **Domain config** (`semantic_layer/config.py`) | `DOMAIN_CONFIG[domain]["metrics"]` and `["breakdowns"]` | When you expose a new metric/breakdown to the LLM. **No deploy is needed downstream — the manifests reference domains, not metrics.** |
| **Field mappings** (`RAW_FIELD_MAPPINGS`) | column-by-column declaration of what the RAW tier returns | When you want a new column reachable at the raw tier |
| **Domain fetchers** (`semantic_layer/domain_fetchers.py`) | The actual SQL that fills the summary tier | Rarely; only if a domain's roll-up logic changes |
| **Breakdown modules** (`breakdowns_revenue.py`, `breakdowns_labor.py`, …) | Per-dimension SQL inside a domain | When you wire a new breakdown |
| **Benchmark inference** (`BenchmarkInferenceService`) | The `MetricStatus` derivation per location | When the "what is good" rule changes |
| **Skills** (`services/skills/*.py`) | Named expert procedures | When ops/finance/support give you a new playbook to encode |

The discipline that makes this work: **each metric you add has exactly one
home in this table.** Don't add a breakdown by hand-writing SQL in a skill;
add it to the breakdown module. Don't add a metric to a skill's locals; add
it to `DOMAIN_CONFIG`. The LLM can only see what the contract advertises.

---

## 7. The encoding rules — short list

These are the rules that keep the layer composable. They are also the rules
that make code review opinionated.

1. **Every metric has units and a direction.** No bare numbers escape the
   service. `lower_is_better` is part of the metric's identity.

2. **Every domain declares its breakdowns.** If the LLM asks for a breakdown
   the domain doesn't list, it is a 400, not a 200. New breakdown ⇒ new
   code, not new prompt.

3. **Disclosure tier picks the cost.** Summary < Detail < Raw. The LLM
   never gets to ask for "everything" — it asks for a tier and a domain.

4. **Status is inferred, not authored in the prompt.** The model never
   guesses whether 34% labor is bad. `MetricStatus` is a derived field,
   computed against the location's own history.

5. **`location_ids` is mandatory.** No constructor path produces a
   tenant-broad query. SQL injection, tenant leak, and "wait, whose data is
   this" classes of bug are eliminated by construction.

6. **Skills own their authoritative procedures.** If a definition matters
   ("a peak is the top 3 hours by net sales, period"), it lives in a skill.
   Not in a prompt. Not in a markdown doc.

7. **Raw tier respects field whitelists.** `RAW_FIELD_MAPPINGS` is a literal
   contract: those fields, those types, that join. Adding a column requires
   touching the mapping, which requires a code review.

8. **`business_date` always.** Never `void_time::date`. Never
   `created_at::date`. The platform has paid for that mistake — see
   `feedback_void_time_business_date.md` in memory if you ever doubt it.

If a PR breaks one of these, send it back. The integrity of the encoding is
what makes the LLM's compositions reliable. Every shortcut here re-blooms as
a class of hallucinated answer downstream.

---

## 8. How to extend it without breaking it

A practical recipe for the three most common changes.

### Add a new metric to an existing domain

1. Confirm the source column exists in the `summary_view` referenced by the
   domain config. If it doesn't, that's a materialised-view change first.
2. Append to `DOMAIN_CONFIG[domain]["metrics"]` with `name`, `label`, `unit`,
   `lower_is_better`.
3. If the metric needs a derivation (ratio, %), add the SQL to
   `domain_fetchers.py`. Do *not* compute it in Python after the fact.
4. Backfill the benchmark cache so `MetricStatus` works on day one.
5. Write a Langfuse smoke test that asks the LLM about the metric by its
   `label` and asserts it arrives in the response.

### Add a new breakdown

1. Append the breakdown name to `DOMAIN_CONFIG[domain]["breakdowns"]`.
2. Implement the SQL in the matching `breakdowns_<domain>.py` module — one
   function per breakdown.
3. Make sure it returns `DimensionBreakdown` Pydantic, with `total_count`
   and `has_more` populated honestly. The LLM uses those to decide whether
   to widen.
4. Add a test fixture for the breakdown and a snapshot of expected shape.

### Encode a new piece of human authority as a skill

1. New file under `backend/app/services/skills/` extending `BaseSkill`.
2. Declare its `SkillName` enum entry — that's how the manifest references
   it.
3. Inside `run()`, only consume primitives from the semantic layer
   (`HourlyData`, `DailyLaborAnalysis`, etc.). No raw SQL. No private
   queries. If you need a primitive that doesn't exist, add it to the
   semantic layer first and the skill second.
4. Return a `SkillResult` with `findings: List[Finding]`,
   `summary: str`, and any `recommendations`. Each finding carries its own
   `MetricStatus` so the rendering layer doesn't have to invent one.
5. Add the skill to the relevant `DOMAIN_CONFIG[domain]["suggested_skills"]`
   so the LLM sees it as an option when asked about that domain.

That's it. The LLM picks it up automatically.

---

## 9. Where this leaves the LLM

The semantic layer is the answer to the question, *"how do you let an LLM
compose analytics over an effectively infinite question space without
turning the database into a free-for-all?"*

Not by being clever about prompts. Not by giving it bigger context. Not by
letting it write SQL.

By giving it **a small, dense, typed vocabulary** built from two
authorities:

- the database, where the rows are;
- the humans, where the meaning is.

When the LLM is asked something nobody anticipated, it answers by
*recombining* primitives that we already trust. That's the entire trick.
Every other property — token cost, latency, auditability, tenant safety —
falls out of building the vocabulary right.

If you maintain that vocabulary with discipline, the LLM will keep
surprising you with answers that *we did not pre-compute and could not have
documented* — and they'll be right.

That is the job.
