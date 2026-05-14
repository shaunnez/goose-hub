# The Agent Scratchpad Pattern

> How to give a ReAct agent a working memory that lives *outside* the LLM context window — so tool results don't have to.

This is a companion to [`progressive-disclosure-and-query-progression.md`](./progressive-disclosure-and-query-progression.md). That doc covers *what* to bind to the loop. This doc covers *where bulk data goes when it can't live in the loop*.

---

## TL;DR

The naive ReAct flow is:

```
user_query → tool_call → 40KB JSON in message history → tool_call → 60KB more
            → tool_call → context full at iteration 4 → agent stalls or hallucinates
```

The scratchpad pattern replaces the middle step:

```
tool_call → if result > threshold:
              persist to side store under a hashed key
              return: small summary + store_key
            else:
              return inline
```

The agent's message history now carries a 200-character handoff (`"47 metrics, full data 38,420 chars at key xyz123"`) instead of the 40KB blob. If the agent genuinely needs the bulk back, it calls `retrieve_from_store(key=...)` — usually with slicing. In practice, retrieval rarely fires because the summary is engineered to answer the next question.

Three things make this pattern work, and skipping any of them breaks it:

1. **Threshold + auto-offload at the tool boundary.** Tools, not the agent, decide what to stash.
2. **Deterministic, collision-resistant keys.** Hash the tool args so identical follow-up calls hit the same row (free cache).
3. **A retrieval tool the agent already knows about.** And a graceful "namespace miss" message so the agent can self-correct instead of looping.

SkyTab Intelligence ships this as a process-wide `AsyncPostgresStore` shared by every agent. `query_semantic`, `query_orders`, `analyze_with_insight`, `render_inline_table`, `retrieve_insight_by_id` all auto-offload above 10K characters.

---

## Why "just put it in messages" fails

Every ReAct turn appends to the message history. Whatever the tool returned at iteration 1 is still in context at iteration 6 — and at iteration 12 if the user keeps the conversation going. With even modest tools (a 30-row table is ~5KB serialized), a 4-tool turn fills 20% of a 200K-token window. By turn three the agent is paraphrasing earlier results because there isn't room to think.

LangGraph's `MessagesState`/`add_messages` reducer makes this worse, not better: it's append-only by design. A long-lived session accumulates indefinitely until you either summarize ruthlessly (lossy) or truncate (also lossy, and risks dropping the answer).

**A scratchpad is the principled escape valve.** Bulk data lives in a side store keyed by something stable. The message history carries a pointer, not the payload.

---

## The five primitives

### 1. A process-wide store, not a per-agent dict

You want a single store backing every agent in your app, with:

- **Connection pooling** (concurrent sessions, no socket churn).
- **TTL** (bounded growth — entries expire automatically).
- **Namespacing** (no cross-session bleed).
- **Async-safe singleton init** (one instance per process).

SkyTab uses LangGraph's `AsyncPostgresStore`:

```python
# backend/app/agents/framework/agent_store.py
async def get_agent_store(config=None) -> AsyncPostgresStore:
    global _store_instance
    if _store_instance is not None:
        return _store_instance
    async with _store_lock:
        if _store_instance is not None:
            return _store_instance

        pool = AsyncConnectionPool(
            conninfo=_derive_connection_string(),
            min_size=3, max_size=10,
            kwargs={"autocommit": True, "prepare_threshold": 0,
                    "row_factory": dict_row},
        )
        await pool.open()

        store = AsyncPostgresStore(
            conn=pool,
            ttl=TTLConfig(default_ttl=60*60,      # 60 min default
                          sweep_interval_minutes=5,
                          refresh_on_read=True),
        )
        await store.setup()                       # idempotent DDL
        await store.start_ttl_sweeper(sweep_interval_minutes=5)

        _store_instance = store
        return store
```

Three details worth copying carefully:

- **`refresh_on_read=True`** — touching a key extends its TTL. The user's active scratchpad survives a long conversation; abandoned ones expire.
- **The sweeper is a background task started once.** Without it, expired rows linger in Postgres and `aget` returns stale data.
- **The pool is built manually**, not via `async with`, so you control shutdown explicitly (`close_agent_store` in `lifespan`). Async context managers don't work cleanly across FastAPI lifespan boundaries.

If you don't have Postgres, the same shape works with `AsyncSqliteStore` (single-node dev), `RedisStore` (simple, but lose TTL granularity), or even an in-process `dict` (testing only — you lose persistence and cross-worker visibility).

### 2. Wire the store into graph compilation

LangGraph injects the store into tools via `InjectedStore`, but only if the graph was compiled with `store=`. This is one line, easy to miss, breaks silently if omitted (tools just get `store=None` and fall back to inline returns):

```python
# backend/app/agents/platform/compiler.py
from app.agents.framework.agent_store import get_agent_store

_store = await get_agent_store()
compile_kwargs["store"] = _store
compiled_graph = graph.compile(**compile_kwargs)
```

Tools then declare the store as an injected parameter and never pass it manually:

```python
from langgraph.prebuilt import InjectedStore
from typing import Annotated, Optional

@tool
async def query_semantic(
    domain: str,
    date_from: str,
    date_to: str,
    level: str = "summary",
    ...,
    store: Annotated[Optional[object], InjectedStore()] = None,
) -> dict:
    ...
```

The agent's function-calling schema never sees the `store` parameter — LangGraph strips injected params from the tool definition. The agent calls `query_semantic(domain=..., date_from=...)` and `store` is filled in by the ToolNode.

### 3. Threshold + auto-offload at the tool boundary

The tool decides. Not the agent, not a wrapper, not the prompt. This matters because the tool knows what its payload *means* — what summary to leave behind, what fields slice, how to key it.

```python
# backend/app/agents/framework/agent_store.py
async def store_if_large(
    store, session_id, tool_name, data,
    threshold: int = 10_000,
    key_args=None,
) -> StoreResult:
    serialized = json.dumps(data, default=str)
    original_size = len(serialized)

    # Small → return inline, no store call
    if original_size <= threshold:
        return StoreResult(result_text=serialized, was_stored=False, ...)

    # Large → persist + return summary
    namespace = ("session", session_id, tool_name)
    store_key = (generate_store_key(tool_name, key_args)
                 if key_args is not None
                 else f"{tool_name}_{session_id[:8]}")

    await store.aput(
        namespace=namespace, key=store_key,
        value={"data": serialized,
               "metadata": StoreEntryMetadata(...).model_dump()},
    )

    summary_text = _default_summary(tool_name, data, store_key, original_size)
    return StoreResult(result_text=summary_text, was_stored=True,
                       store_key=store_key, namespace=namespace)
```

Inside each tool that can return bulk, the pattern is:

```python
# backend/app/agents/assistant/tools/order_tool.py — actual call site
if store is not None and len(orders) > 5:
    session_id = get_chat_session_id() or "default"
    store_result = await store_if_large(
        store, session_id, "query_orders", result_data,
        key_args={"order_number": order_number, "table_number": table_number,
                  "server_name": server_name, "date_from": date_from,
                  "date_to": date_to},
    )
    if store_result.was_stored:
        return ToolResult.ok(data={
            "stored": True,
            "store_key": store_result.store_key,
            "count": len(orders),
            "summary": store_result.result_text,
            "display_text": display,
        }).dump()
```

Notice:
- **The `key_args` are the tool's input args**, sorted-JSON-hashed. Identical follow-up calls return the same key — a free cache.
- **The tool threshold can be domain-specific** (`> 5 orders` in this case, not `> 10K chars`). `store_if_large` accepts a `threshold` override; for some tools (counts, IDs) a record-count threshold is more honest than byte size.
- **Failures fall through to truncated inline data**, not exceptions. The store is best-effort — a Postgres hiccup must not break the agent loop.

### 4. Collision-resistant keys

A naive `f"{tool_name}_{session_id}"` key gets overwritten on every call. The MD5-of-args pattern fixes this:

```python
def generate_store_key(tool_name: str, args_for_hash: object) -> str:
    args_str = json.dumps(args_for_hash, sort_keys=True, default=str)
    args_hash = hashlib.md5(args_str.encode()).hexdigest()[:12]
    return f"{tool_name}_{args_hash}"
```

`sort_keys=True` is load-bearing: it ensures `{"a": 1, "b": 2}` and `{"b": 2, "a": 1}` hash to the same value. Without it, you get duplicate rows for semantically identical calls.

12 hex chars = 48 bits of hash space. Plenty for per-session uniqueness; cryptographic strength is not needed. (If you're paranoid, take 16.)

The key is also stable across **agent turns within the same session**. If the user follows up "show me more of those orders," the agent calls `query_orders` with the same args, hits the same key, and the existing row's TTL refreshes (because `refresh_on_read=True`).

### 5. Namespacing that prevents bleed and enables discovery

The namespace tuple is the directory structure of the store. SkyTab's conventions:

```
("session", session_id)              -- session-scoped (default)
("session", session_id, tool_name)   -- per-tool within session (recommended)
("agent", agent_type)                -- agent-wide cross-session
```

Per-tool sub-namespacing matters for two reasons:

- **Discovery on miss.** When the agent calls `retrieve_from_store("xyz123")` and the key isn't found, the retrieval tool can list all namespaces under `("session", session_id, *)` and return them in the error message. The agent self-corrects on the next iteration.
- **Selective cleanup.** You can purge a single tool's scratchpads (e.g., after a schema change) without touching others.

### 6. The retrieval tool

This is what the agent calls when the summary isn't enough. It does three things the agent could not do unaided:

```python
@tool
async def retrieve_from_store(
    key: str,
    session_id: str,
    store: Annotated[AsyncPostgresStore, InjectedStore()],
    tool_name: str = "",
    slice_start: int = 0,
    slice_end: int = -1,
) -> str:
```

- **Cross-namespace lookup.** If the agent forgets which tool produced the key, leave `tool_name` blank and the tool searches all sub-namespaces under the session.
- **Auto-list on miss.** Returns `available_namespaces` so the next iteration can target correctly.
- **Slicing.** For list-shaped data (`records`, `orders`, `findings`, `breakdowns`, ...), the tool slices server-side and returns only the requested range. Critical — the whole point is keeping bulk *out of* context.

The sliceable-field list is a known set of common fields:

```python
_SLICEABLE_FIELDS = ("records", "cancellations", "orders", "tasks",
                     "cases", "equipment", "fees", "data", "segments",
                     "items", "rows", "breakdowns", "findings", ...)
```

When the parsed data is a dict containing any of these as a list, slicing acts on that field. Otherwise the tool returns the entire payload (and the agent paid the cost — which is occasionally what you want, e.g., for a small structured result).

The return is a typed Pydantic model serialized to JSON, with `success: bool` so error handling in the agent prompt is mechanical:

```python
class StoreRetrieveResult(BaseModel):
    success: bool
    key: str
    record_count: int = 0
    slice_start: int = 0
    slice_end: Optional[int] = None
    data: Optional[str] = None
    available_namespaces: list[str] = []
    error_message: Optional[str] = None
```

---

## Anatomy of a stored result

When the agent calls `query_semantic(domain="product", date_from="2025-10-01", date_to="2025-10-31", level="raw")`, this happens:

1. The tool runs the query → 47KB JSON with 1,200 order_items rows.
2. `store_if_large` sees `47000 > 10000` → persists.
3. `key_args = {"domain": "product", "level": "raw", "date_from": "2025-10-01", "date_to": "2025-10-31", "breakdown_by": null, "run_script": null}` → key = `query_semantic_a3f9c2d10b7e`.
4. Namespace = `("session", "chat_abc123", "query_semantic")`.
5. Postgres row created with TTL 60min, refreshed-on-read.
6. The agent sees, in its message history:

   ```json
   {
     "ok": true,
     "data": {
       "stored": true,
       "store_key": "query_semantic_a3f9c2d10b7e",
       "summary": "[query_semantic] 1200 records | Query returned 1200 records from product domain. | [Full data (47,193 chars) stored in agent store key: query_semantic_a3f9c2d10b7e. Use retrieve_from_store to access details.]",
       "display_text": "Query returned 1200 records from product domain."
     }
   }
   ```

7. The agent reads the `summary` and decides whether to answer from it (almost always) or fetch a slice.

**Net cost in context:** ~280 characters instead of 47,000. **45x reduction.** Across a 6-turn conversation, this is the difference between staying inside a single API call's context and getting OOM'd.

---

## How to retrofit this onto an existing project

### Stage 1: Stand up a session-scoped store

Pick the backend that matches your deployment:

- **Postgres in prod / single-node SQLite in dev:** `AsyncPostgresStore` / `AsyncSqliteStore` from `langgraph.store.*`. Drop-in compatible.
- **Redis:** Build a thin async wrapper exposing `aget` / `aput` / `alist_namespaces`. Implement TTL via `EXPIRE`.
- **Anything else:** dict in tests, anything async-safe in dev. The interface is small.

Wire it as a singleton, init it at app startup, close it on shutdown. Configure:
- Pool size (3-10 connections is plenty for most workloads).
- TTL (60 min is a reasonable default; some workloads want shorter to limit blast radius).
- TTL sweeper (start it once).

### Stage 2: Pass the store to `graph.compile`

```python
store = await get_agent_store()
compiled_graph = graph.compile(checkpointer=cp, store=store)
```

If you skip this line, **every `InjectedStore` parameter will be `None`** and your scratchpad code will silently fall back to inline returns. Add a log line confirming the store is attached, and check it on first invocation.

### Stage 3: Implement `store_if_large` and `generate_store_key`

Two functions. Together they're ~50 lines. The public surface:

```python
StoreResult = (result_text, store_key, was_stored, original_size_bytes, namespace)

async def store_if_large(store, session_id, tool_name, data,
                        threshold: int = 10_000,
                        key_args: object | None = None) -> StoreResult: ...

def generate_store_key(tool_name: str, args_for_hash: object) -> str: ...
```

Build `_default_summary` carefully — it's what the agent will read 95% of the time. Include:
- The tool name in brackets so the agent knows which tool produced it.
- Whatever `summary` / `display_text` / `record_count` the data already contains.
- The store key.
- A literal instruction (`"Use retrieve_from_store to access details."`).

### Stage 4: Add the retrieve tool, register it, and prompt-document it

```python
@tool
async def retrieve_from_store(
    key: str,
    session_id: str,
    store: Annotated[AsyncPostgresStore, InjectedStore()],
    tool_name: str = "",
    slice_start: int = 0,
    slice_end: int = -1,
) -> str: ...
```

Register it in your tool catalog (and any tier-map intent that might need bulk back — usually `analysis`, `investigation`, `data_query`).

**The agent must know retrieve_from_store exists and when to use it.** The summary text says so, but reinforce in the system prompt: *"When a tool returns a `store_key`, you may call `retrieve_from_store(key=...)` to fetch the full payload. Prefer slicing with `slice_start` / `slice_end` rather than retrieving everything."*

### Stage 5: Convert tools one at a time

For each tool that returns >10KB in normal use:

1. Add `store: Annotated[Optional[object], InjectedStore()] = None` to its signature.
2. After computing the result, branch on size:

   ```python
   if store is not None and _result_is_large(result):
       store_result = await store_if_large(
           store, session_id, "<tool_name>", result,
           key_args={... the tool's input args ...},
       )
       if store_result.was_stored:
           return ToolResult.ok(data={
               "stored": True,
               "store_key": store_result.store_key,
               "summary": store_result.result_text,
               "display_text": <one-line description>,
           }).dump()
   return ToolResult.ok(data=result, display_text=<one-line>).dump()
   ```

3. Make sure your "small" path still includes a `display_text` — consistent envelope shape simplifies the agent's job.

Measure per-tool:
- `was_stored` rate (target: high for bulk tools, ~0 for summary tools).
- Retrieval rate from those stored entries (target: <20%). If higher, your summary is too thin.

### Stage 6: Slicing-aware return shapes

For tools whose payloads are list-shaped, name the main list field something the retriever recognizes (or extend `_SLICEABLE_FIELDS`). The agent will then ask for slices instead of fetching all 1,200 rows.

Example: when `query_semantic` returns `{"breakdowns": [...], "metrics": [...]}`, breakdowns is in `_SLICEABLE_FIELDS`. The agent can call `retrieve_from_store(key=..., slice_start=0, slice_end=20)` and get the top 20 breakdowns without paying for all 200.

---

## Common pitfalls

- **Forgetting to pass `store=` to `graph.compile`.** `InjectedStore` gives `None` silently. Bulk results go back into messages. Symptom: context size climbs as before; "scratchpad" appears to do nothing. Fix: add a startup log line proving the store attached.

- **Generating keys from too few args.** If two semantically-different calls hash to the same key, the second call overwrites the first. Include *all* user-facing args in `key_args`, not just the "main" ones. Use `sort_keys=True` on the json dump.

- **No TTL or no sweeper.** Postgres rows grow without bound. Disk fills, latency creeps, eventually a 3 AM page. Set a TTL (60 min is sensible), start the sweeper at boot.

- **`refresh_on_read=False`.** The user's active scratchpad expires mid-conversation. They follow up, agent calls `retrieve_from_store`, miss, agent re-runs the heavy query. Annoying and silent. Turn refresh-on-read on.

- **Thin summary text.** If your `_default_summary` returns `"[stored, key=xyz]"` and nothing else, the agent has no choice but to call `retrieve_from_store` on every result. The summary should carry enough that the typical follow-up needs no fetch — record counts, headline metric, a one-line description. The summary *is* the data, as far as the agent's reasoning is concerned.

- **Stuffing everything in `("agent", agent_type)` namespace.** Now every user's data is visible to every other user's session. Use `("session", session_id)` as the base unless you genuinely want cross-session cache (and even then, be deliberate).

- **No fallback on store failure.** If `aput` raises, the tool should not raise. Return truncated inline data instead. Wrap the put in try/except, log a warning, and degrade gracefully. The agent loop must keep running.

- **Forgetting to deserialize `value["data"]`.** The store stores a wrapper dict (`{"data": serialized, "metadata": ...}`). Retrieval has to unwrap. `retrieve_from_store` in SkyTab handles this; if you write your own retrieval, mirror it.

- **No sliceable-field hints.** The retrieval tool falls back to returning the full payload, defeating the whole point. Either extend the sliceable list or have your tool wrap list payloads in a known field.

- **Treating the scratchpad as durable application state.** It's not a database. TTL applies. If the user comes back next week and asks "show me what we looked at," the data is gone. Persist outcomes (insights, decisions, saved reports) to your real DB; only let the scratchpad hold tool-result *intermediates*.

---

## What this is NOT

- **Not the checkpointer.** Checkpointers (`AsyncPostgresSaver` etc.) persist agent state for resumability. The scratchpad persists *tool data*. They share a database but are orthogonal concerns. You want both.

- **Not a vector store.** SkyTab's store supports optional pgvector indexing for semantic recall, but the default scratchpad path is exact-key lookup. Don't conflate.

- **Not a cache.** Caches return the same answer for the same query. The scratchpad happens to do that because of the hashed keys, but its purpose is *capacity*, not *speed*. Don't lean on it for cache semantics — TTL is short and entries are session-scoped.

- **Not a replacement for progressive disclosure.** Scratchpad keeps bulk *out* of context once requested. Progressive disclosure prevents the bulk from ever being requested in the first place. Use both.

---

## File map

For reference, the SkyTab implementation:

| Concern | File |
|---------|------|
| Store singleton + lifecycle | `backend/app/agents/framework/agent_store.py` (`get_agent_store`, `close_agent_store`) |
| `StoreConfig`, `StoreResult`, `StoreRetrieveResult`, `StoreEntryMetadata` | same file |
| Key generation | `generate_store_key` in same file |
| `store_if_large` | same file |
| `retrieve_from_store` tool | same file |
| Graph wiring | `backend/app/agents/platform/compiler.py` (`compile_kwargs["store"] = _store`) |
| Example consumer — bulk data tool | `backend/app/agents/assistant/tools/semantic_tool.py` (search `store_if_large`) |
| Example consumer — bounded-count tool | `backend/app/agents/assistant/tools/order_tool.py` |
| Example consumer — visualization tool | `backend/app/agents/assistant/tools/table_tool.py` |
| Example consumer — insight tool | `backend/app/agents/assistant/tools/insight_tool.py` |

---

## Closing principle

A ReAct loop's working memory should not be its message history.

Message history is for **reasoning state** — what's been asked, what's been concluded, what to do next. Tool payloads are **data**, and data belongs in a store. The scratchpad gives the agent the affordance of a desk with files on it, instead of forcing it to remember every fact it's ever seen.

Get the desk right, and the agent stops drowning in its own notes.
