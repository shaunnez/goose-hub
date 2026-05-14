# Progressive Disclosure & Query Progression in ReAct Loops

> A practitioner's guide to keeping token budgets bounded in complex ReAct agents — *without* raising the loop limit, fattening the context, or running 20 passes hoping the model converges.

---

## TL;DR

If your ReAct agent regularly burns 15–20 iterations, fills the context with raw query results, and *still* punts to the user, the fix is almost never "bigger loop limit" or "smaller model." It's an architectural one:

1. **Classify before you act.** Run a cheap planner *before* the reasoning model sees the full toolset.
2. **Bind only the tools that match the classified intent.** Most tool-schema tokens are wasted.
3. **Start coarse, drill on demand.** Every data tool exposes `summary` / `detail` / `raw` and the prompt forces `summary` first.
4. **Offload bulk to a side store.** The agent gets a summary + retrieval key, not 40 KB of rows.
5. **Inject one disclosure message instead of re-querying.** A coverage warning is a fact to surface, not a problem to re-solve.

SkyTab Intelligence ships two production agents that demonstrate this — **Restaurant Advisor** (a ReAct loop with 32 tools, 9 semantic domains) and **Merchant Explorer** (admin investigation across 55+ tools). Both hold sub-6-iteration averages because every box above is wired in.

---

## Why "raise the loop limit" is the wrong move

The naive ReAct loop has one knob: `max_iterations` (or LangGraph's `recursion_limit`). When agents misbehave, the temptation is to crank it.

That treats the *symptom* (the model is still confused after 10 turns) instead of the *cause* (the model never had a reason to converge). The cause is almost always one of:

- **Tool soup.** 30+ tool schemas dumped into the system prompt. The model paraphrases tool descriptions rather than using them.
- **Greedy retrieval.** First tool call returns 4,000 rows; second tool call still returns 4,000 rows. Context is now 80% data, 20% reasoning room.
- **Re-querying for warnings.** "Only 14 of 30 days have data" comes back from the tool, and the model immediately tries a different date range hoping for better.
- **No commitment to a plan.** Each iteration replans from scratch because nothing pinned an intent.

Every one of those is solvable upstream of the loop.

---

## The five primitives

### 1. Planner-first classification (cheap model, structured output)

Before the main reasoning model sees a single tool, a **NANO-tier model** classifies the user's intent into a Pydantic schema.

In Restaurant Advisor, the planner produces a `QueryPlan`:

```python
# backend/app/agents/assistant/state.py
class QueryPlan(BaseModel):
    intent: Literal[
        "greeting",
        "data_query",
        "analysis",
        "widget_action",
        "clarification",
        "troubleshoot_device",
    ]
    suggested_domain: Optional[str]              # revenue, labor, guest, ...
    suggested_level: Literal["summary", "detail", "raw"] = "summary"
    should_use_skill: bool = False
    suggested_skill: Optional[str] = None
    reasoning_mode: Literal["fast", "thinking"] = "fast"
    scope_changed: bool = False
```

Merchant Explorer's planner outputs an `AdminQueryPlan` with intents like `trace_query`, `merchant_research`, `case_investigation`, `portfolio_analysis`, `investigation`.

The planner is wired as the **graph entry point** — not the agent. The LangGraph topology for Restaurant Advisor is:

```
planner -> agent <-> tools -> coverage_check -> agent -> __end__
```

(`backend/app/agents/platform/manifests/assistant.py`)

**Why a separate node?** Two reasons:
- The planner runs on a NANO/FAST model with `response_format=QueryPlan`. Cost is ~1/20th of the main reasoning model.
- The planner output is durable state. Every later node (tool selector, prompt builder, extractors) reads it instead of re-deriving from messages.

**What you DON'T do here:** ask the planner to write the answer, choose the SQL, or pick the date range. It classifies. That's it. Stay disciplined — the more you ask of the planner, the more you re-create the exact problem you're trying to escape.

### 2. Intent-gated tool binding (TIER_MAP)

The single highest-leverage move in the whole stack.

When you bind 32 tools to a Claude/GPT call, the tool *schemas* go into the system prompt and cost real tokens — often 6–10K just for descriptions and parameters. Multiply by 6 iterations and you've burned 50K tokens on tool catalogs the model never used.

Solution: **after the planner classifies intent, bind only the tier-appropriate tools.**

```python
# backend/app/agents/assistant/tools/__init__.py
CORE_TOOL_NAMES = {"query_semantic", "render_inline_chart",
                   "render_inline_table", "manage_dashboard"}
PREDICTION_TOOL_NAMES = {"forecast_demand", "forecast_labor", ...}
SUPPORT_TOOL_NAMES = {"search_shift4_kb", "query_foundry", "search_local_area"}

TIER_MAP = {
    # "greeting" intentionally absent — no tools bound, no schema tokens
    "clarification":  CORE_TOOL_NAMES | OPERATIONS_TOOL_NAMES | {
        "search_shift4_kb", "query_foundry",
    },
    "data_query":     CORE_TOOL_NAMES | OPERATIONS_TOOL_NAMES |
                      SUPPORT_TOOL_NAMES | WEB_SEARCH_TOOL_NAMES | {
        "suggest_next_steps", "query_orders",
        "find_locations_by_performance", "surface_insight",
    },
    "analysis":       CORE_TOOL_NAMES | PREDICTION_TOOL_NAMES |
                      ML_CONTEXT_TOOL_NAMES | OPERATIONS_TOOL_NAMES |
                      SUPPORT_TOOL_NAMES | WEB_SEARCH_TOOL_NAMES | {...},
    "prediction":     CORE_TOOL_NAMES | PREDICTION_TOOL_NAMES |
                      ML_CONTEXT_TOOL_NAMES | {...},
    "widget_action":  CORE_TOOL_NAMES | {"update_form", ...},
}
```

The comment in source is blunt:

> *"Selective tool binding reduces token overhead by ~70% per LLM call. Only the tier-appropriate tools are sent as schema to the LLM; the parallel tool node still has ALL tools available for execution."*

That last clause matters: filtering happens at **binding time** (what the model sees), not at **execution time** (what's wired up). If the planner is wrong and the model wants a tool not in the tier, you can still fall through.

**Subtractive filters live here too.** When there's no merchant in context, `search_local_area` and `query_foundry` are dropped — saving their schema tokens *and* removing a class of hallucinated calls the model can't fulfil:

```python
from app.agents.assistant.context import get_merchant_id
if not get_merchant_id():
    names.discard("search_local_area")
    names.discard("query_foundry")
```

Merchant Explorer uses the exact same pattern with its own `ADMIN_TIER_MAP` (`backend/app/agents/admin_assistant/tools/tool_registry.py`) — 16 intents, each mapping to a tight subset of 55+ tools. `greeting` maps to the empty set; `clarification` is the only "everything" bucket; `investigation` is purposely a curated union, not a kitchen sink.

**Apply this to your project:** before you write your next ReAct loop, list every tool and ask "which intents *plausibly* call this?" If the answer is "all of them," your intents are too coarse — split.

### 3. Progressive disclosure levels (summary → detail → raw)

The planner picks a `suggested_level`. The data tool itself accepts that level and returns a payload sized to it.

```python
# backend/app/agents/assistant/tools/semantic_tool.py — docstring
"""
LEVELS (Progressive Disclosure):
- summary: KPIs with status (START HERE for any question)
- detail:  Breakdowns by dimension + trends
- raw:     Transaction-level data (order_items for product, orders for revenue)
"""

@tool
async def query_semantic(
    domain: str,
    date_from: str,
    date_to: str,
    level: str = "summary",     # ← defaults to summary
    breakdown_by: str | None = None,
    ...
) -> dict:
```

The prompt then *insists* on summary first. The tool's docstring — which becomes the model's instruction surface — opens with **"This is your PRIMARY tool for all data questions"** and labels summary as **"(START HERE for any question)"**. The model isn't asked to be clever; it's told the default.

**The principle isn't "let the model pick depth." It's "make summary cheap and obvious, and force a justification to go deeper."**

When the model *does* go deeper, it does so with a narrower scope — usually `breakdown_by="role"` or a specific `run_script`. That's the loop progressing instead of widening.

**Apply this to your project:** every tool that can return >1 row should accept a `level` param (or equivalent — `verbosity`, `depth`, `mode`). Default to the most compact view. Document the next step inline.

### 4. Side-store offload for bulk payloads

Even with `level=summary`, some payloads are large — skill results, ML forecasts, multi-breakdown queries. Stuffing them into the message history is how a 10-turn conversation balloons past 200K tokens.

Solution: an **agent store**. When a tool result exceeds a threshold, persist it to a session-scoped store and return only a summary + a `store_key`:

```python
# backend/app/agents/framework/agent_store.py
async def store_if_large(
    store, session_id, tool_name, data,
    threshold: int = 10_000,
    key_args=None,
) -> StoreResult:
    serialized = json.dumps(data, default=str)
    if len(serialized) <= threshold:
        return StoreResult(result_text=serialized, was_stored=False, ...)

    store_key = generate_store_key(tool_name, key_args)
    await store.aput(namespace=("session", session_id, tool_name),
                     key=store_key, value={...})
    summary_text = _default_summary(tool_name, data, store_key, original_size)
    return StoreResult(result_text=summary_text, was_stored=True,
                       store_key=store_key, ...)
```

In `query_semantic`, this kicks in when `level in ("detail", "raw")` or a skill ran:

```python
if store is not None and (level in ("detail", "raw") or result.get("skill_result")):
    store_result = await store_if_large(
        store, session_id, "query_semantic", result,
        key_args={"domain": domain, "level": level, ...},
    )
    if store_result.was_stored:
        return ToolResult.ok(data={
            "stored": True,
            "store_key": store_result.store_key,
            "summary": store_result.result_text,
            "display_text": _display,
        }).dump()
```

The agent sees: `[query_semantic] Query returned 47 metrics from revenue domain | 47 records | [Full data (38,420 chars) stored in agent store key: query_semantic_a1b2c3d4. Use retrieve_from_store to access details.]`

A second `retrieve_from_store` tool exists for the rare case the model genuinely needs the bulk back. In practice it almost never does — the headline numbers were always what mattered.

**Apply this to your project:** any tool that can return >10KB serialized should offload by default. The threshold is per-tool; tune it. Make sure the *summary* you return is good enough to answer the typical follow-up without a fetch.

### 5. Coverage extractor (inject, don't re-query)

The single biggest source of "20-pass" loops is the model re-running queries to chase warnings.

> Tool returns: `coverage_warning: "Only 14 of 30 days have data."`
> Naive model: "Hmm, let me try a different range." → calls the tool again with new dates → same warning → tries again → ...

The fix: a deterministic **extractor node** after the tools node that scans the latest `ToolMessage`, detects `coverage_warning` / `date_auto_adjusted_warning`, and injects a single instruction message back into the loop:

```python
# backend/app/agents/platform/composed/capability_bootstrap.py
async def _coverage_disclosure_extractor(state: dict) -> dict:
    for msg in reversed(state.get("messages", [])):
        if not isinstance(msg, ToolMessage):
            continue
        data = json.loads(msg.content)
        warning = (data.get("coverage_warning")
                   or data.get("date_auto_adjusted_warning")
                   or (data.get("data") or {}).get("coverage_warning"))
        if warning:
            disclosure = HumanMessage(
                content=(
                    f"[SYSTEM NOTICE — DATA COVERAGE]\n\n{warning}\n\n"
                    "You MUST acknowledge this data limitation in your response. "
                    "State the number of days of data and recommend querying "
                    "a period with full coverage."
                ),
                id="coverage-disclosure",   # ← deterministic ID
            )
            return {"messages": [disclosure]}
        break
    return {}
```

Two details to copy carefully:

- **The `id="coverage-disclosure"` is load-bearing.** LangGraph's `add_messages` reducer deduplicates by ID. Without it, every loop iteration would stack another disclosure, eventually filling the context with copies of the same warning.
- **Use `HumanMessage`, not `SystemMessage`.** Claude's API rejects multiple non-consecutive system messages; HumanMessage is the safe carrier for runtime injections.

The topology becomes `tools -> coverage_check -> agent`. The model gets exactly one nudge, surfaces it in its response, and the loop ends. Two iterations saved compared to the "model decides to re-query" path — usually three, since the model also re-queries to validate before answering.

**Apply this to your project:** any tool result with structured warnings should have a corresponding extractor. The pattern generalizes — rate-limit warnings, partial-result warnings, stale-data warnings.

---

## Putting it together — Restaurant Advisor's flow

User asks: "Why was last week's labor cost so high?"

| Step | What happens | Tokens spent |
|------|--------------|--------------|
| 1. Planner | NANO model returns `QueryPlan(intent="analysis", suggested_domain="labor", suggested_level="summary", reasoning_mode="thinking")` | ~400 |
| 2. Tool selector | `TIER_MAP["analysis"]` → ~14 tools (out of 32) bound to reasoning model | Save ~6K tokens vs. binding all 32 |
| 3. Agent (1st pass) | Calls `analyze_with_insight(domain="labor", date_range="last_7_days")` — one tool, one call | ~3K |
| 4. Tool | Runs `labor_optimization` skill, returns 38KB result → stored, returns 1KB summary + key | Save ~36K tokens |
| 5. Coverage extractor | Sees no coverage warning (full 7 days present) → no-op | 0 |
| 6. Agent (2nd pass) | Reads summary, writes answer with 4-tier insight artifact (UI handles disclosure of tiers 2-4) | ~2K |
| 7. `__end__` | | |

Total: 2 LLM iterations, ~6K tokens spent on reasoning. The same query through a naive 20-iteration ReAct with all tools bound at every turn would have been **~120K tokens** — most of it tool schemas and raw rows.

---

## Putting it together — Merchant Explorer's flow

User asks: "Investigate the at-risk accounts in the Atlanta region."

| Step | What happens |
|------|--------------|
| 1. Planner | FAST model returns `AdminQueryPlan(intent="investigation", reasoning_mode="thinking")` |
| 2. Investigation scope node | Extractor node — **runs only for `investigation` intent** — resolves enterprise MIDs and focus areas via deterministic SQL+ontology, *before* the agent gets the question. The agent inherits resolved scope as state instead of iterating to discover it. |
| 3. Tool selector | `ADMIN_TIER_MAP["investigation"]` → curated union (research, JIRA, investigation tools, ontology, KB, web search) — ~30 tools out of 55+ |
| 4. Agent loop | Uses the resolved MID list to call `query_foundry`, `search_jira`, `query_ontology` in parallel; bulk results offload to the store |
| 5. Coverage / extra-route | Investigation surfaces a `task_artifact` (a structured next-action list) — UI renders the four tiers; the loop ends |

Compared with restaurant advisor:

- **Different planner intents → different tool set, but the same tier-binding mechanism.**
- **Intent-specific extractor** (`investigation_scope_node`) lets you front-load expensive scope resolution exactly once, instead of letting the loop rediscover MIDs over five iterations.
- Both agents share the **same compiler**, the **same agent store**, and the **same general-purpose extractor pattern**. That's not a coincidence — once you accept these primitives, they compose cleanly across agents.

---

## How to retrofit this onto an existing project

A staged plan. Each stage is independently shippable and each one cuts tokens.

### Stage 1: Add the planner node (highest ROI)

1. Define a Pydantic schema for the intents in *your* domain. Start with 4–8 — too many is worse than too few.
2. Build a planner node that takes `messages`, returns the schema. Use a small model (`gpt-4o-mini`, `claude-haiku`, etc.) with structured output.
3. Wire it as the graph entry point. Pass the result into state.

Don't bind tools differently yet. Just measure: planner classification accuracy vs ground truth, planner cost vs the rest of the trace. You want >90% accuracy on your top 3 intents before stage 2.

### Stage 2: Build the tier map

1. List your tools. For each intent, decide which tools it *plausibly* needs. Keep `clarification` as the "everything" bucket. Keep `greeting` (or equivalent) as empty.
2. Implement `select_tools_for_intent(intent, plan, authorized_tools) -> list[BaseTool]` filtering by name only.
3. Pass the filtered list to your reasoning model's `bind_tools`. **Crucially: keep the full toolset wired to the executor** — you want execution to succeed even if the planner mis-classified.

Measure: token reduction per turn, end-to-end iteration count. Both should drop visibly.

### Stage 3: Add level/depth to data tools

1. For every tool that returns >100 rows, add a `level` (or `mode`, `verbosity`) parameter with three values: `summary`, `detail`, `raw`.
2. Default it to `summary`.
3. Update the tool docstring to **explicitly** say "START HERE" for summary, and document when to escalate.
4. Make sure your prompt tells the model to start at summary unless the user explicitly asks for deeper.

Measure: distribution of `level` values in production traces. If everything is `summary`, working. If `raw` dominates, your summary view isn't carrying its weight — improve it.

### Stage 4: Offload bulk

1. Add a session-scoped store (Postgres, Redis, even SQLite). LangGraph has `AsyncPostgresStore` out of the box.
2. Implement `store_if_large(store, session_id, tool_name, data, threshold=10_000)`. Use a hash of args as the key so identical follow-up queries hit the same row.
3. Have tools call it before returning. Return a small summary + key when stored.
4. Add a `retrieve_from_store` tool the model can call when it *really* needs the bulk back.

Measure: % of tool returns that were offloaded; % that were later retrieved. The retrieve rate should be low (<20%) — if it's high, your summaries are too thin.

### Stage 5: Add extractor nodes for warning handling

1. Identify the structured signals your tools emit that the model *should* surface but not chase (coverage warnings, deprecations, rate limits, "did you mean…" suggestions).
2. For each, write a deterministic post-tool node that injects a single instruction message with a deterministic ID.
3. Wire `tools -> extractor -> agent`. If you have multiple extractors, chain them (`tools -> coverage_check -> dedup_check -> agent`).

Measure: iterations per query before vs after. The biggest wins land here once Stage 1-4 are in place.

---

## Common pitfalls

- **"My planner sometimes gets it wrong, so I broadened every tier."** Don't. Broadening tiers destroys the savings. Instead: improve the planner (more examples, better schema descriptions, or a fallback to `clarification` when confidence is low).
- **"I made `level=detail` the default because the model kept asking follow-ups."** That's not progressive disclosure — that's eager retrieval. Force `summary` and make follow-ups cheap.
- **"My extractor injects on every iteration."** You forgot the deterministic `id`. LangGraph's `add_messages` reducer uses it to deduplicate.
- **"I bound tools at executor time instead of agent time."** Then the model still sees every schema. Bind at the model call, not at the graph.
- **"My store is global and never expires."** Scope by session and TTL. The whole point is bounded context.
- **"I added `level` to the tool but didn't update the docstring."** The docstring *is* the prompt. If you don't tell the model `START HERE`, it won't.
- **"The model still loops 15 times on edge cases."** Add a tighter `recursion_limit` (4–6 for simple agents, 8–10 for investigation-style) and make sure timeout messages route to a graceful fallback node, not to another planner pass.

---

## What this does NOT replace

- **A good system prompt.** Progressive disclosure is a scaffolding pattern, not a substitute for clear instructions about role, tone, and what to do when stuck.
- **Tool design.** If a tool returns an unbounded join, `level=summary` won't save you on the SQL side. Push aggregation into the data layer.
- **Observability.** You need traces to know which tier of the model is being used, which intents misclassify, which extractor fires. Langfuse / LangSmith / OpenTelemetry — pick one and instrument every node.

---

## File map (for reference)

If you're studying the SkyTab implementation:

| Concern | File |
|---------|------|
| Planner schemas | `backend/app/agents/assistant/state.py` (`QueryPlan`), `backend/app/agents/admin_assistant/state.py` (`AdminQueryPlan`) |
| Planner service | `backend/app/agents/assistant/planner_service.py` |
| Tier maps | `backend/app/agents/assistant/tools/__init__.py` (`TIER_MAP`), `backend/app/agents/admin_assistant/tools/tool_registry.py` (`ADMIN_TIER_MAP`) |
| Tool selector | `select_tools_for_intent()` in the above files |
| `query_semantic` | `backend/app/agents/assistant/tools/semantic_tool.py` |
| `analyze_with_insight` (4-tier artifact) | `backend/app/agents/assistant/tools/insight_tool.py` |
| Agent store | `backend/app/agents/framework/agent_store.py` |
| Coverage extractor | `backend/app/agents/platform/composed/capability_bootstrap.py` |
| Restaurant Advisor manifest | `backend/app/agents/platform/manifests/assistant.py` |
| Merchant Explorer manifest | `backend/app/agents/platform/manifests/admin.py` |
| Platform compiler | `backend/app/agents/platform/compiler.py` |

---

## Closing principle

The ReAct loop is a search algorithm. Every primitive in this document **reduces the search space the model has to traverse** — by classifying intent, by narrowing the toolset, by defaulting to compact views, by hiding bulk, by collapsing warnings into single messages.

If your agent needs 20 passes, the loop isn't the problem. The search space is too big. Shrink it.
