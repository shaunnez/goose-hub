# Platform Compiler Cutover Phase B — Revised Engineering Plan (v3)

## Context

The composable agent platform has 6 modules all implemented but NOT wired into the runtime. `ws_chat_v2.py` still uses hardcoded `if agent_type == "merchant_explorer":` branching. This plan addresses all findings from 4 Codex passes (028, 030, 031, 032) while staying true to the ADDING_AN_AGENT guide principle: **each agent owns its adapters; the platform stays generic.**

## Architecture Principle (from ADDING_AN_AGENT guide)

> Agents are declared via manifests — the manifest system is the single source of truth. No hardcoded if/elif chains. Adding a new agent means creating a manifest file and registering it.

This means:
- **NO shared bridge/adapter modules** (e.g., `prompt_bridges.py`) — each agent owns its own adapter functions in its own directory
- **NO agent-type checks in platform code** — the compiler, strategy, and prompt loader are 100% generic
- **Tool selectors filter from compiler-authorized tools** — never reload from legacy module helpers
- **The platform calls what the manifest declares** — function module + function name, resolved dynamically

---

## 7 Gaps + 7 Codex-030 Findings Addressed

### From Codex-028 (7 gaps):
| # | Gap | Addressed In |
|---|-----|-------------|
| G1 | PlannerReactStrategy has no planner node | WP1 |
| G2 | No per-intent tool binding | WP1, WP4 |
| G3 | Missing replan, stuck detection, message filtering | WP1 |
| G4 | Prompt loader is SYNC, can't handle async/non-str | WP2 |
| G5 | No split prompt caching for Anthropic | WP1, WP2 |
| G6 | No tool_context_factory in PlatformBuildResult | WP3 |
| G7 | Initial state builder missing agent-specific fields | WP3 |

### From Codex-030 (7 findings):
| # | Finding | Fix |
|---|---------|-----|
| F1 | Admin prompt drops dynamic context (tier/session/workspace) | WP4: Admin gets `get_system_prompt_from_context()` in its own `prompts.py`. Manifest sets `langfuse_key=None` so agent adapter is PRIMARY (not bypassed by Langfuse). Both legacy prompt functions already fetch Langfuse internally. |
| F2 | Dashboard prompt adapter can't satisfy 13-param `assemble_agent_prompt()` | WP4: Dashboard adapter calls legacy `load_agent_context()` to get REAL model objects (CommunicationStyleSettings, BusinessPrioritiesSettings etc.), then passes to `assemble_agent_prompt()`. No snapshot model reconstruction needed. |
| F3 | Tool selector bypasses compiler filtering | WP1+WP4: Selectors receive `authorized_tools`, filter by name |
| F4 | Missing `investigation_scope` route for merchant_explorer | WP1: Strategy supports optional extra routes via `strategy_params` |
| F5 | `tool_context_factory` missing `validated_context` + `location_name_map` | WP3+WP4: Add to `DashboardExecutionContext`, factory propagates them |
| F6 | Prompt references from PromptAssemblyResult lost during unwrap | WP2: Unwrapper propagates `.prompt_references` to PromptLoadResult |
| F7 | Cache invalidation needs explicit contract | WP5: Cache key includes context-affecting extras hash |

### From Codex-034 (3 findings + 2 residuals on v3 — wiring details):
| # | Finding | Fix |
|---|---------|-----|
| F17 | Admin planner needs `get_admin_planner_prompt().compiled_text` as SystemMessage — strategy doesn't carry planner prompts | Add `planner_prompt_module`/`planner_prompt_function` to PlannerConfig. Admin manifest declares `get_admin_planner_prompt`. Compiler resolves and packs into strategy_params. Strategy injects as SystemMessage before user message in structured output call. |
| F18 | WP5 RuntimeExtra references `loaded_context.location_name_map` but WP5 removes legacy context loading | Dashboard execution loader (`load_dashboard_execution`) must load `location_name_map` from DB via `_load_all_location_data()` — it runs inside `compile_and_run()`, not WS handler. WS handler doesn't need to pass it via RuntimeExtra. |
| F19 | `AdminExecutionContext.create_tool_context()` omits `user_id`; `register_parent_ws` needs platform hook | Add `user_id` field to `AdminExecutionContext` + pass to `AdminToolContext`. `register_parent_ws` stays in WS handler (it's a WS-layer concern, not platform). |
| Res1 | Admin adapter sets `session_id=None` — should use `exec_ctx.session_id` | Builder fix: use `loaded_context.execution.session_id` in admin adapter. |
| Res2 | `_unwrap_prompt_result()` drops `PromptFetchResult.prompt_reference` | Builder fix: check for `.prompt_reference` attr in unwrapper, convert to `PromptReference`. |

### From Codex-033 (3 findings on v3 — convergence):
| # | Finding | Fix |
|---|---------|-----|
| F14 | WS route-level auth still hardcoded (`_AGENT_TYPE_AUTH_MODE` at ws_chat_v2.py:73, `Literal` type at :1251) — new agents still need ws_chat_v2 edits | WP5: Replace `_AGENT_TYPE_AUTH_MODE` with `manifest.access.allowed_auth_modes` lookup via registry. Remove `Literal` type restriction on agent_type param — accept any string, validate against registry. |
| F15 | Extra route nodes (investigation_scope) invoke tools directly via `resolve_merchant_scope.ainvoke()`, bypassing compiler-authorized tool set | WP1: Extra route nodes are agent-owned graph logic (like greeting_node). They're not LLM tool calls — they're deterministic programmatic invocations. Document this distinction: extra routes are state-manipulation nodes, not tool-calling nodes. Gate 2 only applies to LLM tool binding. |
| F16 | `location_name_map` not wired — planner can't resolve named locations, breakdown labels show UUIDs | **CRITICAL PRE-EXISTING GAP — fixed in WP6.** `_load_all_location_data()` exists at `context_loaders.py:106` but is NEVER CALLED. WS handler never passes `location_name_map` to AgentToolContext. `get_location_name_map()` returns `{}`. Named-location resolution ("show me Macon"), location breakdown labels, and semantic tool name→ID matching ALL broken. WP6 wires this up properly through the platform. |

### From Codex-031 (6 findings on v2):
| # | Finding | Fix |
|---|---------|-----|
| F8 | Langfuse bypasses agent adapters — dynamic context lost when Langfuse healthy | Remove `langfuse_key` from admin/dashboard manifests. Agent adapters become PRIMARY. Both `assemble_agent_prompt()` (line 564) and `get_admin_static_prompt()` (line 288) already fetch Langfuse internally. |
| F9 | Dashboard adapter sketch constructs wrong field names for CommunicationStyleSettings/BusinessPrioritiesSettings | Adapter calls `load_agent_context()` (legacy, `context_loader.py:70+`) to get REAL model objects, then passes to `assemble_agent_prompt()`. No manual reconstruction from simplified snapshots. |
| F10 | Replan hardcodes "analysis" — not valid AdminQueryPlan intent (admin uses "clarification") | Add `replan_intent` to manifest `strategy_params`. Dashboard: `"analysis"` (graph.py:1281). Admin: `"clarification"` (graph.py:559). Strategy reads from params. |
| F11 | WP5 doesn't cover auth resolution, prewarm, legacy context loading | Expand WP5 to replace ALL agent-specific branching in ws_chat_v2.py (auth at line 73, prewarm at line 986, context loading at line 532). |
| F12 | tool_context_factory isinstance is platform-owned branching | Execution context models gain `create_tool_context()` method. Compiler calls `exec_ctx.create_tool_context()` — fully polymorphic, no isinstance. |
| F13 | location_name_map wiring incomplete — LoadedAgentContext doesn't have it | Dashboard execution loader loads it from DB via `_load_all_location_data()` (api/v1/context_loaders.py:100). OR passed via RuntimeExtra from WS handler. |

---

## WP1: PlannerReactStrategy Expansion

**Files:** `backend/app/agents/platform/graph_strategies.py`, `backend/app/agents/platform/manifest.py`

### 1a. Expand PlannerReactState (graph_strategies.py:60-69)

Add fields that legacy graph nodes read from state:
```python
class PlannerReactState(TypedDict, total=False):
    messages: Annotated[list, add_messages]
    session_id: str
    chat_session_id: str
    user_id: str
    iteration_count: int
    max_iterations: int
    error: Optional[str]
    query_plan: Optional[object]    # QueryPlan or AdminQueryPlan (was str)
    location_ids: list              # Planner reads for location scope resolution
    organization_id: Optional[str]  # Tools read via state
    report_emitted: bool            # Termination flag
    recalibration_id: Optional[str] # Dashboard-specific (ignored by admin)
    extras: Optional[object]        # Passthrough extras
```

**Grounded:** `DashboardAgentState` at `assistant/state.py:167-210`, `AdminAgentState` at `admin_assistant/state.py:126-155`. Only fields that graph NODES actually read are included. Fields only used by legacy tool tracking (`pending_tool_calls`, `completed_tool_results`, `dashboard_widgets`, `inline_charts`, etc.) are omitted — tools use ContextVars, not state fields.

### 1b. Add ToolSelectorConfig to PlannerConfig (manifest.py:181-202)

```python
class ToolSelectorConfig(BaseModel):
    """Declares a per-intent tool selector owned by the agent."""
    model_config = ConfigDict(extra="forbid")
    module: str = Field(..., min_length=1)
    function: str = Field(..., min_length=1)

class PlannerConfig(BaseModel):
    # ... existing fields (enabled, model_use_case, schema_module, schema_class) ...
    tool_selector: Optional[ToolSelectorConfig] = Field(
        default=None,
        description="Agent's tool selector function. Signature: (intent, plan, authorized_tools) -> list[BaseTool]"
    )
    classify_module: Optional[str] = Field(
        default=None,
        description="Module with classify function for complex planners (e.g., dashboard's planner_service)"
    )
    classify_function: Optional[str] = Field(
        default=None,
        description="Function name: (messages, planner_model) -> Optional[PlanModel]"
    )
    planner_prompt_module: Optional[str] = Field(
        default=None,
        description="Module containing planner prompt function (e.g., admin's get_admin_planner_prompt)"
    )
    planner_prompt_function: Optional[str] = Field(
        default=None,
        description="Function returning planner system prompt text (or PromptFetchResult with .compiled_text)"
    )
    extra_routes: list[ExtraRouteConfig] = Field(
        default_factory=list,
        description="Agent-specific routes from planner (e.g., investigation_scope)"
    )

class ExtraRouteConfig(BaseModel):
    """Declares an extra planner route (e.g., investigation_scope for admin)."""
    model_config = ConfigDict(extra="forbid")
    intent: str = Field(..., description="Intent value that triggers this route")
    node_module: str = Field(..., description="Module containing the node function")
    node_function: str = Field(..., description="Async node function name")
    target: str = Field(default="agent", description="Where to route after this node")
```

**Grounded:** Admin graph has `investigation_scope` route at `admin_assistant/graph.py:143-151` triggered by `plan.intent == "investigation"`, node at `admin_assistant/graph.py:188-238`, edges to "agent" at line 727.

### 1c. Rewrite PlannerReactStrategy.build() (graph_strategies.py:312-441)

New topology:
```
planner → route_from_plan → greeting_response → END
                          → [extra_routes...] → agent
                          → agent → should_continue → tools → agent
                                                    → replan → agent
                                                    → synthesize → END
                                                    → inject_stubs → END
                                                    → agent (ack-only)
                                                    → __end__
```

**Strategy reads from `config.strategy_params`** (packed by compiler in WP3):
- `planner_model: BaseChatModel` — pre-created by compiler from `PlannerConfig.model_use_case`
- `planner_schema_class: type` — resolved from `PlannerConfig.schema_module/schema_class`
- `classify_fn: Optional[Callable]` — resolved from `PlannerConfig.classify_module/function`
- `tool_selector_fn: Optional[Callable]` — resolved from `PlannerConfig.tool_selector`; signature: `(intent: str, plan: object, authorized_tools: list[BaseTool]) -> list[BaseTool]`
- `model_provider: str` — `"anthropic"`, `"openai"`, or `"xai"` (from `_get_effective_config().provider` at `core/models.py:483`)
- `split_prompt: Optional[object]` — `SplitPromptResult` from prompt assembly (if Anthropic)
- `extra_route_nodes: dict[str, Callable]` — resolved from `PlannerConfig.extra_routes`
- `replan_intent: str` — manifest-declared broadest intent for replan (dashboard: `"analysis"`, admin: `"clarification"`). From `strategy_params` in GraphStrategyConfig. Default: `"clarification"` (safe for any schema).
- `location_name_map: Optional[dict]` — `Dict[str, str]` mapping location_id → name for planner's `resolve_location_scope()`. Packed by compiler from `loaded_context.execution.location_name_map` (F16 fix). Loaded by `load_dashboard_execution()` via `_load_all_location_data()` (F18 fix — no WS handler dependency).
- `planner_prompt_fn: Optional[Callable]` — Returns planner system prompt text. Resolved from `PlannerConfig.planner_prompt_module/function`. Admin: `get_admin_planner_prompt()` at `admin_assistant/prompts.py:379`. Dashboard: uses `PLANNER_PROMPT` constant via `classify_fn` (F17 fix).

**8 nodes (all generic — no agent-type checks):**

1. **planner_node** — If `classify_fn` provided, call it (dashboard path: `classify_query_plan_from_messages` at `planner_service.py:395`). Otherwise, use `planner_model.with_structured_output(planner_schema_class)` (admin path: `admin_assistant/graph.py:121`). Handle pre-seeded `state["query_plan"]` (skip LLM if present, matching `assistant/graph.py:131-140`). Resolve location scope via `resolve_location_scope()` from `planner_service.py:468`.

2. **greeting_node** — Deterministic response by session hash. Source: `assistant/graph.py:217-258`.

3. **agent_node** — The big one:
   - **Per-intent tool binding:** If `tool_selector_fn` provided, call `tool_selector_fn(intent, plan, authorized_tools)` to get subset. The selector filters BY NAME from `authorized_tools` (compiler output) — never reloads from modules. For Anthropic: use `_build_cached_tools()` then `base_model.bind(tools=formatted)`. For OpenAI/xAI: `base_model.bind_tools(tools)`. Source: `assistant/graph.py:757-794`.
   - **Split prompt caching:** If `split_prompt` provided AND `model_provider == "anthropic"`, build multi-block SystemMessage with `cache_control`. Source: `assistant/graph.py:720-746`.
   - **Plan directives:** Call `_format_plan_directives(plan, prior_messages)` — but ONLY if plan has the expected fields (check with `hasattr`). This handles both QueryPlan and AdminQueryPlan generically. Source: `assistant/graph.py:307-383`.
   - **Message filtering:** Import and call `_filter_tool_message_for_llm()`, `_compact_tool_message()` from `assistant/graph.py:452,498`. Two-pass budget-aware re-filtering with `_TOKEN_SOFT_LIMIT=60000`, `_TOKEN_HARD_LIMIT=80000` from `assistant/graph.py:570-571`.
   - **Orphaned tool_call sanitization:** `_sanitize_orphaned_tool_calls()` from `assistant/graph.py:591`.
   - **120s timeout** on `ainvoke()`. Source: `assistant/graph.py:961-964`.

4. **tool_node** — `ParallelToolNode(tools, tool_registry, content_filter=_filter_tool_message_for_llm)`. Source: `assistant/graph.py:1577-1580`.

5. **should_continue** — Full 6-way routing. Per-turn iteration counting (not global, `assistant/graph.py:1078-1084`). Error-aware iteration grants (`assistant/graph.py:1091-1108`). Stuck loop detection via `_detect_stuck_loop()` (`assistant/graph.py:986-1026`). Ack-only detection (`assistant/graph.py:1190-1242`). Post-insight early exit (`assistant/graph.py:1111-1143`). Orphaned tool_call safety guards (`assistant/graph.py:1174-1188`).

6. **replan_node** — Upgrade intent to `replan_intent` from strategy_params (dashboard: `"analysis"` per graph.py:1281, admin: `"clarification"` per admin graph.py:559). Uses `planner_schema_class` to construct new plan generically. Strategy reads `config.strategy_params.replan_intent` — no hardcoded intent string.

7. **synthesis_node** — FAST model (created inside node via `create_langchain_model(ModelUseCase.FAST)`). Source: `assistant/graph.py:1317-1410`.

8. **inject_stubs_node** — `create_inject_stubs_node("planner_react")` from `framework/graph_safety.py`.

**Extra route nodes** — For each `ExtraRouteConfig` in manifest: resolve node function via `importlib`, add as graph node, add route from planner. Admin's `investigation_scope` node is at `admin_assistant/graph.py:188-238`.

**Import strategy for shared utilities:**
```python
from app.agents.assistant.graph import (
    _filter_tool_message_for_llm,    # line 452
    _compact_tool_message,           # line 498
    _detect_stuck_loop,              # line 986
    _has_text_content,               # line 1029
    _format_plan_directives,         # line 307
    _build_prior_artifacts_note,     # line 386
    _sanitize_orphaned_tool_calls,   # line 591
    _build_cached_tools,             # line 660
    _estimate_token_count,           # line 578
    _TOKEN_SOFT_LIMIT,               # line 570 = 60000
    _TOKEN_HARD_LIMIT,               # line 571 = 80000
)
```
**Verified:** All 12 imports confirmed working inside Docker container.

**Note on `_format_plan_directives`:** This function assumes `QueryPlan` fields (`output_format`, `reasoning_mode`, `scope_changed`, `location_scope`, `named_location`). `AdminQueryPlan` has different fields. The strategy uses `hasattr()` checks so it works generically with any plan schema. Fields that don't exist on the plan are simply skipped.

---

## WP2: Prompt Loader Async + Return Type Handling

**File:** `backend/app/agents/platform/prompt_loader.py`

### Changes to `_load_from_module()` (line 164):

1. **Rename to `_load_from_module_async()`** — make it `async def`
2. **Detect coroutine functions:** `if inspect.iscoroutinefunction(func): result = await func(...)` else `result = func(...)`
3. **Add `_unwrap_prompt_result()`:**
   ```python
   def _unwrap_prompt_result(result: object) -> tuple[str, Optional[object], list]:
       """Unwrap known prompt result types.
       Returns: (prompt_text, split_prompt, prompt_references)
       """
       if isinstance(result, str):
           return result, None, []
       # PromptFetchResult (admin_assistant/prompts.py:282 — has .compiled_text)
       if hasattr(result, "compiled_text"):
           return result.compiled_text, None, []
       # PromptAssemblyResult (assistant/prompts/system_prompt.py:34 — has .system_prompt, .split_prompt, .prompt_references)
       if hasattr(result, "system_prompt"):
           refs = getattr(result, "prompt_references", [])
           split = getattr(result, "split_prompt", None)
           return result.system_prompt, split, refs
       raise TypeError(f"Cannot unwrap prompt result of type {type(result).__name__}")
   ```

4. **Add `split_prompt` and `extra_references` to PromptLoadResult:**
   ```python
   class PromptLoadResult:
       __slots__ = ("prompt_text", "references", "split_prompt")
       def __init__(self, prompt_text, references, split_prompt=None):
           ...
   ```

5. **Propagate prompt references** (Codex-030 F6): When unwrapper returns prompt_references, convert `LangfusePromptReference` objects to platform `PromptReference` objects and add to `references` list.

**Grounded:**
- `PromptFetchResult.compiled_text` at `admin_assistant/prompts.py:286`
- `PromptAssemblyResult.system_prompt` at `assistant/prompts/system_prompt.py:42`
- `PromptAssemblyResult.split_prompt` at `assistant/prompts/system_prompt.py:43`
- `PromptAssemblyResult.prompt_references` at `assistant/prompts/system_prompt.py:46` — type `List[LangfusePromptReference]` with fields `name: str`, `version: int`, `prompt_object: Any` (from `framework/observability.py:169-181`)

---

## WP3: Compiler Packing + Tool Context Factory

**Files:** `backend/app/agents/platform/compiler.py`, `backend/app/agents/platform/manifest.py`

### 3a. Add `tool_context_factory` to PlatformBuildResult (manifest.py:494-527)

```python
class PlatformBuildResult(BaseModel):
    # ... existing fields ...
    tool_context_factory: Optional[Callable] = Field(
        default=None,
        description="Callable returning async context manager for tool ContextVars. Built from execution slot."
    )
```

### 3b. Compiler packs strategy_params (compiler.py — new Step 7b after line 179)

After creating the main model (Step 7), the compiler:

1. **Creates planner model** from `manifest.planner.model_use_case`:
   ```python
   planner_model = create_langchain_model(
       ModelUseCase(manifest.planner.model_use_case.lower()),
       invocation_key=f"{agent_type}_planner",
   )
   ```

2. **Resolves planner schema class** from `manifest.planner.schema_module/schema_class`:
   ```python
   mod = importlib.import_module(manifest.planner.schema_module)
   planner_schema_class = getattr(mod, manifest.planner.schema_class)
   ```

3. **Resolves classify function** (optional) from `manifest.planner.classify_module/function`

4. **Resolves tool selector** from `manifest.planner.tool_selector`:
   ```python
   sel_mod = importlib.import_module(manifest.planner.tool_selector.module)
   tool_selector_fn = getattr(sel_mod, manifest.planner.tool_selector.function)
   ```

5. **Detects model provider** from `_get_effective_config()`:
   ```python
   from app.core.models import _get_effective_config
   model_provider = _get_effective_config(use_case, invocation_key=manifest.invocation_key or None).provider
   ```
   **Grounded:** `_get_effective_config()` at `core/models.py:483` returns `ModelConfig` with `.provider` as plain string (`"anthropic"` confirmed in Docker).

6. **Resolves extra route nodes** from `manifest.planner.extra_routes`

7. **Extracts split_prompt** from prompt_result:
   ```python
   split_prompt = prompt_result.split_prompt  # None if not available
   ```

8. **Packs into strategy_params:**
   ```python
   config.strategy_params = StrategyParams(
       planner_model=planner_model,
       planner_schema_class=planner_schema_class,
       classify_fn=classify_fn,
       tool_selector_fn=tool_selector_fn,
       model_provider=model_provider,
       split_prompt=split_prompt,
       extra_route_nodes=extra_route_nodes,
   )
   ```

### 3c. Compiler builds tool_context_factory (new Step 10b after line 209)

**Polymorphic dispatch — execution context models own their factory method (F12 fix):**

Each execution context model implements `create_tool_context() -> AsyncContextManager`. The compiler simply calls it — no isinstance, no agent-type checks. New agents implement this method on their own execution context model.

```python
# In compiler.py:
exec_ctx = loaded_context.execution
if exec_ctx and hasattr(exec_ctx, "create_tool_context"):
    tool_context_factory = exec_ctx.create_tool_context
else:
    tool_context_factory = None  # Agent has no tool context (e.g., stateless agent)
```

**DashboardExecutionContext.create_tool_context()** (in `context_loaders/dashboard.py`):
```python
def create_tool_context(self):
    from app.agents.assistant.context import AgentToolContext
    return AgentToolContext(
        analytics_db=self.analytics_db,
        app_db=self.app_db,
        location_ids=self.location_ids,
        user_id=self.user_id,
        organization_id=self.organization_id,
        chat_session_id=self.chat_session_id,
        merchant_id=self.merchant_id,
        progress_callback=self.progress_callback,
        validated_context=self.validated_context,
        location_name_map=self.location_name_map,
    )
```

**AdminExecutionContext.create_tool_context()** (in `context_loaders/admin.py`):
```python
def create_tool_context(self):
    from app.agents.admin_assistant.context import AdminToolContext
    return AdminToolContext(
        app_db=self.app_db,
        admin_id=self.admin_id,
        admin_email=self.admin_email,
        admin_tier=self.admin_tier,
        session_id=self.session_id,
        progress_callback=self.progress_callback,
    )
```

**Why this is better than isinstance:** Adding a new agent means implementing `create_tool_context()` on their execution context model. Zero platform compiler code changes. Fully aligned with ADDING_AN_AGENT guide.

**F5 fix:** Add `validated_context` and `location_name_map` to `DashboardExecutionContext` (WP4).

### 3d. Improve initial_state_builder (compiler.py:212-243)

Accept `extras: RuntimeExtra` and populate agent-specific fields:
```python
async def initial_state_builder(message, context, chat_session_id, extras=None):
    state = {
        "messages": [HumanMessage(content=message)],
        "session_id": chat_session_id,
        "chat_session_id": chat_session_id,
        "user_id": runtime.user_id,
        "iteration_count": 0,
        "max_iterations": manifest.graph_config.max_iterations,
        "error": None,
        "report_emitted": False,
        "query_plan": None,
        "location_ids": [],
        "organization_id": None,
    }
    if extras:
        for key in ("recalibration_id", "location_ids", "organization_id", "query_plan"):
            val = getattr(extras, key, None)
            if val is not None:
                state[key] = val
    return state
```

---

## WP4: Agent Adapters + Manifest Updates (each agent owns its adapters)

**Files (agent-owned — following ADDING_AN_AGENT principle):**
- `backend/app/agents/admin_assistant/prompts.py` — new `get_system_prompt_from_context()`
- `backend/app/agents/assistant/prompts/system_prompt.py` — new `get_system_prompt_from_context()`
- `backend/app/agents/assistant/tools/__init__.py` — new `select_tools_for_intent()`
- `backend/app/agents/admin_assistant/tools/__init__.py` — new `select_tools_for_admin_intent()`
- `backend/app/agents/platform/context_loaders/dashboard.py` — add `validated_context`, `location_name_map` to `DashboardExecutionContext`
- `backend/app/agents/platform/manifests/assistant.py` — update prompt + tool selector
- `backend/app/agents/platform/manifests/admin.py` — update prompt + tool selector + extra routes

### 4a. Admin prompt adapter (admin_assistant/prompts.py)

New function that takes `LoadedContext` and returns full dynamic prompt:
```python
async def get_system_prompt_from_context(loaded_context: "LoadedContext") -> str:
    """Platform-compatible prompt function.

    Takes LoadedContext, extracts admin identity + scope, builds
    AdminDynamicContext, returns full system prompt (static + dynamic).

    This function lives in the agent's own module — the platform calls
    it generically via the manifest's PromptConfig.fallback_function.
    """
    from app.agents.platform.context_loaders.admin import (
        AdminIdentityContext,
        AdminScopeContext,
    )
    identity = loaded_context.identity  # AdminIdentityContext
    scope = loaded_context.scope  # AdminScopeContext

    context = AdminDynamicContext(
        admin_email=identity.admin_email if identity else "",
        admin_tier=identity.admin_tier if identity else SuperAdminTier.SUPPORT,
        session_id=None,  # Set at runtime
        workspace_layout_name=scope.workspace_layout_name if scope else None,
        workspace_widgets=[
            WorkspaceWidgetInfo(widget_id=w.widget_id, title=w.title)
            for w in (scope.workspace_widgets if scope else [])
        ],
    )
    return get_full_system_prompt(context)
```

**Grounded:** `AdminDynamicContext` at `admin_assistant/prompts.py:404-412`. `get_full_system_prompt()` at line 530. `AdminIdentityContext` fields at `context_loaders/admin.py:41-63`. `AdminScopeContext` fields at `context_loaders/admin.py:75-91`.

### 4b. Dashboard prompt adapter (assistant/prompts/system_prompt.py) — F9 FIX

New function that takes `LoadedContext`, calls legacy `load_agent_context()` to get REAL model objects, then passes to `assemble_agent_prompt()`. **No manual model reconstruction from simplified snapshots** — this avoids the field name mismatch Codex-031 caught (CommunicationStyleSettings has `response_style_mode/sliders/quick_mode/personality_style/urgency_style`, NOT `verbosity/tone/explanation_depth`).

```python
async def get_system_prompt_from_context(loaded_context: "LoadedContext") -> "PromptAssemblyResult":
    """Platform-compatible prompt function.

    Delegates to legacy load_agent_context() for REAL model objects
    (CommunicationStyleSettings, BusinessPrioritiesSettings, etc.),
    then calls assemble_agent_prompt() with them.

    This avoids reconstructing models from simplified platform snapshots,
    which have different field names than the real Pydantic models.
    """
    from app.agents.platform.context_loaders.dashboard import DashboardExecutionContext

    exec_ctx = loaded_context.execution  # DashboardExecutionContext
    if not exec_ctx or not isinstance(exec_ctx, DashboardExecutionContext):
        # Fallback: minimal prompt
        return await assemble_agent_prompt(
            dashboard_state=DashboardState(widget_count=0, max_y=0),
        )

    # Use legacy context loader to get REAL model objects from DB
    from app.agents.assistant.context_loader import load_agent_context

    legacy_ctx = await load_agent_context(
        app_db=exec_ctx.app_db,
        analytics_db=exec_ctx.analytics_db,
        user_id=exec_ctx.user_id or "",
        organization_id=exec_ctx.organization_id or "",
        location_ids=exec_ctx.location_ids,
        page_type="dashboard",  # Could come from loaded_context.data.page_type
    )

    return await assemble_agent_prompt(
        dashboard_state=DashboardState(widget_count=0, max_y=0),
        merchant_context=legacy_ctx.merchant_context,
        profile_context=legacy_ctx.profile_context,
        persona_context=legacy_ctx.persona_context,
        memory_context=legacy_ctx.memory_context,
        operational_context=legacy_ctx.operational_context,
        insight_screen_context=legacy_ctx.insight_context,
        communication_style=legacy_ctx.communication_style,
        business_priorities=legacy_ctx.business_priorities,
        page_type=legacy_ctx.page_type,
    )
```

**Grounded:**
- `load_agent_context()` signature at `context_loader.py` — takes `(app_db, analytics_db, user_id, organization_id, location_ids, page_type)` → returns `LoadedAgentContext`
- `LoadedAgentContext` fields: `merchant_context: MerchantContextPrompt`, `profile_context: UserProfileContext`, `persona_context: PersonaContextPrompt`, `memory_context: MemoryContextPrompt`, `operational_context: OperationalContextPrompt`, `insight_context: InsightScreenContext`, `communication_style: CommunicationStyleSettings`, `business_priorities: BusinessPrioritiesSettings`, `page_type: str`
- `CommunicationStyleSettings` REAL fields: `response_style_mode`, `sliders`, `quick_mode`, `personality_style`, `urgency_style`, `last_updated` (at `personalization_preferences.py:152`)
- `BusinessPrioritiesSettings` REAL fields: `priority_domains`, `pain_points`, `goals`, `operational_context`, `last_updated` (at `personalization_preferences.py:353`)
- `assemble_agent_prompt()` at `assistant/prompts/system_prompt.py:481` already handles all Optional params correctly

**Trade-off:** This re-loads some context from DB that the platform loaders already loaded. Acceptable for cutover (~50ms overhead). Future optimization: update platform context loaders to return REAL model types instead of simplified snapshots.

### 4c. Tool selectors (agent-owned, receive authorized_tools)

**Dashboard** — new function in `assistant/tools/__init__.py`:
```python
def select_tools_for_intent(
    intent: str,
    plan: Optional[object],
    authorized_tools: list[BaseTool],
) -> list[BaseTool]:
    """Platform-compatible tool selector. Filters from compiler-authorized tools."""
    tool_index = {t.name: t for t in authorized_tools}
    names: set[str] = set(TIER_MAP.get(intent, TIER_MAP["data_query"]))

    # Additive: prediction tools when skill indicates forecasting
    if plan and hasattr(plan, "suggested_skill") and plan.suggested_skill in PREDICTION_SKILLS:
        names |= PREDICTION_TOOL_NAMES

    # Subtractive: exclude merchant-dependent tools when no merchant context
    from app.agents.assistant.context import get_merchant_id
    if not get_merchant_id():
        names.discard("search_local_area")
        names.discard("query_foundry")

    return sorted(
        [tool_index[n] for n in names if n in tool_index],
        key=lambda t: t.name,
    )
```

**Admin** — new function in `admin_assistant/tools/__init__.py`:
```python
def select_tools_for_admin_intent(
    intent: str,
    plan: Optional[object],
    authorized_tools: list[BaseTool],
) -> list[BaseTool]:
    """Platform-compatible tool selector. Filters from compiler-authorized tools."""
    tool_index = {t.name: t for t in authorized_tools}
    names: set[str] = set(ADMIN_TIER_MAP.get(intent, ADMIN_TIER_MAP.get("clarification", set())))
    return sorted(
        [tool_index[n] for n in names if n in tool_index],
        key=lambda t: t.name,
    )
```

**Grounded:** `TIER_MAP` at `assistant/tools/__init__.py` (used by `get_tools_for_intent` at line 368). `ADMIN_TIER_MAP` at `admin_assistant/tools/__init__.py` (used by `get_tools_for_admin_intent` at line 308). Both existing selectors confirmed to return references, not new instances (verified in Docker).

### 4d. Add `validated_context` + `location_name_map` to DashboardExecutionContext

**File:** `backend/app/agents/platform/context_loaders/dashboard.py:239-303`

Add two fields:
```python
class DashboardExecutionContext(BaseModel):
    # ... existing 10 fields ...
    validated_context: Optional[object] = Field(
        default=None,
        description="ValidatedContext for tenant-safe tool access (from tool_security.py:50)"
    )
    location_name_map: Optional[object] = Field(
        default=None,
        description="Dict[str, str] mapping location_id → location_name for planner scope resolution"
    )
```

Update `load_dashboard_execution()` (line 552) to populate from RuntimeContext.extra:
```python
validated_context = getattr(runtime.extra, "validated_context", None)
location_name_map = getattr(runtime.extra, "location_name_map", None)
```

**Grounded:** `AgentToolContext.__init__` accepts `validated_context` at `assistant/context.py:322` and `location_name_map` at line 323 (confirmed in exploration). `ValidatedContext` type at `assistant/tool_security.py:50-94`. Location name map creation at `api/v1/context_loaders.py:100-207`.

### 4e. Update manifests

**Assistant manifest** (`manifests/assistant.py`):
```python
prompt=PromptConfig(
    # langfuse_key REMOVED (F8 fix) — assemble_agent_prompt() at line 564 already fetches
    # from Langfuse internally. Setting langfuse_key here would bypass the agent adapter,
    # losing dynamic context (merchant, persona, memory, communication style).
    fallback_module="app.agents.assistant.prompts.system_prompt",
    fallback_function="get_system_prompt_from_context",  # NEW — takes LoadedContext, returns PromptAssemblyResult
),
planner=PlannerConfig(
    enabled=True,
    model_use_case="NANO",
    schema_module="app.agents.assistant.state",
    schema_class="QueryPlan",
    classify_module="app.agents.assistant.planner_service",  # NEW
    classify_function="classify_query_plan_from_messages",   # NEW
    tool_selector=ToolSelectorConfig(
        module="app.agents.assistant.tools",
        function="select_tools_for_intent",  # NEW — receives authorized_tools
    ),
),
graph_config=GraphStrategyConfig(
    max_iterations=6,
    synthesis_fallback=True,
    replan_on_stuck=True,  # CHANGED from False
),
```

**Admin manifest** (`manifests/admin.py`):
```python
prompt=PromptConfig(
    # langfuse_key REMOVED (F8 fix) — get_admin_static_prompt() at line 288 already
    # fetches from Langfuse via fetch_prompt_sync(). Setting langfuse_key would bypass
    # the agent adapter, losing dynamic context (tier, workspace, session).
    fallback_module="app.agents.admin_assistant.prompts",
    fallback_function="get_system_prompt_from_context",  # NEW — takes LoadedContext, returns str
),
planner=PlannerConfig(
    enabled=True,
    model_use_case="FAST",
    schema_module="app.agents.admin_assistant.state",
    schema_class="AdminQueryPlan",
    tool_selector=ToolSelectorConfig(
        module="app.agents.admin_assistant.tools",
        function="select_tools_for_admin_intent",  # NEW — receives authorized_tools
    ),
    extra_routes=[
        ExtraRouteConfig(
            intent="investigation",
            node_module="app.agents.admin_assistant.graph",
            node_function="investigation_scope_node",  # Line 188
            target="agent",
        ),
    ],
),
```

---

## WP5: ws_chat_v2.py Full Cutover (F11 — expanded scope)

**File:** `backend/app/api/v1/ws_chat_v2.py`

**Scope (F11+F14 fix):** Replace ALL agent-specific branching, not just lines 608-754:
- **Auth routing** (line 73): Replace `_AGENT_TYPE_AUTH_MODE` dict with registry lookup: `get_agent(agent_type).access.allowed_auth_modes`. Remove `Literal` type restriction on `agent_type` param (line 1251) — accept `str`, validate against `AGENT_REGISTRY`.
- **Context loading** (line 532): Platform context loaders replace legacy `load_agent_context()` call
- **Graph building** (lines 608-754): `compile_and_run()` replaces both paths
- **Prewarm** (line 986): Use `compile_and_run()` for prewarm too, not legacy graph builders
- **Result:** After WP5, adding a new agent requires ZERO edits to ws_chat_v2.py — just a manifest + registration.

### Feature flag
```python
import os
_USE_PLATFORM = os.getenv("USE_PLATFORM_COMPILER", "false").lower() == "true"
```

### Replace lines 608-754 with:
```python
if _USE_PLATFORM:
    from app.agents.platform.compiler import compile_and_run
    from app.agents.platform.registry import get_agent
    from app.agents.platform.manifest import UserSecurityContext, RuntimeContext, RuntimeExtra

    manifest = get_agent(agent_type)
    user_ctx = UserSecurityContext(
        user_id=str(conn.user.id),
        auth_mode="super_admin" if validated_context and hasattr(validated_context, "tier") else "user",
        admin_tier=getattr(validated_context, "tier", None) if validated_context else None,
        roles=[], feature_flags=[], available_secrets=[], granted_scopes=[],
    )
    runtime = RuntimeContext(
        app_db=app_db, analytics_db=analytics_db,
        user_id=str(conn.user.id), chat_session_id=payload.chat_session_id,
        checkpointer=_checkpointer, progress_callback=None,
        extra=RuntimeExtra(
            location_ids=location_ids, organization_id=organization_id,
            admin_email=getattr(validated_context, "email", None),
            admin_tier=getattr(validated_context, "tier", None),
            workspace_layout_name=payload.extras.get("workspace_layout_name") if payload.extras else None,
            workspace_widgets=payload.extras.get("workspace_widgets") if payload.extras else None,
            page_type=payload.extras.get("page_type", "dashboard") if payload.extras else "dashboard",
            validated_context=validated_context,
            location_name_map=getattr(loaded_context, "location_name_map", None) if loaded_context else None,
            merchant_id=loaded_context.merchant_id if loaded_context else None,
        ),
    )

    build_result = await compile_and_run(manifest, user_ctx, runtime)
    compiled_graph = build_result.compiled_graph
    _prompt_result = build_result.prompt_references

    input_state = await build_result.initial_state_builder(
        message=payload.message, context=build_result.loaded_context,
        chat_session_id=payload.chat_session_id,
        extras=RuntimeExtra(
            recalibration_id=payload.recalibration_id,
            query_plan=_pre_plan,
            location_ids=location_ids,
            organization_id=organization_id,
        ),
    )

    _tool_ctx = build_result.tool_context_factory()
else:
    # Legacy path (unchanged) ...
```

### Cache invalidation (F7)
Cache key includes context-affecting extras:
```python
_platform_cache_key = hash((
    agent_type,
    frozenset(location_ids),
    organization_id or "",
    getattr(validated_context, "tier", "") if validated_context else "",
    payload.extras.get("workspace_layout_name", "") if payload.extras else "",
    payload.extras.get("page_type", "") if payload.extras else "",
))
```

---

## Execution Order

```
WP1 (strategy expansion) ──┐
                             ├── WP3 (compiler packing) ─── WP5 (cutover)
WP2 (prompt loader) ────────┤          │
                             │          │
WP6 (location name map) ────┘  WP4 (agent adapters + manifests) ──┘
```

WP1 + WP2 + WP6: independent, parallel (Wave 1).
WP3: depends on WP1 (strategy_params shape) + WP6 (location_name_map in execution context).
WP4: depends on WP2 (prompt loader async) + WP3 (ToolSelectorConfig in manifest).
WP5: depends on WP1-WP4 + WP6.
WP7: **Wave 0 (FIRST)** — guide updates are the baseline contract builders follow.

---

## WP6: ContextVar Wiring Fixes (4 Pre-Existing Gaps)

**Full audit of AgentToolContext + AdminToolContext found 4 broken ContextVars** — all have the same root cause: params exist on the context manager constructors but ws_chat_v2.py never passes them.

| ContextVar | Defined | Used By | Impact |
|---|---|---|---|
| `_location_name_map` | `context.py:85` | `semantic_tool.py:678,737`, `graph.py:176` | Named-location resolution fails, breakdown labels show UUIDs |
| `_session_id` | `context.py:68` | `dashboard_tool.py:423`, `form_tool.py:194` | Dashboard/form tools get None session |
| `_progress_callback` (dashboard) | `context.py:91` | Skills (labor_optimization, void_investigation, etc.) | Frontend never receives skill execution progress |
| `_progress_callback` (admin) | `admin_context.py:48` | Admin skills | Admin frontend doesn't receive skill progress |

**All 4 fixed by the platform path** — execution context models include ALL params, `create_tool_context()` passes them all.

### 6a. Location Name Map (Critical)

**Impact:** Named-location resolution ("show me just Macon"), multi-location breakdown labels, and semantic tool location matching are ALL broken because `_load_all_location_data()` (at `api/v1/context_loaders.py:106`) exists but is **never called**.

**Root cause:** `ws_chat_v2.py` creates `AgentToolContext` (line 737) without `location_name_map` param. The ContextVar defaults to `None` → `get_location_name_map()` returns `{}` → `resolve_location_scope("specific_named", named_location="Macon", location_name_map={})` silently fails.

**Affected components:**
- Planner named-location resolution (`planner_service.py:483` — condition fails on empty map)
- Multi-location breakdown labels (`semantic_layer_service.py:1981` — shows `"Location abc12345"` instead of names)
- Semantic tool location filter (`semantic_tool.py:678,737` — name→ID matching fails)

### Fix (platform-native)

The dashboard execution loader (`load_dashboard_execution` at `context_loaders/dashboard.py:552`) loads `location_name_map` from the DB and includes it in `DashboardExecutionContext`. Then `create_tool_context()` passes it to `AgentToolContext`.

**Step 1:** Add location name loading to `load_dashboard_execution()`:
```python
async def load_dashboard_execution(runtime: RuntimeContext) -> DashboardExecutionContext:
    # ... existing code ...

    # Load location names for all authorized locations (enables named-location
    # resolution in planner + display names in breakdown labels)
    location_name_map: dict[str, str] = {}
    if location_ids:
        try:
            from sqlalchemy import text as sa_text
            from app.core.database import get_app_db_session

            async with get_app_db_session() as session:
                placeholders = ",".join(f":loc_{i}" for i in range(len(location_ids)))
                params = {f"loc_{i}": lid for i, lid in enumerate(location_ids)}
                result = await session.execute(
                    sa_text(
                        f"SELECT location_id::text, location_name "
                        f"FROM app_state.organization_locations "
                        f"WHERE location_id::text IN ({placeholders}) "
                        f"AND deactivated_at IS NULL"
                    ),
                    params,
                )
                location_name_map = {
                    row["location_id"]: row["location_name"]
                    for row in result.mappings().all()
                }
        except Exception as exc:
            logger.warning("Location name loading failed: %s", exc)

    return DashboardExecutionContext(
        # ... existing fields ...
        location_name_map=location_name_map,
    )
```

**Grounded:**
- Query pattern from `_load_all_location_data()` at `context_loaders.py:163-178` (same table, same columns)
- `app_state.organization_locations` table confirmed in DB (`location_id UUID, location_name TEXT, deactivated_at TIMESTAMP`)
- `get_app_db_session()` at `core/database.py` — existing async session factory

**Step 2:** `DashboardExecutionContext.create_tool_context()` already passes `location_name_map` (from WP3).

**Step 3:** `AgentToolContext.__aenter__` already sets the ContextVar at `context.py:352`.

**Result:** `get_location_name_map()` returns real names. Planner resolves "Macon" → UUID. Breakdown labels show real names. Semantic tool matches by name.

### 6b. Session ID (Medium)

`DashboardExecutionContext` already has `session_id` field (populated from `RuntimeContext.extra`). `create_tool_context()` already passes it. **Already fixed by WP3 design.** Just verify `session_id` is populated in RuntimeExtra by WS handler.

### 6c. Progress Callback — Dashboard (Medium)

`DashboardExecutionContext` already has `progress_callback` field (populated from `RuntimeContext.progress_callback`). `create_tool_context()` already passes it. **Fix:** WS handler must pass a real progress callback in RuntimeContext, not None.

The callback should emit WS progress events:
```python
async def _make_progress_callback(send_event):
    async def callback(tool_name: str, step: int, total: int, description: str):
        await send_event(StatusEvent(kind="progress", data={
            "tool": tool_name, "step": step, "total": total, "description": description,
        }))
    return callback
```

**Grounded:** `report_progress()` at `assistant/context.py:97-106` calls `get_progress_callback()()` — if callback is None, it's a no-op. Skills like `labor_optimization`, `void_investigation` call `report_progress()` for multi-step feedback.

### 6d. Progress Callback — Admin (Medium)

Same pattern as 6c. `AdminExecutionContext` already has `progress_callback` field. `create_tool_context()` passes it. WS handler must provide a real callback.

**Files modified:**
- `backend/app/agents/platform/context_loaders/dashboard.py` — add location name loading to execution loader + fields to model
- `backend/app/api/v1/ws_chat_v2.py` — pass progress callback in RuntimeContext (both platform and legacy paths benefit)

---

## WP7: ADDING_AN_AGENT Guide Update

**File:** `docs/agent/ADDING_AN_AGENT.md`

The guide needs updates for 5 areas that Phase B changes:

### 7a. Prompt Adapter Pattern (Step 5)
Current guide shows `get_system_prompt() -> str`. Add the platform-compatible pattern:
```python
# Simple agents (no dynamic context):
def get_system_prompt() -> str:
    return YOUR_STATIC_PROMPT

# Complex agents (need LoadedContext for personalization):
async def get_system_prompt_from_context(loaded_context: "LoadedContext") -> str:
    """Platform calls this with loaded context slots. Return prompt text."""
    identity = loaded_context.identity  # Your agent's identity model
    # Build dynamic prompt from context...
    return f"{STATIC_PROMPT}\n\n{dynamic_section}"
```

### 7b. Tool Selector Contract (Step 4)
Current guide shows 1-param `get_tools_for_intent(intent)`. Add platform-compatible 3-param version:
```python
# Platform-compatible: receives compiler-authorized tools, filters by name
def select_tools_for_intent(
    intent: str,
    plan: Optional[object],
    authorized_tools: list[BaseTool],
) -> list[BaseTool]:
    tool_index = {t.name: t for t in authorized_tools}
    names = INTENT_TOOL_MAP.get(intent, set())
    return sorted([tool_index[n] for n in names if n in tool_index], key=lambda t: t.name)
```

### 7c. Execution Context + create_tool_context() (Step 3)
Add section explaining that execution context models should implement `create_tool_context()`:
```python
class YourExecutionContext(BaseModel):
    app_db: object
    user_id: str
    # ... your agent's runtime deps

    def create_tool_context(self):
        return YourAgentToolContext(
            app_db=self.app_db,
            user_id=self.user_id,
        )
```

### 7d. Context Loaders (Step 3 expansion)
Add section on platform context loaders vs simple ContextVar pattern. Reference `context_loaders/dashboard.py` and `admin.py` as examples.

### 7e. Verification Checklist (NEW Step 10)
Add verification checklist:
1. Run `python3 scripts/verify_platform_contracts.py --agent your_agent_type`
2. `GET /api/v1/agents` → your agent appears
3. WS connect + send message → response streams
4. Check Langfuse traces
5. Named-location resolution works (if applicable)

**Files modified:**
- `docs/agent/ADDING_AN_AGENT.md`

---

## Concurrent Build+Verify Strategy (First-Try Success)

The goal is to catch wiring issues DURING building, not after. Each wave builds code AND runs verification concurrently.

### Wave 1: Foundation (WP1 + WP2 + WP6 + Verify-A) — Parallel

**Build WP1** (Opus): PlannerReactStrategy expansion in `graph_strategies.py` + new models in `manifest.py`
**Build WP2** (Sonnet): Prompt loader async in `prompt_loader.py`
**Build WP6** (Sonnet): Location name map wiring in `context_loaders/dashboard.py`
**Verify-A** (Sonnet): Write `scripts/verify_platform_contracts.py` — a standalone test script that:
```python
# 1. Import verification (all 12 utility functions from assistant/graph.py)
# 2. Model verification (create planner models for both use cases)
# 3. Schema verification (resolve both QueryPlan + AdminQueryPlan from module paths)
# 4. Tool selector verification (both select_tools_for_intent signatures)
# 5. Strategy build smoke test (build graph, check node count + edges)
```

**Gate:** WP1+WP2 AST parse clean. Verify-A script imports + resolves all contracts.

### Wave 2: Wiring (WP3 + WP4a + Verify-B) — After Wave 1

**Build WP3** (Opus): Compiler packing + tool_context_factory in `compiler.py`, `manifest.py`
**Build WP4a** (Sonnet): Agent-owned prompt adapters + tool selectors (admin + dashboard prompts, tools)
**Verify-B** (Sonnet): Extend verify script with:
```python
# 6. compile_and_run() smoke test for both manifests (mock DB sessions)
# 7. Prompt adapter verification (call get_system_prompt_from_context with mock LoadedContext)
# 8. Tool selector verification (call select_tools_for_intent with mock authorized_tools list)
# 9. create_tool_context() verification (both execution context types return correct ctx manager)
```

**Gate:** compile_and_run() succeeds for both manifests. Adapters return correct types.

### Wave 3: Integration (WP4b + WP5 + Verify-C) — After Wave 2

**Build WP4b** (Sonnet): Manifest updates (PlannerConfig fields, remove langfuse_key)
**Build WP5** (Opus): ws_chat_v2.py cutover behind feature flag
**Verify-C** (Sonnet): Full integration test:
```python
# 10. End-to-end: compile_and_run() → process_stream() with mock WS
# 11. Planner routing: greeting intent → greeting_node (no tool calls)
# 12. Admin investigation route: investigation intent → investigation_scope_node
# 13. Replan: verify replan_intent from strategy_params (analysis vs clarification)
# 14. Feature flag: USE_PLATFORM_COMPILER=false → legacy path works unchanged
```

**Gate:** Feature flag toggle works. Both paths produce valid graphs.

### Wave 4: Docker validation — After Wave 3

```bash
docker-compose restart api
# Run verify script inside container
docker exec skytab-intelligence-api python3 scripts/verify_platform_contracts.py
# If all green → ready for SHIP_REVIEW
```

### Verification Script Design

The `scripts/verify_platform_contracts.py` script accumulates checks across waves:
- Each check prints `[PASS]` or `[FAIL]` with details
- Exit code 0 only if ALL checks pass
- Can be run incrementally (`--wave 1`, `--wave 2`, etc.) or full (`--all`)
- Uses mock DB sessions (no Docker required for Wave 1-3 checks)
- Wave 4 checks require running container

## Verification

1. **AST check:** All modified Python files parse cleanly
2. **Import check:** `docker exec skytab-intelligence-api python3 -c "from app.agents.platform.compiler import compile_and_run"` → OK
3. **Compile both agents:** Test script calls `compile_and_run()` for both manifests
4. **Tool selector contract:** `select_tools_for_intent("data_query", None, authorized)` returns subset of authorized list
5. **Prompt adapter contract:** `get_system_prompt_from_context(loaded_context)` returns str (admin) / PromptAssemblyResult (dashboard) with prompt_references populated
6. **End-to-end:** Send messages to both agents via WS with `USE_PLATFORM_COMPILER=true`
7. **Greeting test:** "Hello" → fast path (no tool calls)
8. **Investigation route:** Admin "investigate merchant X" → investigation_scope_node fires
9. **Cache test:** Same message twice → cache hit on second

---

## Risk Register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | PlannerReactState missing a field tools read | HIGH | State includes ALL fields from both legacy states that graph nodes access. Tools use ContextVars, not state. |
| R2 | `_format_plan_directives` crashes on AdminQueryPlan | MEDIUM | Guard ALL field access with `hasattr()`. AdminQueryPlan lacks `output_format`, `reasoning_mode`, `scope_changed`, `location_scope`, `named_location`. Strategy skips directives when fields absent. |
| R3 | Tool selector returns empty (intent not in TIER_MAP) | MEDIUM | Fallback: if selector returns empty, use full authorized_tools list. |
| R4 | ~~`isinstance` check on execution context brittle~~ | ~~LOW~~ | **RESOLVED (F12):** Execution context models now have `create_tool_context()` method. Polymorphic dispatch, no isinstance. |
| R5 | Pre-planner timing regression | LOW | Pre-plan passed via extras.query_plan → planner node detects and skips LLM. |
| R6 | Cache invalidation too aggressive | MEDIUM | Hash only context-affecting fields. Test cache hit rate. |
| R7 | Dashboard prompt adapter double-loads context from DB | LOW | ~50ms overhead. Acceptable for cutover. Future: update platform loaders to return REAL model types. |
| R8 | `_build_cached_tools()` expects ModelProvider enum, not string | MEDIUM | Strategy wraps string in provider enum: `ModelProvider(model_provider)` before calling. Verify enum at `core/model_config.py`. |
| R9 | `resolve_location_scope()` typed for QueryPlan only | MEDIUM | Guard with `hasattr(plan, "location_scope")`. AdminQueryPlan lacks this field — skip resolution for admin. |
| R10 | `location_name_map` is a ContextVar, not state | **RESOLVED (WP6)** | Planner reads via `get_location_name_map()` ContextVar. WP6 wires `_load_all_location_data` equivalent into execution loader → `create_tool_context()` → ContextVar. Named-location resolution + breakdown labels restored. |
| R11 | `load_agent_context()` needs `analytics_db` — dashboard adapter must have it | LOW | **Self-audit finding:** `DashboardExecutionContext` already has `analytics_db` field. Adapter passes it correctly. Verified: `load_agent_context(app_db, analytics_db, ...)` sig confirmed in Docker. |

## Self-Audit Grounding Results (verified in Docker container)

All wiring claims verified against actual function signatures:
- `AdminToolContext.__init__`: accepts `user_id` ✅ (plan correctly adds it to `create_tool_context()`)
- `PromptFetchResult`: has `compiled_text`, `source`, `prompt_reference` ✅
- `classify_query_plan_from_messages`: accepts `planner_model` kwarg ✅
- `ParallelToolNode.__init__`: accepts `content_filter` ✅
- `load_agent_context`: needs BOTH `app_db` AND `analytics_db` ✅
- `_load_all_location_data`: **dead code** — defined at context_loaders.py:106, never called ✅
- `AdminExecutionContext`: missing `user_id` field (Codex-034 correct) ✅
- `_build_cached_tools`: takes `(list, Optional[ModelProvider])` — need `ModelProvider(string)` wrapper ✅
- `ModelProvider("anthropic")` → `ModelProvider.ANTHROPIC` ✅
- `TIER_MAP`: keys = `['clarification', 'data_query', 'analysis', 'prediction', 'widget_action']` ✅
- `ADMIN_TIER_MAP`: 17 intents including `'investigation'`, `'clarification'` ✅
- `investigation_scope_node`: standalone async function, importable, takes `AdminAgentState` → `dict` ✅
