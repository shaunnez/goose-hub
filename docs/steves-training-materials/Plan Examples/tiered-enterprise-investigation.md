# Agentic Investigation Architecture -- Engineering Specification v2

*Foundation for the Shift4 Intelligence Platform: every investigation builds institutional memory.*

---

## 1. Objective

Replace the current pipeline-based investigation service (`service.py`: collect 14 sources in parallel, format everything, single LLM call) with a **LangGraph StateGraph ReAct agent** that:

1. **Reasons about what to investigate** -- decides which tools to call based on what it discovers, just like a human analyst would.
2. **Iterates** -- the agent sees the enterprise snapshot, identifies anomalies, deep-dives the worst MIDs, cross-references Jira, checks contact center patterns, and keeps going until it has enough evidence.
3. **Produces the same output** -- a `ReportArtifactPayload` that renders inline in the admin chat, identical to today's reports.
4. **Establishes the Specialized Agent Framework** -- a reusable base class, state schema, tool registration pattern, and ReAct loop that future agents (sales intelligence, compliance audit, performance optimization) inherit.
5. **Builds institutional memory** -- every investigation is registered, every finding is embedded, and the accumulated knowledge base makes every future investigation smarter.

### Why This Matters

The current pipeline collects everything regardless of relevance. For Compass Group (1,282 MIDs), this means 14 x 50-MID queries regardless of whether volume, cases, or equipment is the real story. The agentic approach:

- **Saves tokens**: only formats data the agent decides is relevant (est. 40-60% reduction).
- **Saves time**: skips irrelevant sources entirely (e.g., skip NICE if no contact center signal).
- **Produces better reports**: the agent can chase threads. "I see 3 cancellations -- let me pull the details. Now I see they all happened after a billing dispute case. Let me check Jira for related engineering tickets."
- **Scales**: the enterprise snapshot (pure Python on 127-field records) handles 1,282 MIDs in <100ms. Deep-dives are targeted.
- **Accumulates intelligence**: each investigation contributes findings, patterns, and evidence to a searchable knowledge base. "We've seen this pattern before at NANDOS -- volume collapse correlated with billing migration."

### Scale Targets

| Enterprise | MIDs | Monthly Volume | Pattern | Test Purpose |
|------------|------|----------------|---------|--------------|
| Starlink | 6 | $546M | Gateway/ISV, NOT in enterprise grouping | Small enterprise, MID discovery fallback |
| TAO GROUP | 87 | -- | Multi-city, mixed health, proven post-mortem | Medium enterprise, signal diversity |
| NANDOS | 47 | -- | Proven health check | Edge case, QBR positive framing |
| Compass Group | 1,282 | -- | Largest known enterprise | Stress test, distribution analysis |

---

## 2. Architecture

### 2.1 High-Level Flow

```
Admin agent detects investigation intent
  --> delegates to investigation sub-agent via generate_investigation_report tool
    --> InvestigationGraph.ainvoke(enterprise_name, investigation_type, mids, focus_areas, user_context)
      --> [start] agent_node: Opus reads system prompt + initial state
      --> [loop]  agent calls get_enterprise_snapshot()
                  >> WS v2 streams reasoning tokens + tool events to frontend <<
                  agent REASONS: "40% of MIDs declining >20%, 3 cancellations, 12 stalled orders"
                  agent calls deep_dive_mids(top_10_flagged, focus=["volume","cases"])
                  >> post_tool_extractor parses ToolMessages into state fields <<
                  agent REASONS: "Volume collapse started Jan -- correlates with case #00289396"
                  agent calls search_past_investigations("billing migration volume collapse")
                  agent REASONS: "Similar pattern at NANDOS 3 months ago -- billing root cause confirmed."
                  agent calls search_jira("billing migration TAO")
                  agent REASONS: "ENGATE-12345 blocked the migration. Root cause found."
                  agent calls emit_report(ReportArtifactPayload)
      --> [end]   returns ReportArtifactPayload to admin agent
      --> [persist] registry + evidence store + embeddings written
```

### 2.2 LangGraph StateGraph

```
                  +----> tool_node ----> post_tool_extractor ---+
                  |                                              |
start --> agent_node <------------- (loop) ---------------------+
                  |
                  +----> inject_stubs --> end
                  |
                  +----> end (report_emitted == True)
```

Nodes:
- **agent_node**: Calls the Opus model with tools bound. The model either calls a tool or produces a final message. Increments `iteration_count`. Reasoning tokens stream to frontend via WS v2.
- **tool_node**: Executes the tool(s) the agent requested. Returns `ToolMessage` results. Uses `ParallelToolNode` from the framework for concurrent execution of SAFE tools. Emits tool start/progress/complete WS events.
- **post_tool_extractor**: **(H3 fix)** Parses `ToolMessage` results back into typed state fields. Tools cannot mutate state directly via `ParallelToolNode`. This node reads the last batch of `ToolMessage` objects and updates `evidence_log`, `tools_called`, `mids_investigated`, `report_payload`, and `report_emitted`.
- **inject_stubs**: Safety node (from `graph_safety.py`). If max iterations reached, injects stub `ToolMessage` for any orphaned `tool_calls` to prevent checkpoint corruption.

Routing:
- **should_continue**: If `report_emitted` is True, route to `__end__`. If last message has `tool_calls` AND iteration < MAX, route to `tool_node`. If max iterations reached, inject forced synthesis message then route to `agent` for one final attempt. If at hard limit (max_iterations + 1), route to `inject_stubs`. Otherwise, `__end__`.

### 2.3 State Schema

```python
# backend/app/agents/investigation_agent/state.py

class InvestigationAgentState(TypedDict, total=False):
    """LangGraph state for the agentic investigation."""

    # === LangGraph standard ===
    messages: Annotated[list, add_messages]

    # === Input (set by caller, read-only during execution) ===
    enterprise_name: str
    investigation_type: str          # InvestigationType.value
    user_context: str                # Additional user instructions
    investigation_template: str      # Serialized InvestigationTemplate

    # === User scope (H1: user-specified scope takes precedence) ===
    mids: list[str]                  # User-specified MIDs to investigate (empty = agent decides)
    focus_areas: list[str]           # User-specified focus areas (empty = agent decides)

    # === Session context (from admin agent delegation) ===
    session_id: str
    chat_session_id: str
    user_id: str

    # === Execution control ===
    iteration_count: int             # Incremented each agent_node pass
    max_iterations: int              # Default 8, configurable

    # === Evidence accumulation (post_tool_extractor writes these) ===
    enterprise_snapshot: str         # JSON of EnterpriseDistribution + SignalAnalysis
    evidence_log: list[str]          # Tool results as formatted strings (append-only)
    tools_called: list[str]          # Tool names called so far
    mids_investigated: list[str]     # MIDs that received deep-dive

    # === Output ===
    report_payload: str              # Serialized ReportArtifactPayload JSON (set by emit_report)
    report_emitted: bool             # True when emit_report is called
    error: str                       # Error message if investigation fails

    # === Intelligence Platform ===
    investigation_id: str            # UUID, set at graph start, used for registry + evidence store
    past_investigation_context: str  # Summary from search_past_investigations (if relevant)
```

### 2.4 Tool Architecture

Twelve tools total: 9 investigation tools + 3 knowledge base tools.

**Investigation Tools (9):**

| # | Tool | Input | Output | Data Source | Timeout |
|---|------|-------|--------|-------------|---------|
| 1 | `get_enterprise_snapshot` | `enterprise_name: str` | `EnterpriseSnapshotResult` | MerchantEnterpriseGroupingDataset (127 fields) | 60s |
| 2 | `deep_dive_mids` | `mids: list[str], focus_areas: list[str]` | `DeepDiveResult` | Per-MID: volume, cases, equipment, NICE, fees, profiles, health, billing | 180s |
| 3 | `check_orders_and_installations` | `mids: list[str]` | `OrdersResult` | Merchant linked objects: orders, tasks | 120s |
| 4 | `search_cancellations` | `mids: list[str]` | `CancellationSearchResult` | Cancellation object | 60s |
| 5 | `check_unbatched_status` | `mids: list[str]` | `UnbatchedSearchResult` | DailyNewUnbatchedMerchantsList | 60s |
| 6 | `search_jira` | `query: str` | `JiraSearchResult` | Jira REST API (via existing service) | 30s |
| 7 | `check_contact_center` | `mids: list[str]` | `ContactCenterResult` | NICEInContactRecordsByMID | 120s |
| 8 | `query_foundry_object` | `object_type: str, filter_field: str, filter_value: str, max_records: int` | `FoundryQueryResult` | Any Foundry ontology object | 60s |
| 9 | `emit_report` | `title: str, executive_summary: str, sections: list, appendix: str` | `EmitReportResult` | None (produces output) | 10s |

**Knowledge Base Tools (3) -- available to investigation agent AND admin agent:**

| # | Tool | Input | Output | Data Source | Timeout |
|---|------|-------|--------|-------------|---------|
| 10 | `search_past_investigations` | `query: str, limit: int` | `PastInvestigationSearchResult` | pgvector similarity search on investigation_embeddings | 10s |
| 11 | `get_investigation_detail` | `investigation_id: str` | `InvestigationDetailResult` | investigation_registry + investigation_evidence tables | 10s |
| 12 | `find_similar_patterns` | `enterprise_name: str` | `SimilarPatternsResult` | investigation_registry + pgvector | 15s |

**Tool result pattern (M2)**: Every tool takes typed Pydantic params and returns a typed Pydantic model. The framework handles serialization (model -> JSON string for `ToolMessage.content`). No tool touches raw dicts.

```python
class ToolResultBase(BaseModel):
    """Base for all investigation tool results."""
    model_config = ConfigDict(extra="forbid")

    success: bool = True
    source: str = Field(..., description="Data source name for citation")
    record_count: int = Field(default=0, ge=0)
    duration_ms: int = Field(default=0, ge=0)
    summary: str = Field(default="", description="Concise summary for agent context")
    error_message: Optional[str] = None
```

### 2.5 Investigation-Specific Tool Registry (H4)

The investigation agent uses a dedicated `InvestigationToolRegistry` with correct `tool_registry=` constructor arg and timeout metadata per tool. This is separate from the admin tool registry.

```python
# backend/app/agents/investigation_agent/tool_registry.py

INVESTIGATION_TOOL_REGISTRY: dict[str, ToolMetadata] = {
    "get_enterprise_snapshot": ToolMetadata(
        name="get_enterprise_snapshot",
        timeout_seconds=60,
        safe_for_parallel=True,
        category="data_collection",
    ),
    "deep_dive_mids": ToolMetadata(
        name="deep_dive_mids",
        timeout_seconds=180,
        safe_for_parallel=False,  # High API load, serialize
        category="data_collection",
    ),
    "emit_report": ToolMetadata(
        name="emit_report",
        timeout_seconds=10,
        safe_for_parallel=False,
        category="output",
    ),
    # ... all 12 tools registered with explicit timeouts
}
```

### 2.6 Model Configuration

Uses the existing model config system. Investigation agent defaults to Opus:

```python
# Already registered in backend/app/core/models.py:466
ModelUseCase.INVESTIGATION: ModelConfig(
    model_name="claude-opus-4-6",
    temperature=0.7,
    max_tokens=128000,
    provider="anthropic",
)

# Already registered in backend/app/core/models.py:185
"investigation_agent": InvocationPoint(
    key="investigation_agent",
    display_name="Investigation Sub-Agent",
    category="agents",
    default_use_case=ModelUseCase.INVESTIGATION,
)
```

Creation: `create_langchain_model(ModelUseCase.INVESTIGATION, invocation_key="investigation_agent")`

S4 admins can override model/temperature/max_tokens via the LLM selector panel.

**(M3)** Graphs are built per-request (never cached on the instance) to honor admin LLM selector overrides. `ainvoke()` calls `_build_graph()` fresh each time. The compiled graph is not stored on `self`.

### 2.7 Intelligence Platform Layers

```
Layer 1: Investigation Registry (Postgres pos_app.app_state)
  - investigation_registry table: who, what, when, findings, risk
  - Queryable by enterprise, date range, risk level, tags

Layer 2: Evidence Store (Redis + Postgres)
  - Redis: hot evidence for active conversations (TTL 7 days)
    - Key: investigation:{id}:state --> full serialized InvestigationAgentState
    - Key: investigation:{id}:evidence --> accumulated tool results
  - Postgres: investigation_evidence table for long-term archive
    - investigation_id (FK), evidence_json (JSONB), compressed

Layer 3: Semantic Search (pgvector)
  - Each investigation finding gets embedded (text-embedding-3-small)
  - investigation_embeddings table with vector(1536) column
  - Similarity search across all past findings
  - Pattern recognition: "we've seen this before"
```

### 2.8 WS v2 Streaming Architecture

The ReAct loop is visible in real time via WS v2 streaming:

```
agent_node reasoning tokens  -->  WS: {"type": "agent_thinking", "content": "..."}
tool_node start              -->  WS: {"type": "tool_start", "tool": "deep_dive_mids", "args": {...}}
tool_node progress           -->  WS: {"type": "tool_progress", "tool": "deep_dive_mids", "status": "querying 10 MIDs..."}
tool_node complete           -->  WS: {"type": "tool_complete", "tool": "deep_dive_mids", "summary": "..."}
intermediate finding         -->  WS: {"type": "investigation_finding", "finding": {...}}
report emitted               -->  WS: {"type": "artifact", "payload": ReportArtifactPayload}
```

The user sees the detective work happening: reasoning between tool calls, tool progress, intermediate findings as they are discovered, and the final report artifact at the end.

---

## 3. Interface Contracts

### 3.1 Investigation Input Model (H1)

All models in `backend/app/schemas/tiered_investigation_schemas.py` (M1: consolidated, no separate `tool_models.py`).

```python
class InvestigationInput(BaseModel):
    """Input to the investigation graph. Passed by the admin bridge tool."""
    model_config = ConfigDict(extra="forbid")

    enterprise_name: str = Field(..., min_length=1)
    investigation_type: InvestigationType = InvestigationType.CUSTOM
    user_context: str = Field(default="")
    mids: list[str] = Field(
        default_factory=list,
        description="User-specified MIDs to focus on. Empty = agent decides from snapshot."
    )
    focus_areas: list[str] = Field(
        default_factory=list,
        description="User-specified focus areas (volume, cases, equipment, etc). Empty = agent decides."
    )
    session_id: str = Field(default="")
    chat_session_id: str = Field(default="")
    user_id: str = Field(default="")
    max_iterations: int = Field(default=8, ge=1, le=20)
```

When `mids` is non-empty, the system prompt instructs the agent: "The user has specified these MIDs for investigation. Focus on these MIDs. You may discover related MIDs but prioritize the user's list." When `focus_areas` is non-empty: "The user has requested focus on these areas. Prioritize these in your deep-dives."

### 3.2 Tool Result Models (M1, M2)

All tool result models live in `backend/app/schemas/tiered_investigation_schemas.py` alongside the existing tier 1/2/3 models. No separate `tool_models.py` file.

```python
class ToolResultBase(BaseModel):
    """Base for all investigation tool results."""
    model_config = ConfigDict(extra="forbid")

    success: bool = True
    source: str = Field(..., description="Data source name for citation")
    record_count: int = Field(default=0, ge=0)
    duration_ms: int = Field(default=0, ge=0)
    summary: str = Field(default="", description="Concise summary for agent context")
    error_message: Optional[str] = None


class EnterpriseSnapshotResult(ToolResultBase):
    source: str = "MerchantEnterpriseGroupingDataset"
    total_mids: int = Field(default=0, ge=0)
    active_mids: int = Field(default=0, ge=0)
    enterprise_manager: Optional[str] = None
    parent_company: Optional[str] = None
    distribution: Optional[EnterpriseDistribution] = None
    signal_analysis: Optional[SignalAnalysis] = None
    all_mids: list[str] = Field(default_factory=list)


class DeepDiveResult(ToolResultBase):
    source: str = "MultiSource"
    mids_requested: list[str] = Field(default_factory=list)
    mids_profiled: int = Field(default=0, ge=0)
    volume_history: list[MIDVolumeHistory] = Field(default_factory=list)
    cases: list[MIDCases] = Field(default_factory=list)
    equipment: list[MIDEquipment] = Field(default_factory=list)
    nice_contacts: list[MIDNICEContacts] = Field(default_factory=list)
    fees: list[MIDFees] = Field(default_factory=list)
    profiles: list[MIDProfile] = Field(default_factory=list)
    health_scores: list[MIDHealthScore] = Field(default_factory=list)
    billing_profiles: list[MIDBillingProfile] = Field(default_factory=list)


class OrdersResult(ToolResultBase):
    source: str = "MerchantLinkedObjects"
    orders: list[MIDOrders] = Field(default_factory=list)
    tasks: list[MIDTasks] = Field(default_factory=list)
    stalled_order_count: int = Field(default=0, ge=0)
    pending_shipment_count: int = Field(default=0, ge=0)
    canceled_task_count: int = Field(default=0, ge=0)


class CancellationSearchResult(ToolResultBase):
    source: str = "Cancellation"
    cancellations: list[CancellationRecord] = Field(default_factory=list)


class UnbatchedSearchResult(ToolResultBase):
    source: str = "DailyNewUnbatchedMerchantsList"
    unbatched_records: list[UnbatchedMerchantRecord] = Field(default_factory=list)
    total_unbatched_amount: float = Field(default=0, ge=0)


class JiraSearchResult(ToolResultBase):
    source: str = "Jira"
    issues: list[JiraIssueRecord] = Field(default_factory=list)


class ContactCenterResult(ToolResultBase):
    source: str = "NICEInContactRecordsByMID"
    contacts: list[MIDNICEContacts] = Field(default_factory=list)
    total_calls: int = Field(default=0, ge=0)
    total_abandoned: int = Field(default=0, ge=0)


class FoundryQueryResult(ToolResultBase):
    source: str = "Foundry"
    object_type: str = ""
    records: list[FoundryRecord] = Field(default_factory=list)
    # FoundryRecord is a typed model, NOT list[str]


class EmitReportResult(ToolResultBase):
    source: str = "InvestigationAgent"
    report_emitted: bool = True


# === Knowledge Base Tool Results ===

class PastInvestigationSummary(BaseModel):
    """Summary of a past investigation for search results."""
    model_config = ConfigDict(extra="forbid")

    investigation_id: str
    enterprise_name: str
    investigation_type: str
    created_at: str
    risk_level: str
    finding_count: int
    key_findings_preview: list[str] = Field(default_factory=list)
    similarity_score: float = Field(default=0.0, ge=0.0, le=1.0)


class PastInvestigationSearchResult(ToolResultBase):
    source: str = "InvestigationRegistry"
    investigations: list[PastInvestigationSummary] = Field(default_factory=list)


class InvestigationDetailResult(ToolResultBase):
    source: str = "InvestigationRegistry"
    investigation_id: str = ""
    enterprise_name: str = ""
    investigation_type: str = ""
    created_at: str = ""
    risk_level: str = ""
    key_findings: list[str] = Field(default_factory=list)
    flagged_mids: list[str] = Field(default_factory=list)
    evidence_summary: str = ""
    tags: list[str] = Field(default_factory=list)


class SimilarPatternMatch(BaseModel):
    """A past investigation with similar signal patterns."""
    model_config = ConfigDict(extra="forbid")

    investigation_id: str
    enterprise_name: str
    matching_signals: list[str] = Field(default_factory=list)
    similarity_score: float = Field(default=0.0, ge=0.0, le=1.0)
    outcome_summary: str = ""


class SimilarPatternsResult(ToolResultBase):
    source: str = "InvestigationRegistry"
    matches: list[SimilarPatternMatch] = Field(default_factory=list)
```

### 3.3 Framework Base Class (H5, H6)

The `SpecializedAgentGraph` base class provides the common pattern. All future agents inherit from it.

```python
# backend/app/agents/framework/specialized_agent.py

class SpecializedAgentConfig(BaseModel):
    """Configuration for a specialized agent graph."""
    model_config = ConfigDict(extra="forbid")

    agent_name: str = Field(..., description="Unique agent identifier for logging/tracing")
    model_use_case: ModelUseCase = Field(..., description="LLM model use case")
    invocation_key: str = Field(..., description="Invocation point key for admin overrides")
    max_iterations: int = Field(default=8, ge=1, le=20)
    langfuse_trace_name: str = Field(default="specialized-agent")
    tool_timeout_seconds: int = Field(default=120, ge=10, le=600)


class SubInvestigationContract(BaseModel):
    """Contract for parent/child sub-investigation dispatch (H6)."""
    model_config = ConfigDict(extra="forbid")

    parent_investigation_id: str
    child_investigation_id: str
    child_enterprise_name: str
    child_focus: str
    budget_iterations: int = Field(default=4, ge=1, le=10)
    timeout_seconds: int = Field(default=300, ge=30, le=600)


class SubInvestigationResult(BaseModel):
    """Result of a sub-investigation, merged into parent state."""
    model_config = ConfigDict(extra="forbid")

    child_investigation_id: str
    success: bool
    evidence_log: list[str] = Field(default_factory=list)
    findings: list[str] = Field(default_factory=list)
    error: Optional[str] = None


class SpecializedAgentGraph(ABC):
    """Base class for specialized LangGraph ReAct agents.

    Provides:
    - Standard ReAct loop (agent_node -> tool_node -> post_tool_extractor -> should_continue)
    - Model creation via central config system (per-request, not cached -- M3)
    - Tool registration with timeout metadata (H4)
    - Graph safety (orphaned tool_call injection)
    - Langfuse observability hooks (H5)
    - Callback/streaming propagation (H5)
    - Cancellation token support (H5)
    - Prompt reference linking (H5)
    - Sub-investigation dispatch contract (H6)
    - Configurable max iterations

    Subclasses implement:
    - get_tools() -> list of LangChain tools
    - get_tool_registry() -> dict of ToolMetadata (H4)
    - get_system_prompt(state) -> system prompt string
    - get_state_class() -> TypedDict class for LangGraph state
    - build_initial_state(input) -> initial state dict
    - extract_tool_results(state, tool_messages) -> state updates (H3)
    - on_completion(state) -> None (generic completion hook, H6)
    """

    @abstractmethod
    def get_tools(self) -> list[BaseTool]: ...

    @abstractmethod
    def get_tool_registry(self) -> dict[str, ToolMetadata]: ...

    @abstractmethod
    def get_system_prompt(self, state: dict) -> str: ...

    @abstractmethod
    def get_state_class(self) -> type: ...

    @abstractmethod
    def build_initial_state(self, input_model: BaseModel) -> dict: ...

    @abstractmethod
    def extract_tool_results(self, state: dict, tool_messages: list) -> dict:
        """(H3) Parse ToolMessages into typed state fields.
        Returns a dict of state updates (evidence_log entries, report_payload, etc.).
        Called by post_tool_extractor node after every tool_node execution."""
        ...

    async def on_completion(self, state: dict) -> None:
        """(H6) Generic completion hook. Called after graph reaches __end__.
        Default: no-op. Override for persistence, event emission, etc.
        Investigation agent uses this to write to registry + evidence store."""
        pass

    async def dispatch_sub_investigation(
        self, contract: SubInvestigationContract
    ) -> SubInvestigationResult:
        """(H6) Dispatch a child investigation with budget/timeout constraints.
        Parent state is isolated from child. Merge rules defined by caller."""
        ...

    def _build_graph(self, callbacks=None, cancellation_token=None) -> CompiledGraph:
        """Build graph fresh per request (M3). Never cached."""
        ...

    async def ainvoke(
        self,
        input_model: BaseModel,
        callbacks: Optional[list] = None,
        cancellation_token: Optional[CancellationToken] = None,
        langfuse_handler: Optional[Any] = None,
    ) -> dict:
        """(H5) Full invocation with streaming/callback/observability propagation.

        - callbacks: LangChain callbacks for streaming token propagation
        - cancellation_token: Cooperative cancellation (checked each iteration)
        - langfuse_handler: Langfuse callback handler for trace/span creation
        """
        graph = self._build_graph(callbacks=callbacks, cancellation_token=cancellation_token)
        initial_state = self.build_initial_state(input_model)
        config = {"callbacks": callbacks or []}
        if langfuse_handler:
            config["callbacks"].append(langfuse_handler)
        result = await graph.ainvoke(initial_state, config=config)
        await self.on_completion(result)
        return result
```

### 3.4 Sub-Investigation Dispatch Contract (H6)

```python
# Parent/child state isolation and merge rules:

# 1. Parent creates SubInvestigationContract with budget + timeout
contract = SubInvestigationContract(
    parent_investigation_id=state["investigation_id"],
    child_investigation_id=str(uuid4()),
    child_enterprise_name="TAO NYC Cluster",
    child_focus="volume decline root cause",
    budget_iterations=4,
    timeout_seconds=120,
)

# 2. dispatch_sub_investigation creates a child graph with isolated state
result = await self.dispatch_sub_investigation(contract)

# 3. Merge rules (caller decides):
#    - evidence_log: parent EXTENDS with child evidence_log
#    - findings: parent EXTENDS with child findings
#    - tools_called: parent EXTENDS with prefixed child tools
#    - mids_investigated: parent EXTENDS (union)
#    - report_payload: child does NOT produce report (parent synthesizes)

# 4. on_completion is NOT called for child (only parent calls on_completion)
```

### 3.5 Database Schema (Intelligence Platform)

```sql
-- Alembic migration: add investigation registry and evidence tables

-- Layer 1: Investigation Registry
CREATE TABLE app_state.investigation_registry (
    investigation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_name VARCHAR(500) NOT NULL,
    investigation_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES app_state.users(id),
    completed_at TIMESTAMPTZ,
    mid_count INT NOT NULL DEFAULT 0,
    finding_count INT NOT NULL DEFAULT 0,
    risk_level VARCHAR(20) NOT NULL DEFAULT 'unknown',
    key_findings JSONB NOT NULL DEFAULT '[]'::jsonb,
    flagged_mids JSONB NOT NULL DEFAULT '[]'::jsonb,
    enterprise_manager VARCHAR(200),
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    report_payload JSONB,  -- Full ReportArtifactPayload for replay
    session_id UUID,
    chat_session_id UUID REFERENCES app_state.chat_sessions(id)
);

CREATE INDEX idx_investigation_registry_enterprise ON app_state.investigation_registry(enterprise_name);
CREATE INDEX idx_investigation_registry_created_at ON app_state.investigation_registry(created_at);
CREATE INDEX idx_investigation_registry_risk_level ON app_state.investigation_registry(risk_level);
CREATE INDEX idx_investigation_registry_tags ON app_state.investigation_registry USING gin(tags);

-- Layer 2: Evidence Store (long-term archive)
CREATE TABLE app_state.investigation_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigation_id UUID NOT NULL REFERENCES app_state.investigation_registry(investigation_id) ON DELETE CASCADE,
    tool_name VARCHAR(100) NOT NULL,
    evidence_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    compressed BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_investigation_evidence_investigation ON app_state.investigation_evidence(investigation_id);

-- Layer 3: Semantic Search (pgvector)
-- Requires: CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE app_state.investigation_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigation_id UUID NOT NULL REFERENCES app_state.investigation_registry(investigation_id) ON DELETE CASCADE,
    finding_index INT NOT NULL,
    finding_text TEXT NOT NULL,
    embedding vector(1536) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_investigation_embeddings_investigation ON app_state.investigation_embeddings(investigation_id);
CREATE INDEX idx_investigation_embeddings_vector ON app_state.investigation_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### 3.6 Redis Evidence Cache Schema

```
# Hot evidence for active conversations (TTL 7 days)

investigation:{investigation_id}:state
  -> JSON: full serialized InvestigationAgentState
  -> TTL: 604800 seconds (7 days)
  -> Written: after each tool_node execution (incremental)
  -> Read: by admin agent for follow-up questions

investigation:{investigation_id}:evidence
  -> JSON: list of {tool_name, result_json, timestamp}
  -> TTL: 604800 seconds (7 days)
  -> Written: by post_tool_extractor after each tool execution
  -> Read: by get_investigation_detail tool, by admin agent for context continuity
```

---

## 4. Acceptance Criteria

### Core Agent ACs

| # | Criterion | Verify Command | Expected | Tolerance |
|---|-----------|----------------|----------|-----------|
| AC1 | `get_enterprise_snapshot("STARLINK")` returns distribution + signals for 6 MIDs | `python scripts/test_investigation_tools.py --tool snapshot --enterprise STARLINK` | `total_mids=6`, non-empty `distribution`, `signal_analysis` | Exact MID count |
| AC2 | `get_enterprise_snapshot("COMPASS GROUP")` handles 1,282 MIDs in <5s | Same script, `--enterprise "COMPASS GROUP"` | `total_mids>=1000`, duration <5000ms | MID count within 10%, time within 2x |
| AC3 | `deep_dive_mids` returns typed data for requested MIDs and focus areas only | `--tool deep_dive --mids "0021773366,0021773367" --focus volume,cases` | Returns `MIDVolumeHistory` + `MIDCases` for exactly those MIDs, no other focus area data | Exact |
| AC4 | `deep_dive_mids` rejects >20 MIDs | `--tool deep_dive --mids <21 MIDs>` | Returns error, `success=False` | Exact |
| AC5 | `emit_report` produces valid `ReportArtifactPayload` | `--tool emit_report --fixture starlink_sample` | JSON parses as `ReportArtifactPayload.model_validate()` without error | Exact |
| AC6 | Full investigation: Starlink produces report with >=3 sections and >=2 findings | `python scripts/test_investigation_agent.py --enterprise STARLINK --type post_mortem` | Report has `executive_summary` (non-empty), `sections` (>=3), at least one `findings` section with >=2 items | Section count >= 3 |
| AC7 | Full investigation: TAO GROUP produces report within 120s | Same script, `--enterprise "TAO GROUP"` | Complete within 120s, non-empty report | Time within 1.5x |
| AC8 | Agent calls >=2 tools before emitting report (not just snapshot + emit) | Parse Langfuse trace for `investigation-agent` | `tools_called` list has >=3 entries (snapshot + at least 1 investigation + emit) | Exact |
| AC9 | Agent system prompt includes investigation template tone | Inspect Langfuse trace system message | Contains template `narrative_tone` string | Exact |
| AC10 | Max iterations enforced -- agent terminates cleanly at limit | Set `max_iterations=2`, run investigation | Agent emits a synthesis or error, no crash, stubs injected for orphaned tool_calls | No crash |
| AC11 | Admin bridge tool (`generate_investigation_report`) returns report artifact dict | Call from admin chat: "Run a post-mortem on NANDOS" | Returns `{"type": "investigation_report", "report": {...}}` with valid payload | Exact |
| AC12 | `ReportArtifactPayload` renders inline in admin chat (artifact middleware) | Observe chat after investigation | Report artifact appears with sections, findings, recommendations | Visual |
| AC13 | `SpecializedAgentGraph` base class can be instantiated by investigation agent | `python -c "from app.agents.investigation_agent.graph import InvestigationGraph; g = InvestigationGraph(); print(g.config.agent_name)"` | Prints `investigation_agent` | Exact |
| AC14 | All tool results are typed Pydantic models -- no bare dicts in evidence | Grep `Dict[str, Any]` in `investigation_agent/` | 0 matches | Exact |
| AC15 | Evidence log persists across tool iterations | Langfuse trace shows `evidence_log` growing with each tool call | Each tool call appends summary string | Monotonically increasing |

### User Scope ACs (H1)

| # | Criterion | Verify | Expected |
|---|-----------|--------|----------|
| AC16 | `InvestigationInput.mids` propagates to state and system prompt | Set `mids=["0021773366"]`, check Langfuse trace | System prompt contains "User-specified MIDs: 0021773366" |
| AC17 | `InvestigationInput.focus_areas` propagates to state and system prompt | Set `focus_areas=["volume", "cases"]`, check trace | System prompt contains "User focus areas: volume, cases" |
| AC18 | User-specified MIDs take precedence over agent snapshot analysis | Set `mids=["0021773366"]`, verify deep_dive targets | `deep_dive_mids` called with the user-specified MID first |

### Post-Tool Extractor ACs (H3)

| # | Criterion | Verify | Expected |
|---|-----------|--------|----------|
| AC19 | `post_tool_extractor` node exists in compiled graph | Inspect graph nodes | Node named `post_tool_extractor` present between `tools` and `agent` |
| AC20 | `post_tool_extractor` parses `emit_report` result into `report_emitted=True` | Run agent to completion | `state["report_emitted"]` is True after emit_report tool call |
| AC21 | `post_tool_extractor` appends to `evidence_log` from tool summaries | Run 3-tool investigation | `evidence_log` has 3 entries after 3 tool calls |

### Tier 2 Signal Engine ACs (H2)

| # | Criterion | Golden Fixture | Expected |
|---|-----------|---------------|----------|
| AC22 | Volume decline detector flags MIDs with >20% 28-day decline | `fixtures/volume_decline.json` | MIDs with 28d_volume_change < -20% flagged with severity=high or critical |
| AC23 | Z-score anomaly detector flags MIDs > 2 standard deviations from cohort mean | `fixtures/zscore_anomaly.json` | MIDs with z_score > 2.0 flagged |
| AC24 | Device inactivity detector flags MIDs with no terminal activity > 14 days | `fixtures/device_inactive.json` | MIDs with last_transaction_date > 14 days ago flagged |
| AC25 | Cancellation detector identifies recent cancellation requests | `fixtures/cancellation_detect.json` | MIDs with cancellation records in past 90 days flagged |
| AC26 | Unbatched flag detector identifies MIDs on unbatched list | `fixtures/unbatched_flag.json` | MIDs present in DailyNewUnbatchedMerchantsList flagged |
| AC27 | Stalled order detector identifies MIDs with orders stuck > 30 days | `fixtures/stalled_orders.json` | MIDs with open orders older than 30 days flagged |
| AC28 | Signal engine processes 1,282 MIDs in <2s (pure Python, no API calls) | Compass Group data | Duration < 2000ms |

### Intelligence Platform ACs

| # | Criterion | Verify | Expected |
|---|-----------|--------|----------|
| AC29 | Investigation registry table exists and accepts inserts | Alembic migration + INSERT test | Row inserted with all required fields |
| AC30 | `search_past_investigations("billing migration")` returns semantically relevant results | Run after 2+ investigations completed | Results ranked by cosine similarity, top result is relevant |
| AC31 | `get_investigation_detail(id)` returns full evidence from a specific past investigation | Query with known investigation_id | Returns key_findings, flagged_mids, evidence_summary |
| AC32 | `find_similar_patterns("TAO GROUP")` finds past investigations with matching signal patterns | Run after TAO investigation | Returns matches with similarity_score > 0.5 |
| AC33 | Redis evidence cache populated during investigation | Check `investigation:{id}:state` key after tool call | JSON-parseable InvestigationAgentState |
| AC34 | Redis evidence cache TTL is 7 days | `TTL investigation:{id}:state` | ~604800 seconds |
| AC35 | Investigation findings embeddable as SavedInsight | Call promote-to-insight endpoint | SavedInsight created with source_type and investigation_id |

### Streaming ACs

| # | Criterion | Verify | Expected |
|---|-----------|--------|----------|
| AC36 | Agent reasoning tokens stream between tool calls | WS v2 client observes `agent_thinking` events | Tokens visible in real time |
| AC37 | Tool start/complete events visible to user | WS v2 client observes `tool_start` and `tool_complete` events | Tool name and summary visible |
| AC38 | Final report artifact emitted via WS | WS v2 client observes `artifact` event | Valid ReportArtifactPayload |

### Framework ACs (H4, H5, H6)

| # | Criterion | Verify | Expected |
|---|-----------|--------|----------|
| AC39 | Investigation tool registry has explicit timeout per tool | Inspect `INVESTIGATION_TOOL_REGISTRY` | All 12 tools have `timeout_seconds` set |
| AC40 | `SpecializedAgentGraph.ainvoke` accepts callbacks, cancellation_token, langfuse_handler | Type signature check | All 3 optional params present |
| AC41 | Cancellation token stops agent mid-loop | Set token, cancel after 2 iterations | Agent terminates without crash, partial state returned |
| AC42 | Langfuse trace created with correct name | Run investigation, check Langfuse | Trace named `investigation-agent` with tool spans |
| AC43 | `dispatch_sub_investigation` respects budget_iterations | Dispatch child with budget=2 | Child terminates at 2 iterations |

---

## 5. Work Packages

### WP1: Specialized Agent Framework

**Goal**: Build the reusable base class that all future specialized agents inherit from. Addresses H3, H4, H5, H6, M3.

**Files to create**:
- `backend/app/agents/framework/specialized_agent.py` -- `SpecializedAgentGraph` ABC, `SpecializedAgentConfig`, `SubInvestigationContract`, `SubInvestigationResult`
- `backend/app/agents/framework/cancellation.py` -- `CancellationToken` (cooperative cancellation primitive)

**Files to modify**:
- `backend/app/agents/framework/__init__.py` -- export new classes

**Design**:

```python
class SpecializedAgentGraph(ABC):
    def __init__(self, config: SpecializedAgentConfig):
        self.config = config
        # NOTE: No self._compiled_graph -- graphs are per-request (M3)

    # --- Abstract methods (subclass implements) ---

    @abstractmethod
    def get_tools(self) -> list[BaseTool]: ...

    @abstractmethod
    def get_tool_registry(self) -> dict[str, ToolMetadata]: ...  # (H4)

    @abstractmethod
    def get_system_prompt(self, state: dict) -> str: ...

    @abstractmethod
    def get_state_class(self) -> type: ...

    @abstractmethod
    def build_initial_state(self, input_model: BaseModel) -> dict: ...

    @abstractmethod
    def extract_tool_results(self, state: dict, tool_messages: list) -> dict: ...  # (H3)

    async def on_completion(self, state: dict) -> None:  # (H6)
        """Generic completion hook. Default: no-op."""
        pass

    # --- Concrete methods ---

    def _create_model(self) -> BaseChatModel:
        return create_langchain_model(
            self.config.model_use_case,
            invocation_key=self.config.invocation_key,
        )

    def _build_graph(
        self,
        callbacks: Optional[list] = None,
        cancellation_token: Optional[CancellationToken] = None,
    ) -> CompiledGraph:
        """Build graph fresh per request (M3 -- honors admin LLM selector overrides)."""
        state_class = self.get_state_class()
        tools = self.get_tools()
        tool_registry = self.get_tool_registry()
        model = self._create_model().bind_tools(tools)

        async def agent_node(state):
            # (H5) Check cancellation token
            if cancellation_token and cancellation_token.is_cancelled:
                return {"error": "Investigation cancelled by user."}

            messages = state["messages"]
            iteration = state.get("iteration_count", 0)

            if not messages or not isinstance(messages[0], SystemMessage):
                sys_prompt = self.get_system_prompt(state)
                messages = [SystemMessage(content=sys_prompt)] + messages

            # (H5) Propagate callbacks for streaming
            response = await model.ainvoke(messages, config={"callbacks": callbacks or []})
            return {
                "messages": [response],
                "iteration_count": iteration + 1,
            }

        tool_node = ParallelToolNode(
            tools=tools,
            tool_registry=tool_registry,  # (H4) correct constructor arg
        )

        async def post_tool_extractor(state):
            """(H3) Parse ToolMessages into typed state fields.
            Tools cannot mutate state directly via ParallelToolNode."""
            last_messages = state["messages"]
            # Get only the most recent batch of tool messages
            recent_tool_messages = []
            for msg in reversed(last_messages):
                if isinstance(msg, ToolMessage):
                    recent_tool_messages.insert(0, msg)
                elif isinstance(msg, AIMessage):
                    break  # Stop at the AI message that triggered these tools
            return self.extract_tool_results(state, recent_tool_messages)

        def should_continue(state) -> Literal["tools", "inject_stubs", "__end__"]:
            if state.get("report_emitted"):
                return "__end__"
            last = state["messages"][-1]
            if hasattr(last, "tool_calls") and last.tool_calls:
                iteration = state.get("iteration_count", 0)
                max_iter = state.get("max_iterations", self.config.max_iterations)
                if iteration >= max_iter + 1:
                    return "inject_stubs"
                if iteration >= max_iter:
                    # Forced synthesis: handled by agent_node injecting synthesis message
                    return "tools"
                return "tools"
            return "__end__"

        workflow = StateGraph(state_class)
        workflow.add_node("agent", agent_node)
        workflow.add_node("tools", tool_node)
        workflow.add_node("post_tool_extractor", post_tool_extractor)
        workflow.add_node("inject_stubs", create_inject_stubs_node(self.config.agent_name))
        workflow.set_entry_point("agent")
        workflow.add_conditional_edges("agent", should_continue, {
            "tools": "tools",
            "inject_stubs": "inject_stubs",
            "__end__": END,
        })
        workflow.add_edge("tools", "post_tool_extractor")
        workflow.add_edge("post_tool_extractor", "agent")
        workflow.add_edge("inject_stubs", END)

        return workflow.compile()

    async def ainvoke(
        self,
        input_model: BaseModel,
        callbacks: Optional[list] = None,
        cancellation_token: Optional[CancellationToken] = None,
        langfuse_handler: Optional[Any] = None,
    ) -> dict:
        """(H5) Full invocation with streaming/observability propagation."""
        all_callbacks = list(callbacks or [])
        if langfuse_handler:
            all_callbacks.append(langfuse_handler)
        # (H5) Create Langfuse trace/span for observability
        graph = self._build_graph(
            callbacks=all_callbacks,
            cancellation_token=cancellation_token,
        )
        initial_state = self.build_initial_state(input_model)
        result = await graph.ainvoke(initial_state, config={"callbacks": all_callbacks})
        # (H6) Generic completion hook
        await self.on_completion(result)
        return result

    async def dispatch_sub_investigation(
        self, contract: SubInvestigationContract
    ) -> SubInvestigationResult:
        """(H6) Dispatch a child investigation with budget/timeout.

        - Child gets isolated state (no parent messages)
        - Child max_iterations = contract.budget_iterations
        - Child timeout = contract.timeout_seconds
        - on_completion is NOT called for child
        - Returns SubInvestigationResult for parent to merge
        """
        child_input = InvestigationInput(
            enterprise_name=contract.child_enterprise_name,
            investigation_type=InvestigationType.CUSTOM,
            user_context=contract.child_focus,
            max_iterations=contract.budget_iterations,
        )
        try:
            child_graph = self._build_graph()
            child_state = self.build_initial_state(child_input)
            result = await asyncio.wait_for(
                child_graph.ainvoke(child_state),
                timeout=contract.timeout_seconds,
            )
            return SubInvestigationResult(
                child_investigation_id=contract.child_investigation_id,
                success=True,
                evidence_log=result.get("evidence_log", []),
                findings=[],  # Extracted by parent from evidence
            )
        except asyncio.TimeoutError:
            return SubInvestigationResult(
                child_investigation_id=contract.child_investigation_id,
                success=False,
                error=f"Sub-investigation timed out after {contract.timeout_seconds}s",
            )
        except Exception as e:
            return SubInvestigationResult(
                child_investigation_id=contract.child_investigation_id,
                success=False,
                error=str(e),
            )
```

**Key decisions**:
- ABC now has 6 abstract methods (get_tools, get_tool_registry, get_system_prompt, get_state_class, build_initial_state, extract_tool_results) plus 1 optional override (on_completion).
- **(M3)** Graph is built fresh per `ainvoke()` call -- no caching on `self`. This ensures admin LLM selector overrides are honored.
- **(H3)** `post_tool_extractor` node sits between `tools` and `agent`. It calls the subclass's `extract_tool_results()` to parse ToolMessages into state fields.
- **(H4)** `get_tool_registry()` returns `dict[str, ToolMetadata]` with explicit timeouts per tool. Passed as `tool_registry=` to `ParallelToolNode`.
- **(H5)** `ainvoke()` accepts `callbacks`, `cancellation_token`, `langfuse_handler`. Callbacks propagate through `agent_node`'s `model.ainvoke()`. Cancellation token is checked at the start of each `agent_node` pass.
- **(H6)** `dispatch_sub_investigation` creates an isolated child graph with budget/timeout. Parent merges child results explicitly. `on_completion` is only called for the top-level invocation.

**References**:
- `backend/app/agents/framework/graph_safety.py:67` -- `create_inject_stubs_node()`
- `backend/app/agents/framework/parallel_tool_node.py:1` -- `ParallelToolNode`
- `backend/app/agents/framework/tool_registry.py:77` -- `ToolMetadata`
- `backend/app/core/models.py:779` -- `create_langchain_model()`
- `backend/app/agents/framework/observability.py` -- Langfuse integration

---

### WP2: Tier 2 Signal Engine

**Goal**: Implement all 6 signal detectors with deterministic logic and golden fixtures for regression testing. Addresses H2 and M4.

**Files to create**:
- `backend/app/agents/investigation_agent/signal_engine.py` -- all 6 detectors + `detect_all_signals()` orchestrator
- `scripts/fixtures/` -- golden fixture JSON files for each detector

**Files to modify**:
- `backend/app/schemas/tiered_investigation_schemas.py` -- ensure `SignalCategory`, `SignalSeverity`, `MIDSignal`, `SignalAnalysis` models are complete

**Detector Specifications**:

```python
# backend/app/agents/investigation_agent/signal_engine.py

class DetectorConfig(BaseModel):
    """Configuration for a signal detector."""
    model_config = ConfigDict(extra="forbid")

    name: str
    category: SignalCategory
    description: str
    enabled: bool = True


class DetectorResult(BaseModel):
    """Output of a single detector run."""
    model_config = ConfigDict(extra="forbid")

    detector_name: str
    signals_detected: list[MIDSignal] = Field(default_factory=list)
    mids_scanned: int = Field(default=0, ge=0)
    duration_ms: int = Field(default=0, ge=0)
```

**Detector 1: Volume Decline**
- Input: list of `EnterpriseGroupingRecord` (127-field records)
- Logic: Flag MIDs where `volume_28d_change_pct < -20%`. Severity: `>-50%` = critical, `>-35%` = high, `>-20%` = medium.
- Golden fixture: `scripts/fixtures/volume_decline.json` (10 MIDs, 4 expected flags)
- AC: AC22

**Detector 2: Z-Score Anomaly**
- Input: list of `EnterpriseGroupingRecord`
- Logic: Calculate z-score of each MID's 28d volume against the enterprise mean. Flag MIDs with `|z_score| > 2.0`. Severity: `>3.0` = critical, `>2.5` = high, `>2.0` = medium.
- Golden fixture: `scripts/fixtures/zscore_anomaly.json` (20 MIDs, 3 expected flags)
- AC: AC23

**Detector 3: Device Inactivity**
- Input: list of `EnterpriseGroupingRecord`
- Logic: Flag MIDs where `last_transaction_date` is more than 14 days ago AND `status = active`. Severity: `>60d` = critical, `>30d` = high, `>14d` = medium.
- Golden fixture: `scripts/fixtures/device_inactive.json` (8 MIDs, 2 expected flags)
- AC: AC24

**Detector 4: Cancellation Detection**
- Input: list of `EnterpriseGroupingRecord` + optional cancellation records
- Logic: Cross-reference MIDs against known cancellation requests (from enterprise grouping `cancellation_*` fields or supplementary data). Flag MIDs with cancellation activity in past 90 days. Severity: `confirmed_cancel` = critical, `pending_cancel` = high, `cancel_inquiry` = medium.
- Golden fixture: `scripts/fixtures/cancellation_detect.json` (15 MIDs, 3 expected flags)
- AC: AC25

**Detector 5: Unbatched Flag**
- Input: list of `EnterpriseGroupingRecord` + optional unbatched records
- Logic: Cross-reference MIDs against DailyNewUnbatchedMerchantsList. Flag MIDs that appear on the list. Severity: `amount > $10K` = critical, `amount > $1K` = high, else medium.
- Golden fixture: `scripts/fixtures/unbatched_flag.json` (12 MIDs, 4 expected flags)
- AC: AC26

**Detector 6: Stalled Orders**
- Input: list of `EnterpriseGroupingRecord` (uses order-related fields from 127-field record)
- Logic: Flag MIDs with open orders older than 30 days (inferred from `open_order_count`, `oldest_open_order_date` fields if available, or flagged for API lookup). Severity: `>90d` = critical, `>60d` = high, `>30d` = medium.
- Golden fixture: `scripts/fixtures/stalled_orders.json` (10 MIDs, 3 expected flags)
- AC: AC27

**Orchestrator**:

```python
async def detect_all_signals(
    records: list[EnterpriseGroupingRecord],
    supplementary_data: Optional[SupplementarySignalData] = None,
) -> SignalAnalysis:
    """Run all enabled detectors. Pure Python, no API calls.
    Target: <2s for 1,282 MIDs (AC28)."""
    results: list[DetectorResult] = []
    for detector in ALL_DETECTORS:
        if detector.enabled:
            result = detector.run(records, supplementary_data)
            results.append(result)
    return _merge_detector_results(results)
```

**Golden Fixture Format** (M4):

```json
{
  "fixture_name": "volume_decline",
  "detector": "volume_decline_detector",
  "records": [...],
  "expected_flags": [
    {"mid": "0021773366", "severity": "critical", "reason": "volume_28d_change_pct=-67%"},
    {"mid": "0021773367", "severity": "high", "reason": "volume_28d_change_pct=-42%"}
  ],
  "expected_no_flag": ["0021773368", "0021773369"]
}
```

Each fixture is a self-contained regression test: load records, run detector, assert expected flags match.

**References**:
- `backend/app/schemas/tiered_investigation_schemas.py:32-48` -- `SignalCategory`, `SignalSeverity`
- `backend/app/agents/investigation_agent/tiered_interfaces.py` -- current signal detection (to be replaced)
- `backend/app/agents/investigation_agent/service.py:480` -- `_detect_signals()` (current implementation)

---

### WP3: Investigation Tools

**Goal**: Build 9 investigation tools + 3 knowledge base tools (12 total). Addresses M1, M2.

**Files to create**:
- `backend/app/agents/investigation_agent/tools.py` -- 9 `@tool` functions for investigation
- `backend/app/agents/investigation_agent/knowledge_tools.py` -- 3 knowledge base tools
- `backend/app/agents/investigation_agent/tool_registry.py` -- `INVESTIGATION_TOOL_REGISTRY` with timeout metadata (H4)
- `backend/app/agents/investigation_agent/formatters.py` -- `format_for_agent()` functions per tool result

**Files to modify**:
- `backend/app/schemas/tiered_investigation_schemas.py` -- add `ToolResultBase` and all result subclasses (M1: consolidated here, no separate `tool_models.py`)
- `backend/app/agents/admin_assistant/tools/tool_registry.py:373-382` -- update `generate_investigation_report` entry

**Schema consolidation (M1)**: All tool result models go in `tiered_investigation_schemas.py` alongside existing tier 1/2/3 models. This prevents model duplication and keeps the investigation schema in one place.

**Tool I/O normalization (M2)**: Every tool:
1. Takes typed Pydantic params (not raw strings).
2. Returns a typed Pydantic model (subclass of `ToolResultBase`).
3. The framework serializes the return model to JSON for `ToolMessage.content`.
4. The `post_tool_extractor` node deserializes `ToolMessage.content` back into typed models.

**Investigation Tool Implementations**:

1. **`get_enterprise_snapshot(enterprise_name: str) -> EnterpriseSnapshotResult`**
   - Wraps `service._find_enterprise_members()` (line 540)
   - Calls `_parse_enterprise_grouping_records()` + `detect_all_signals()` (WP2)
   - Returns typed `EnterpriseSnapshotResult`
   - ALWAYS called first (system prompt enforces this)

2. **`deep_dive_mids(mids: list[str], focus_areas: list[str]) -> DeepDiveResult`**
   - Max 20 MIDs per call (validated by Pydantic)
   - Only collects requested focus areas
   - Wraps existing collection methods from `service.py`

3. **`check_orders_and_installations(mids: list[str]) -> OrdersResult`**
   - Wraps `service._collect_orders()` and `_collect_tasks()`

4. **`search_cancellations(mids: list[str]) -> CancellationSearchResult`**
   - Single bulk query from `tiered_interfaces.py:272`

5. **`check_unbatched_status(mids: list[str]) -> UnbatchedSearchResult`**
   - Wraps DailyNewUnbatchedMerchantsList Foundry search

6. **`search_jira(query: str) -> JiraSearchResult`**
   - Wraps existing Jira service

7. **`check_contact_center(mids: list[str]) -> ContactCenterResult`**
   - Wraps `service._collect_nice()`

8. **`query_foundry_object(object_type: str, filter_field: str, filter_value: str, max_records: int) -> FoundryQueryResult`**
   - Generic escape hatch for any Foundry object type

9. **`emit_report(title: str, executive_summary: str, sections_json: str, appendix: str) -> EmitReportResult`**
   - Validates sections into `list[ReportSection]`
   - Constructs `ReportArtifactPayload`
   - Sets `report_emitted` and `report_payload` via post_tool_extractor

**Knowledge Base Tool Implementations**:

10. **`search_past_investigations(query: str, limit: int = 5) -> PastInvestigationSearchResult`**
    - Embeds query with text-embedding-3-small
    - Runs pgvector cosine similarity search on `investigation_embeddings`
    - Returns top-N matching past investigations with similarity scores
    - Available to both investigation agent AND admin agent

11. **`get_investigation_detail(investigation_id: str) -> InvestigationDetailResult`**
    - Queries `investigation_registry` + `investigation_evidence` tables
    - Returns full detail: key_findings, flagged_mids, evidence_summary, tags
    - Checks Redis cache first for recent investigations

12. **`find_similar_patterns(enterprise_name: str) -> SimilarPatternsResult`**
    - Queries `investigation_registry` for past investigations of this enterprise
    - Cross-references signal patterns via embeddings
    - Returns matches with similarity scores and outcome summaries

**Tool Registry (H4)**:

```python
# backend/app/agents/investigation_agent/tool_registry.py

INVESTIGATION_TOOL_REGISTRY: dict[str, ToolMetadata] = {
    "get_enterprise_snapshot": ToolMetadata(
        name="get_enterprise_snapshot",
        timeout_seconds=60,
        safe_for_parallel=True,
        category="data_collection",
    ),
    "deep_dive_mids": ToolMetadata(
        name="deep_dive_mids",
        timeout_seconds=180,
        safe_for_parallel=False,
        category="data_collection",
    ),
    "check_orders_and_installations": ToolMetadata(
        name="check_orders_and_installations",
        timeout_seconds=120,
        safe_for_parallel=True,
        category="data_collection",
    ),
    "search_cancellations": ToolMetadata(
        name="search_cancellations",
        timeout_seconds=60,
        safe_for_parallel=True,
        category="data_collection",
    ),
    "check_unbatched_status": ToolMetadata(
        name="check_unbatched_status",
        timeout_seconds=60,
        safe_for_parallel=True,
        category="data_collection",
    ),
    "search_jira": ToolMetadata(
        name="search_jira",
        timeout_seconds=30,
        safe_for_parallel=True,
        category="data_collection",
    ),
    "check_contact_center": ToolMetadata(
        name="check_contact_center",
        timeout_seconds=120,
        safe_for_parallel=True,
        category="data_collection",
    ),
    "query_foundry_object": ToolMetadata(
        name="query_foundry_object",
        timeout_seconds=60,
        safe_for_parallel=True,
        category="data_collection",
    ),
    "emit_report": ToolMetadata(
        name="emit_report",
        timeout_seconds=10,
        safe_for_parallel=False,
        category="output",
    ),
    "search_past_investigations": ToolMetadata(
        name="search_past_investigations",
        timeout_seconds=10,
        safe_for_parallel=True,
        category="knowledge_base",
    ),
    "get_investigation_detail": ToolMetadata(
        name="get_investigation_detail",
        timeout_seconds=10,
        safe_for_parallel=True,
        category="knowledge_base",
    ),
    "find_similar_patterns": ToolMetadata(
        name="find_similar_patterns",
        timeout_seconds=15,
        safe_for_parallel=True,
        category="knowledge_base",
    ),
}
```

**References**:
- `backend/app/agents/investigation_agent/service.py:121` -- `_foundry_search()` helper
- `backend/app/agents/investigation_agent/service.py:143` -- `_foundry_linked_objects()` helper
- `backend/app/agents/investigation_agent/service.py:540` -- `_find_enterprise_members()`
- `backend/app/schemas/tiered_investigation_schemas.py` -- all typed sub-models
- `backend/app/schemas/artifact_payloads/report_artifact.py` -- `ReportArtifactPayload`
- `backend/app/agents/framework/tool_registry.py:77` -- `ToolMetadata`

---

### WP4: Investigation Agent Graph

**Goal**: Implement `InvestigationGraph` as a `SpecializedAgentGraph` subclass. Addresses H1 (mids/focus_areas in state), H3 (post_tool_extractor implementation).

**Files to create**:
- `backend/app/agents/investigation_agent/graph.py` -- `InvestigationGraph` class

**Files to modify**:
- `backend/app/agents/investigation_agent/state.py` -- rewrite to `InvestigationAgentState` TypedDict + `InvestigationInput` model (in `tiered_investigation_schemas.py`)

**Implementation**:

```python
class InvestigationGraph(SpecializedAgentGraph):
    def __init__(self):
        super().__init__(SpecializedAgentConfig(
            agent_name="investigation_agent",
            model_use_case=ModelUseCase.INVESTIGATION,
            invocation_key="investigation_agent",
            max_iterations=8,
            langfuse_trace_name="investigation-agent",
        ))

    def get_tools(self) -> list[BaseTool]:
        from app.agents.investigation_agent.tools import (
            get_enterprise_snapshot,
            deep_dive_mids,
            check_orders_and_installations,
            search_cancellations,
            check_unbatched_status,
            search_jira,
            check_contact_center,
            query_foundry_object,
            emit_report,
        )
        from app.agents.investigation_agent.knowledge_tools import (
            search_past_investigations,
            get_investigation_detail,
            find_similar_patterns,
        )
        return [
            get_enterprise_snapshot, deep_dive_mids,
            check_orders_and_installations, search_cancellations,
            check_unbatched_status, search_jira,
            check_contact_center, query_foundry_object, emit_report,
            search_past_investigations, get_investigation_detail,
            find_similar_patterns,
        ]

    def get_tool_registry(self) -> dict[str, ToolMetadata]:
        from app.agents.investigation_agent.tool_registry import INVESTIGATION_TOOL_REGISTRY
        return INVESTIGATION_TOOL_REGISTRY

    def get_system_prompt(self, state: dict) -> str:
        from app.agents.investigation_agent.prompts import build_agent_system_prompt
        return build_agent_system_prompt(
            enterprise_name=state.get("enterprise_name", "Unknown"),
            investigation_type=state.get("investigation_type", "custom"),
            user_context=state.get("user_context", ""),
            mids=state.get("mids", []),             # (H1)
            focus_areas=state.get("focus_areas", []),  # (H1)
        )

    def get_state_class(self) -> type:
        return InvestigationAgentState

    def build_initial_state(self, input_model: InvestigationInput) -> dict:
        investigation_id = str(uuid4())
        return {
            "messages": [HumanMessage(content=(
                f"Investigate {input_model.enterprise_name}. "
                f"Investigation type: {input_model.investigation_type.value}. "
                f"{'User context: ' + input_model.user_context if input_model.user_context else ''}"
                f"{'Focus MIDs: ' + ', '.join(input_model.mids) if input_model.mids else ''}"
                f"{'Focus areas: ' + ', '.join(input_model.focus_areas) if input_model.focus_areas else ''}"
            ))],
            "enterprise_name": input_model.enterprise_name,
            "investigation_type": input_model.investigation_type.value,
            "user_context": input_model.user_context,
            "mids": input_model.mids,                # (H1)
            "focus_areas": input_model.focus_areas,    # (H1)
            "session_id": input_model.session_id,
            "chat_session_id": input_model.chat_session_id,
            "user_id": input_model.user_id,
            "max_iterations": input_model.max_iterations,
            "iteration_count": 0,
            "investigation_id": investigation_id,
            "enterprise_snapshot": "",
            "evidence_log": [],
            "tools_called": [],
            "mids_investigated": [],
            "report_payload": "",
            "report_emitted": False,
            "error": "",
            "past_investigation_context": "",
        }

    def extract_tool_results(self, state: dict, tool_messages: list) -> dict:
        """(H3) Parse ToolMessages into typed state fields.
        Called by post_tool_extractor after each tool_node execution."""
        updates: dict = {
            "evidence_log": list(state.get("evidence_log", [])),
            "tools_called": list(state.get("tools_called", [])),
            "mids_investigated": list(state.get("mids_investigated", [])),
        }

        for msg in tool_messages:
            tool_name = msg.name
            updates["tools_called"].append(tool_name)

            try:
                result_data = json.loads(msg.content)
            except json.JSONDecodeError:
                updates["evidence_log"].append(f"[{tool_name}] {msg.content[:500]}")
                continue

            # Append summary to evidence log
            summary = result_data.get("summary", msg.content[:500])
            updates["evidence_log"].append(f"[{tool_name}] {summary}")

            # Handle specific tools
            if tool_name == "emit_report":
                updates["report_emitted"] = True
                updates["report_payload"] = result_data.get("report_payload", "")

            elif tool_name == "get_enterprise_snapshot":
                updates["enterprise_snapshot"] = msg.content

            elif tool_name == "deep_dive_mids":
                mids_requested = result_data.get("mids_requested", [])
                updates["mids_investigated"].extend(mids_requested)

            elif tool_name == "search_past_investigations":
                updates["past_investigation_context"] = summary

        return updates

    async def on_completion(self, state: dict) -> None:
        """(H6) Persist investigation to registry + evidence store + embeddings."""
        from app.agents.investigation_agent.persistence import persist_investigation
        await persist_investigation(state)
```

**References**:
- `backend/app/agents/assistant/graph.py:751` -- `agent_node` pattern
- `backend/app/agents/assistant/graph.py:1051` -- `should_continue` pattern
- `backend/app/agents/base_state.py:18` -- `BaseAgentState` TypedDict

---

### WP5: Investigation Agent Prompt

**Goal**: Write the system prompt that guides the Opus agent through the investigation. Incorporates H1 (mids/focus_areas sections).

**Files to modify**:
- `backend/app/agents/investigation_agent/prompts.py` -- add `build_agent_system_prompt()`; keep existing `build_synthesis_prompt()` for backward compatibility

**System prompt structure**:

```
You are an expert investigation analyst for Shift4 Payments.

## YOUR ROLE
You investigate enterprises by calling tools to gather evidence, then
produce a comprehensive report. You are methodical, thorough, and
citation-obsessive. Your reasoning is visible to the user in real time --
explain what you are doing and why as you work.

## INVESTIGATION: {template.label}
Enterprise: {enterprise_name}
Tone: {template.narrative_tone}
{user_context_section}

{mids_section -- if user specified MIDs}
## USER-SPECIFIED MIDs
The user has specified these MIDs for investigation: {mids}
Focus on these MIDs. You may discover related MIDs but prioritize the
user's list. Use deep_dive_mids with these MIDs first.

{focus_areas_section -- if user specified focus areas}
## USER-SPECIFIED FOCUS AREAS
The user has requested focus on: {focus_areas}
Prioritize these areas in your deep-dives. Other areas may be investigated
if you discover relevant signals.

## AVAILABLE TOOLS
1. get_enterprise_snapshot -- ALWAYS call this FIRST
   Returns: portfolio-level distributions, signals, flagged MIDs
2. deep_dive_mids -- targeted per-MID investigation
   Max 20 MIDs, specify focus areas to limit token usage
3. check_orders_and_installations -- stalled orders, pending shipments
4. search_cancellations -- recent cancellation activity
5. check_unbatched_status -- settlement issues
6. search_jira -- engineering issues and tickets
7. check_contact_center -- NICE/InContact support patterns
8. query_foundry_object -- generic Foundry escape hatch
9. emit_report -- produce the final report artifact
10. search_past_investigations -- search accumulated knowledge base
    Use this when you suspect a pattern may have been seen before
11. get_investigation_detail -- pull full evidence from a past investigation
12. find_similar_patterns -- find enterprises with similar signal patterns

## INVESTIGATION PROTOCOL

1. ALWAYS start with get_enterprise_snapshot(). This gives you the
   portfolio-level view: distributions, signals, flagged MIDs.

2. CHECK INSTITUTIONAL MEMORY. Call search_past_investigations() or
   find_similar_patterns() if the enterprise or signal patterns look
   familiar. Past findings may save time and provide context.

3. ANALYZE the snapshot. Identify:
   - Which MIDs are flagged and why
   - Which signal categories dominate
   - What the distributions reveal about portfolio health

4. INVESTIGATE based on what you see:
   - High volume decline? deep_dive_mids with focus=["volume"]
   - Cancellation signals? search_cancellations
   - Support issues? check_contact_center
   - Stalled orders? check_orders_and_installations
   - Engineering problems? search_jira

5. CONNECT THE DOTS. Look for correlations:
   - Volume decline + high cases = possible service failure
   - Cancellations + unbatched = possible billing/settlement issue
   - Stalled orders + Jira tickets = possible engineering blocker

6. When you have enough evidence, call emit_report() with a
   structured report that includes metrics, findings with citations,
   and recommendations.

## REPORT FORMAT
[ReportArtifactPayload section structure]
[Citation requirements: every finding needs >=1 source]
[Metric card format]

## REASONING REQUIREMENTS
Before each tool call, explain:
- What you observed in previous results
- Why you are calling this specific tool
- What you expect to find

This reasoning is streamed to the user in real time.
They can see your detective work happening.
```

**Template-specific sections**: Each `InvestigationType` gets additional prompt sections:
- `POST_MORTEM`: "Focus on root cause. Build a timeline of decline."
- `AT_RISK_REVIEW`: "Focus on early warning signals. Quantify risk."
- `QBR_PREP`: "Focus on wins and growth. Positive framing."
- `ESCALATION`: "Focus on incident timeline. Identify responsible parties."
- `ONBOARDING_REVIEW`: "Focus on setup quality. First 90 days trajectory."

**References**:
- `backend/app/agents/investigation_agent/prompts.py:13` -- existing `build_synthesis_prompt()`
- `backend/app/schemas/investigation_schemas.py:64` -- `INVESTIGATION_TEMPLATES`
- `backend/app/schemas/artifact_payloads/report_artifact.py:156` -- `ReportArtifactPayload` structure

---

### WP6: Investigation Registry + Evidence Store

**Goal**: Implement the Intelligence Platform persistence layer: Postgres tables, Redis caching, Alembic migration.

**Files to create**:
- `backend/alembic/versions/XXXX_add_investigation_registry.py` -- Alembic migration for all 3 tables
- `backend/app/models/investigation_models.py` -- SQLAlchemy ORM models for investigation_registry, investigation_evidence, investigation_embeddings
- `backend/app/agents/investigation_agent/persistence.py` -- `persist_investigation()`, `cache_evidence()`, Redis read/write helpers
- `backend/app/agents/investigation_agent/evidence_service.py` -- `InvestigationEvidenceService` for CRUD operations

**Alembic migration**:

```python
def upgrade():
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Layer 1: Investigation Registry
    op.create_table(
        "investigation_registry",
        sa.Column("investigation_id", sa.dialects.postgresql.UUID, primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("enterprise_name", sa.String(500), nullable=False),
        sa.Column("investigation_type", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("created_by", sa.dialects.postgresql.UUID,
                  sa.ForeignKey("app_state.users.id"), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("mid_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("finding_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("risk_level", sa.String(20), nullable=False, server_default="'unknown'"),
        sa.Column("key_findings", sa.dialects.postgresql.JSONB, nullable=False,
                  server_default="'[]'::jsonb"),
        sa.Column("flagged_mids", sa.dialects.postgresql.JSONB, nullable=False,
                  server_default="'[]'::jsonb"),
        sa.Column("enterprise_manager", sa.String(200), nullable=True),
        sa.Column("tags", sa.dialects.postgresql.JSONB, nullable=False,
                  server_default="'[]'::jsonb"),
        sa.Column("report_payload", sa.dialects.postgresql.JSONB, nullable=True),
        sa.Column("session_id", sa.dialects.postgresql.UUID, nullable=True),
        sa.Column("chat_session_id", sa.dialects.postgresql.UUID,
                  sa.ForeignKey("app_state.chat_sessions.id"), nullable=True),
        schema="app_state",
    )
    # ... indexes, evidence table, embeddings table (see Section 3.5)

def downgrade():
    op.drop_table("investigation_embeddings", schema="app_state")
    op.drop_table("investigation_evidence", schema="app_state")
    op.drop_table("investigation_registry", schema="app_state")
```

**Persistence flow**:

```python
# backend/app/agents/investigation_agent/persistence.py

async def persist_investigation(state: dict) -> None:
    """Called by on_completion(). Writes to all 3 layers."""

    # 1. Write to investigation_registry
    registry_entry = InvestigationRegistryCreate(
        investigation_id=state["investigation_id"],
        enterprise_name=state["enterprise_name"],
        investigation_type=state["investigation_type"],
        created_by=state.get("user_id"),
        mid_count=len(state.get("mids_investigated", [])),
        finding_count=_count_findings(state.get("report_payload", "")),
        risk_level=_extract_risk_level(state.get("report_payload", "")),
        key_findings=_extract_key_findings(state.get("report_payload", "")),
        flagged_mids=state.get("mids_investigated", []),
        report_payload=json.loads(state.get("report_payload", "{}")),
        session_id=state.get("session_id"),
        chat_session_id=state.get("chat_session_id"),
    )
    await _insert_registry(registry_entry)

    # 2. Write evidence to investigation_evidence
    for i, evidence_entry in enumerate(state.get("evidence_log", [])):
        tool_name = _extract_tool_name(evidence_entry)
        await _insert_evidence(state["investigation_id"], tool_name, evidence_entry)

    # 3. Embed findings for semantic search
    findings = _extract_key_findings(state.get("report_payload", ""))
    for idx, finding in enumerate(findings):
        embedding = await _embed_text(finding)
        await _insert_embedding(state["investigation_id"], idx, finding, embedding)

    # 4. Cache in Redis for hot access
    await _cache_to_redis(state)


async def _cache_to_redis(state: dict) -> None:
    """Cache investigation state and evidence in Redis with 7-day TTL."""
    investigation_id = state["investigation_id"]
    ttl = 604800  # 7 days

    await redis.set(
        f"investigation:{investigation_id}:state",
        json.dumps(state, default=str),
        ex=ttl,
    )
    await redis.set(
        f"investigation:{investigation_id}:evidence",
        json.dumps(state.get("evidence_log", []), default=str),
        ex=ttl,
    )
```

**References**:
- `backend/alembic/env.py` -- Alembic environment (app_state schema filter)
- `backend/app/models/` -- existing ORM models
- `backend/app/core/database.py` -- database session factory

---

### WP7: Semantic Search

**Goal**: Implement pgvector-based semantic search across past investigation findings.

**Files to create**:
- `backend/app/agents/investigation_agent/semantic_search.py` -- embedding + similarity search logic

**Dependencies**: WP6 (tables must exist), WP3 (knowledge base tools call this)

**Implementation**:

```python
# backend/app/agents/investigation_agent/semantic_search.py

class EmbeddingService:
    """Handles text embedding and similarity search for investigations."""

    MODEL = "text-embedding-3-small"  # Already configured in the project
    DIMENSION = 1536

    async def embed_text(self, text: str) -> list[float]:
        """Embed a single text string using OpenAI text-embedding-3-small."""
        from openai import AsyncOpenAI
        client = AsyncOpenAI()
        response = await client.embeddings.create(
            model=self.MODEL,
            input=text,
        )
        return response.data[0].embedding

    async def search_similar_findings(
        self,
        query: str,
        limit: int = 5,
        min_similarity: float = 0.3,
    ) -> list[SimilarFinding]:
        """Search investigation_embeddings for similar findings."""
        query_embedding = await self.embed_text(query)

        # pgvector cosine similarity search
        results = await db.execute(
            text("""
                SELECT
                    ie.investigation_id,
                    ie.finding_index,
                    ie.finding_text,
                    ie.metadata,
                    1 - (ie.embedding <=> :query_embedding::vector) AS similarity
                FROM app_state.investigation_embeddings ie
                WHERE 1 - (ie.embedding <=> :query_embedding::vector) > :min_similarity
                ORDER BY ie.embedding <=> :query_embedding::vector
                LIMIT :limit
            """),
            {
                "query_embedding": str(query_embedding),
                "limit": limit,
                "min_similarity": min_similarity,
            },
        )
        return [SimilarFinding.from_row(row) for row in results]

    async def find_pattern_matches(
        self,
        enterprise_name: str,
        limit: int = 10,
    ) -> list[PatternMatch]:
        """Find past investigations with similar signal patterns.

        1. Get the most recent investigation for this enterprise.
        2. Use its findings as query vectors.
        3. Find similar findings from OTHER enterprises.
        """
        recent = await _get_recent_findings(enterprise_name)
        if not recent:
            return []

        matches = []
        for finding in recent[:5]:  # Top 5 findings as queries
            similar = await self.search_similar_findings(
                query=finding.finding_text,
                limit=limit,
            )
            for s in similar:
                if s.enterprise_name != enterprise_name:
                    matches.append(s)

        return _deduplicate_and_rank(matches)
```

**Insights Artifact Integration**:

Investigation findings can be promoted to SavedInsights for the Insights Hub:

```python
async def promote_finding_to_insight(
    investigation_id: str,
    finding_index: int,
    organization_id: str,
) -> SavedInsight:
    """Promote an investigation finding to a SavedInsight.

    Uses source_type='chat_pin' (existing constraint-compatible value)
    with metadata linking back to the investigation.
    """
    finding = await _get_finding(investigation_id, finding_index)
    insight = SavedInsight(
        source_type="chat_pin",
        organization_id=organization_id,
        title=f"Investigation Finding: {finding.title}",
        summary=finding.text,
        metadata={
            "investigation_id": investigation_id,
            "finding_index": finding_index,
            "promoted_from": "investigation",
        },
    )
    return await insight_service.save(insight)
```

**References**:
- `backend/app/services/insight_generation_service.py` -- existing insight service
- OpenAI embeddings: already configured in the project (text-embedding-3-small)

---

### WP8: Admin Bridge + Streaming

**Goal**: Connect the existing admin tool to the new agentic graph, enable WS v2 streaming of the ReAct loop, and provide context continuity for follow-up questions.

**Files to modify**:
- `backend/app/agents/admin_assistant/tools/investigation_tools.py` -- rewrite `generate_investigation_report` to call `InvestigationGraph.ainvoke()` with streaming callbacks
- `backend/app/agents/admin_assistant/tools/tool_registry.py` -- add knowledge base tools to admin tool registry
- `backend/app/agents/framework/ws_streaming.py` (or existing WS handler) -- add investigation-specific WS event types

**Admin Bridge Changes**:

```python
# BEFORE (pipeline):
service = InvestigationService()
report_payload = await service.run(request)

# AFTER (agentic graph with streaming):
from app.agents.investigation_agent.graph import InvestigationGraph

graph = InvestigationGraph()
input_model = InvestigationInput(
    enterprise_name=enterprise_name.strip(),
    investigation_type=inv_type,
    user_context=user_context.strip(),
    mids=user_specified_mids,        # (H1)
    focus_areas=user_specified_focus,  # (H1)
    session_id=session_id,
    chat_session_id=chat_session_id,
    user_id=user_id,
)

# (H5) Pass streaming callbacks + Langfuse handler
result = await graph.ainvoke(
    input_model,
    callbacks=[streaming_callback],
    langfuse_handler=langfuse_handler,
)

if result.get("report_emitted") and result.get("report_payload"):
    report_data = json.loads(result["report_payload"])
    report_payload = ReportArtifactPayload.model_validate(report_data)
else:
    return {"error": True, "error_message": "Investigation did not produce a report."}
```

**WS v2 Streaming Events**:

The investigation agent emits these WS events during execution:

```python
# Streamed during agent_node (reasoning tokens)
{"type": "agent_thinking", "content": "I can see 40% of MIDs declining..."}

# Streamed during tool_node (tool lifecycle)
{"type": "tool_start", "tool": "deep_dive_mids", "args": {"mids": [...], "focus_areas": [...]}}
{"type": "tool_progress", "tool": "deep_dive_mids", "status": "Querying volume for 10 MIDs..."}
{"type": "tool_complete", "tool": "deep_dive_mids", "summary": "10 MIDs profiled, 3 critical volume declines"}

# Streamed when post_tool_extractor identifies notable findings
{"type": "investigation_finding", "finding": {"severity": "critical", "text": "MID 0021773366 volume -67%"}}

# Final report artifact
{"type": "artifact", "artifact_type": "report", "payload": {...}}
```

**Admin Agent Context Continuity**:

After investigation completes:
1. Investigation evidence summary is cached in Redis (7 days).
2. Admin agent has `search_past_investigations` and `get_investigation_detail` tools.
3. Admin can ask follow-up questions: "Tell me more about the volume decline at TAO NYC" -- the admin agent uses `get_investigation_detail` to pull evidence from the completed investigation without re-running it.
4. The investigation_id is stored in the chat session context for seamless reference.

**Knowledge Base Tools for Admin Agent**:

```python
# Added to admin tool registry
"search_past_investigations": ToolMetadata(
    name="search_past_investigations",
    timeout_seconds=10,
    safe_for_parallel=True,
    category="knowledge_base",
),
"get_investigation_detail": ToolMetadata(
    name="get_investigation_detail",
    timeout_seconds=10,
    safe_for_parallel=True,
    category="knowledge_base",
),
```

**Backward compatibility**: The return format stays identical: `{"type": "investigation_report", "report": {...}}`. The artifact middleware (`_wrap_report` at `artifact_middleware.py:574`) requires no changes. The old `InvestigationService` stays in `service.py` as-is for rollback.

**References**:
- `backend/app/agents/admin_assistant/tools/investigation_tools.py:28` -- current `generate_investigation_report`
- `backend/app/agents/assistant/artifact_middleware.py:574` -- `_wrap_report()`
- `backend/app/agents/admin_assistant/tools/tool_registry.py:373` -- registry entry

---

### WP9: Evidence Formatters

**Goal**: Format tool results into concise, LLM-friendly text for the agent's context window. Token-budget-aware.

**Files to create**:
- `backend/app/agents/investigation_agent/formatters.py`

**Design**: Each tool result model has a corresponding `format_for_agent()` function that produces a concise text summary. These summaries are:
1. Returned as the tool's `ToolMessage.content` (what the agent sees).
2. Appended to `evidence_log` in state (for observability).

**Formatting principles**:
- **Tables, not prose**: Use ASCII tables for tabular data.
- **Numbers, not descriptions**: "$1.2M 28d volume, -23% WoW" not "one point two million..."
- **Top-N, not exhaustive**: For 1,282 MIDs, show top 10 flagged, not all.
- **Citation-ready**: Every data point includes its source.
- **Budget**: Each tool output capped at ~4,000 tokens. Configurable per tool via `FormatterConfig`.

**Token Budget System**:

```python
class FormatterConfig(BaseModel):
    """Configuration for evidence formatting."""
    model_config = ConfigDict(extra="forbid")

    max_tokens: int = Field(default=4000, ge=100, le=16000)
    top_n_mids: int = Field(default=10, ge=1, le=50)
    include_distributions: bool = True
    include_signal_detail: bool = True
    truncation_notice: str = "[{omitted} additional records omitted -- use deep_dive_mids for details]"


# Per-tool formatter configs
FORMATTER_CONFIGS: dict[str, FormatterConfig] = {
    "get_enterprise_snapshot": FormatterConfig(max_tokens=6000, top_n_mids=10),
    "deep_dive_mids": FormatterConfig(max_tokens=4000, top_n_mids=20),
    "search_cancellations": FormatterConfig(max_tokens=2000),
    "check_contact_center": FormatterConfig(max_tokens=3000),
    "search_past_investigations": FormatterConfig(max_tokens=2000, top_n_mids=5),
    # ... etc
}
```

**Example formatter for `EnterpriseSnapshotResult`**:

```
## Enterprise Snapshot: TAO GROUP
**87 MIDs** (72 active) | Manager: Kellie McQuillin | Parent: TAO Group Inc.

### Distribution Summary
| Dimension | Key Finding |
|-----------|-------------|
| Status    | 83% active, 17% inactive |
| Volume    | 40% zero 28d, 12% declining >20% |
| Health    | Median 62, 8 MIDs below 40 |
| Geographic| NY (34), NV (22), CA (15) |
| Equipment | 51% SkyTab, 23% Legacy, 26% None |

### Signal Summary: 23 signals across 18 flagged MIDs (21%)
| Category      | Signals | Critical | High | Affected MIDs |
|---------------|---------|----------|------|---------------|
| Volume        | 12      | 3        | 5    | 10            |
| Cancellation  | 3       | 3        | 0    | 3             |
| Support       | 5       | 0        | 2    | 4             |
| Unbatched     | 3       | 1        | 1    | 2             |

### Top 5 Flagged MIDs (by risk score)
| MID | DBA | Risk | Score | Top Signal |
|-----|-----|------|-------|------------|
| 0021773366 | TAO LV | critical | 85 | Volume -67% + cancellation |
| 0021773367 | TAO NYC | high | 62 | Volume -45% + 5 active cases |
...

All 87 MIDs available. Call deep_dive_mids() to investigate specific MIDs.
```

**References**:
- `backend/app/agents/investigation_agent/service.py:480` -- existing `_format_data_for_llm()`
- `backend/app/schemas/tiered_investigation_schemas.py:303` -- `EnterpriseDistribution`
- `backend/app/schemas/tiered_investigation_schemas.py:460` -- `SignalAnalysis`

---

### WP10: Verification

**Goal**: Verify the full pipeline with golden fixtures (regression) and live tests (integration). Addresses M4.

**Files to create**:
- `scripts/test_investigation_tools.py` -- individual tool smoke tests
- `scripts/test_investigation_agent.py` -- full agent integration tests
- `scripts/test_signal_engine.py` -- golden fixture regression tests for all 6 detectors
- `scripts/test_knowledge_base.py` -- knowledge base tool integration tests
- `scripts/fixtures/volume_decline.json` -- golden fixture
- `scripts/fixtures/zscore_anomaly.json` -- golden fixture
- `scripts/fixtures/device_inactive.json` -- golden fixture
- `scripts/fixtures/cancellation_detect.json` -- golden fixture
- `scripts/fixtures/unbatched_flag.json` -- golden fixture
- `scripts/fixtures/stalled_orders.json` -- golden fixture

**Test Layers**:

**Layer 1: Golden Fixture Tests (M4)**
- Each Tier 2 detector has a self-contained fixture file.
- Test loads fixture, runs detector, asserts exact expected flags.
- No API calls, no network. Pure Python regression tests.
- Run: `python scripts/test_signal_engine.py`

**Layer 2: Tool-Level Smoke Tests**
- Each of the 12 tools tested individually against live Foundry/Jira.
- Verifies: typed return, `success=True`, reasonable `record_count`, `duration_ms` within timeout.
- Run: `python scripts/test_investigation_tools.py --tool <name> --enterprise <name>`

**Layer 3: Agent-Level Integration Tests**
- Full agent runs against 4 enterprise targets.
- Verifies: >=3 tool calls, report emitted, sections/findings/recommendations present.
- Run: `python scripts/test_investigation_agent.py --enterprise <name> --type <type>`

**Layer 4: Knowledge Base Integration Tests**
- Run 2+ investigations, then test knowledge base tools.
- Verifies: `search_past_investigations` returns relevant results, `get_investigation_detail` returns full evidence, `find_similar_patterns` finds matches.
- Run: `python scripts/test_knowledge_base.py`

**Layer 5: Streaming Verification**
- WS v2 client connects, triggers investigation, verifies event sequence.
- Expected: `agent_thinking` -> `tool_start` -> `tool_complete` -> ... -> `artifact`.
- Run: Playwright test or manual WS client.

**Live Test Matrix**:

| Enterprise | MIDs | Investigation Type | Layer 2 | Layer 3 | Performance Target |
|------------|------|-------------------|---------|---------|-------------------|
| Starlink | 6 | post_mortem | All 12 tools | Full agent | <60s |
| TAO GROUP | 87 | at_risk_review | All 12 tools | Full agent | <90s |
| NANDOS | 47 | qbr_prep | All 12 tools | Full agent | <120s |
| Compass Group | 1,282 | custom | Snapshot + signal engine | Full agent | <180s |

**Verification steps per agent test**:

1. **Tool-level**: Each tool returns typed model, no exceptions, `success=True`.
2. **Agent-level**: Agent calls >=3 tools, produces `ReportArtifactPayload`, `report_emitted=True`.
3. **Content-level**: Report has `executive_summary`, >=3 `sections`, >=1 `findings` section, >=1 `recommendations` section.
4. **Citation-level**: Every finding has >=1 `sources` entry.
5. **Performance**: Within targets above.
6. **Observability**: Langfuse trace with name `investigation-agent`, tool spans, iteration count.
7. **Registry**: Investigation persisted to `investigation_registry` with correct metadata.
8. **Embeddings**: Findings embedded in `investigation_embeddings`.

**Regression check**: Run the old pipeline (`InvestigationService().run()`) for the same enterprises and compare report quality manually. The old service stays untouched for A/B comparison.

**References**:
- `scripts/test_credentials.py` -- authentication pattern for test scripts
- `backend/app/agents/investigation_agent/service.py:523` -- `InvestigationService.run()` for A/B baseline

---

## 6. Execution Order (DAG)

```
WP1 (Framework Base Class)
  |
  +--------+--------+
  |        |        |
  v        v        v
WP2      WP3      WP5 (Prompt)
(Signal) (Tools)    |
  |        |        |
  v        v        v
  +--------+--------+
           |
           v
         WP4 (Investigation Graph)
           |
           v
         WP6 (Registry + Evidence Store) ----> WP7 (Semantic Search)
           |                                      |
           v                                      v
         WP9 (Formatters) <-----------------------+
           |
           v
         WP8 (Admin Bridge + Streaming)
           |
           v
         WP10 (Verification)
```

### Rationale

1. **WP1 first**: The framework base class defines the contract (including H3 post_tool_extractor, H4 tool registry, H5 streaming/cancellation/observability, H6 sub-investigation dispatch). Everything depends on it.

2. **WP2, WP3, WP5 in parallel after WP1**:
   - WP2 (Signal Engine): Pure Python detectors, no graph dependency. Can be tested independently with golden fixtures.
   - WP3 (Tools): Wraps existing data collection logic. Depends on WP1 for `ToolMetadata` but not on the graph.
   - WP5 (Prompt): Can be written as soon as the tool list is known from WP3's interface.

3. **WP4 after WP1 + WP2 + WP3 + WP5**: The graph ties everything together -- base class (WP1), signal engine (WP2), tools (WP3), prompt (WP5).

4. **WP6 after WP4**: Registry/evidence store is written by `on_completion()` in the graph. Needs the graph to be working to know what data flows through.

5. **WP7 after WP6**: Semantic search reads from the tables WP6 creates.

6. **WP9 alongside WP6/WP7**: Formatters depend on tool result models (WP3) but can be developed in parallel with persistence.

7. **WP8 after WP4 + WP6 + WP7 + WP9**: The bridge connects everything: graph invocation, streaming callbacks, knowledge base tools for admin agent. Requires all layers to be ready.

8. **WP10 last**: End-to-end verification requires everything to be integrated.

### Estimated Effort

| WP | Description | Effort | Dependencies |
|----|-------------|--------|-------------|
| WP1 | Specialized Agent Framework | 4-5 hours | None |
| WP2 | Tier 2 Signal Engine | 3-4 hours | WP1 (ToolMetadata) |
| WP3 | Investigation Tools (12) | 5-7 hours | WP1 |
| WP4 | Investigation Agent Graph | 3-4 hours | WP1, WP2, WP3, WP5 |
| WP5 | Agent System Prompt | 1-2 hours | WP3 (tool list) |
| WP6 | Registry + Evidence Store | 4-5 hours | WP4 |
| WP7 | Semantic Search | 3-4 hours | WP6 |
| WP8 | Admin Bridge + Streaming | 3-4 hours | WP4, WP6, WP7, WP9 |
| WP9 | Evidence Formatters | 2-3 hours | WP3 (tool models) |
| WP10 | Verification | 4-5 hours | WP8 |
| **Total** | | **33-43 hours** | |

---

## 7. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | **Opus token cost explosion**: ReAct loop with Opus at $15/M-input, $75/M-output means a 10-iteration investigation with full evidence log could cost $5-10 per run | Medium | High | (a) Formatters (WP9) aggressively truncate tool results to ~4K tokens each. (b) Evidence log uses summaries, not raw data. (c) Max iterations defaults to 8. (d) Admin can set `max_iterations` per request. (e) Langfuse cost tracking alerts at >$3/trace. |
| R2 | **Agent never calls emit_report**: Opus gets stuck in a reasoning loop, calling tools repeatedly without producing output | Low | High | (a) Max iterations with forced synthesis at limit-1: inject "You must now call emit_report with your evidence" message. (b) Hard limit at max_iterations+1: inject stubs, return partial evidence as error. (c) System prompt explicitly instructs "call emit_report when you have enough evidence." |
| R3 | **Foundry rate limits**: 12 tools making parallel API calls could hit Foundry rate limits, especially for Compass Group (1,282 MIDs) | Medium | Medium | (a) `_SEMAPHORE_LIMIT = 10` from existing service.py. (b) `deep_dive_mids` max 20 MIDs per call. (c) Agent naturally throttles by calling tools sequentially (ReAct loop is serial). (d) Tool registry marks `deep_dive_mids` as `safe_for_parallel=False`. |
| R4 | **emit_report JSON parsing failure**: Opus produces malformed `sections_json` that fails `ReportArtifactPayload.model_validate()` | Medium | Medium | (a) `emit_report` tool catches `ValidationError` and returns structured error with specific validation failure. (b) Agent can retry with corrected JSON. (c) System prompt includes exact JSON schema for sections. (d) Fallback: if 2 attempts fail, construct minimal report from evidence log. |
| R5 | **Starlink not in enterprise grouping**: `get_enterprise_snapshot("STARLINK")` returns 0 MIDs because Starlink uses gateway/ISV pattern | High | Medium | (a) Tool falls back to `Merchant` object search if enterprise grouping returns 0 results. (b) Tool description tells agent to try with known MIDs. (c) `query_foundry_object` escape hatch for non-standard patterns. |
| R6 | **State bloat from evidence_log**: 8 iterations could accumulate 30-40K tokens in evidence_log | Medium | High | (a) Evidence log stores summaries (~500 tokens each), not raw results. (b) Formatter budget system (WP9) caps each tool output. (c) Agent prompt tells it to reference earlier evidence by citation. (d) If evidence exceeds 20K tokens, older entries are truncated. |
| R7 | **Backward compatibility**: Admin users expect the same report format from `generate_investigation_report` | Low | High | (a) Bridge tool returns identical format. (b) `ReportArtifactPayload` is the same model. (c) Artifact middleware `_wrap_report()` requires no changes. (d) Old `InvestigationService` kept intact for rollback. |
| R8 | **Framework over-abstraction**: `SpecializedAgentGraph` ABC becomes too rigid for future agents | Low | Medium | (a) ABC has 6 abstract methods + 1 optional override -- focused contract. (b) Subclasses can override `_build_graph()` entirely. (c) `ainvoke()` is the only public API. (d) Design review with second agent before freezing API. |
| R9 | **pgvector not available on RDS**: Production RDS may not have pgvector extension enabled | Medium | High | (a) Check RDS engine version supports pgvector (Aurora PostgreSQL 15.4+). (b) Migration includes `CREATE EXTENSION IF NOT EXISTS vector`. (c) Fallback: keyword search on `key_findings` JSONB with `@@` operator if pgvector unavailable. (d) Test on RDS dev first. |
| R10 | **Tool timeout**: `deep_dive_mids` with 20 MIDs and 8 focus areas could exceed 180s timeout | Medium | Medium | (a) Tool registry timeout set to 180s. (b) Focus areas are selective -- agent typically requests 2-3. (c) MID count cap at 20 enforced by Pydantic validation. (d) Fallback: return partial results with `success=True` and truncation note. |
| R11 | **Post-tool extractor parsing failure (H3)**: ToolMessage content is not valid JSON (LLM error, tool crash) | Low | Medium | (a) `extract_tool_results` catches `JSONDecodeError` and falls back to raw string in evidence_log. (b) Non-JSON content still tracked in `tools_called`. (c) Investigation continues -- one bad tool result does not crash the graph. |
| R12 | **Per-request graph compilation overhead (M3)**: Building a new graph per request adds latency | Low | Low | (a) Graph compilation is ~10ms (measured in assistant graph). (b) Negligible vs. LLM call latency (3-8s). (c) Ensures admin LLM overrides are always honored. |
| R13 | **Redis cache eviction**: 7-day TTL may be too short for some investigation follow-ups | Low | Low | (a) Postgres evidence store is permanent -- Redis is a hot cache optimization. (b) `get_investigation_detail` falls back to Postgres if Redis miss. (c) TTL can be extended per-investigation if needed. |
| R14 | **Embedding cost accumulation**: Each finding embedded costs ~$0.0001 -- at scale (100 investigations/month with 20 findings each) this is $0.20/month | Very Low | Very Low | (a) Cost is negligible. (b) text-embedding-3-small is already the cheapest model. (c) Batch embedding available if needed. |

---

## 8. File Inventory

### Files Created (18)

| File | WP | Purpose |
|------|-----|---------|
| `backend/app/agents/framework/specialized_agent.py` | WP1 | Base class for all specialized agents |
| `backend/app/agents/framework/cancellation.py` | WP1 | CancellationToken cooperative primitive |
| `backend/app/agents/investigation_agent/signal_engine.py` | WP2 | 6 signal detectors + orchestrator |
| `backend/app/agents/investigation_agent/tools.py` | WP3 | 9 investigation `@tool` functions |
| `backend/app/agents/investigation_agent/knowledge_tools.py` | WP3 | 3 knowledge base tools |
| `backend/app/agents/investigation_agent/tool_registry.py` | WP3 | Investigation-specific tool registry with timeouts |
| `backend/app/agents/investigation_agent/formatters.py` | WP9 | Token-budget-aware tool result formatters |
| `backend/app/agents/investigation_agent/graph.py` | WP4 | `InvestigationGraph` subclass |
| `backend/app/agents/investigation_agent/state.py` | WP4 | Rewrite: `InvestigationAgentState` TypedDict |
| `backend/app/models/investigation_models.py` | WP6 | SQLAlchemy ORM models for registry + evidence + embeddings |
| `backend/app/agents/investigation_agent/persistence.py` | WP6 | persist_investigation(), Redis cache helpers |
| `backend/app/agents/investigation_agent/evidence_service.py` | WP6 | CRUD for investigation evidence |
| `backend/app/agents/investigation_agent/semantic_search.py` | WP7 | Embedding + pgvector similarity search |
| `backend/alembic/versions/XXXX_add_investigation_registry.py` | WP6 | Alembic migration for all 3 tables + pgvector |
| `scripts/test_investigation_tools.py` | WP10 | Individual tool smoke tests |
| `scripts/test_investigation_agent.py` | WP10 | Full agent integration tests |
| `scripts/test_signal_engine.py` | WP10 | Golden fixture regression tests |
| `scripts/test_knowledge_base.py` | WP10 | Knowledge base integration tests |

### Fixture Files Created (6)

| File | WP | Detector |
|------|-----|---------|
| `scripts/fixtures/volume_decline.json` | WP2/WP10 | Volume decline detector |
| `scripts/fixtures/zscore_anomaly.json` | WP2/WP10 | Z-score anomaly detector |
| `scripts/fixtures/device_inactive.json` | WP2/WP10 | Device inactivity detector |
| `scripts/fixtures/cancellation_detect.json` | WP2/WP10 | Cancellation detector |
| `scripts/fixtures/unbatched_flag.json` | WP2/WP10 | Unbatched flag detector |
| `scripts/fixtures/stalled_orders.json` | WP2/WP10 | Stalled order detector |

### Files Modified (5)

| File | WP | Change |
|------|-----|--------|
| `backend/app/agents/framework/__init__.py` | WP1 | Export `SpecializedAgentGraph`, `SpecializedAgentConfig`, `SubInvestigationContract`, `CancellationToken` |
| `backend/app/schemas/tiered_investigation_schemas.py` | WP3 | Add `ToolResultBase` and all tool result subclasses, `InvestigationInput` (M1: consolidated) |
| `backend/app/agents/investigation_agent/prompts.py` | WP5 | Add `build_agent_system_prompt()` with mids/focus_areas sections; keep `build_synthesis_prompt()` |
| `backend/app/agents/admin_assistant/tools/investigation_tools.py` | WP8 | Rewrite to call `InvestigationGraph.ainvoke()` with streaming callbacks |
| `backend/app/agents/admin_assistant/tools/tool_registry.py` | WP8 | Add knowledge base tools to admin registry, update investigation entry timeout |

### Files Preserved (not modified)

| File | Reason |
|------|--------|
| `backend/app/agents/investigation_agent/service.py` | Old pipeline kept intact for rollback and as data collection library |
| `backend/app/agents/investigation_agent/tiered_interfaces.py` | Interface spec, tools implement these signatures |
| `backend/app/schemas/investigation_schemas.py` | Reused by tools, no changes needed |
| `backend/app/schemas/artifact_payloads/report_artifact.py` | Output model, no changes needed |
| `backend/app/agents/assistant/artifact_middleware.py` | `_wrap_report()` handles the same output format |
| `backend/app/core/models.py` | `INVESTIGATION` use case and `investigation_agent` invocation point already registered |

---

## 9. Out of Scope (Next Lifecycle)

These are explicitly deferred to the next development cycle:

1. **Nightly automated portfolio scans** -- scheduled investigation runs across all enterprises, triggered by Temporal.
2. **Insights Hub browsing interface** -- UI for browsing accumulated investigation intelligence (search, filter, timeline view).
3. **Alert/notification system** -- push notifications when newly detected patterns match historical red flags.
4. **Multi-enterprise comparison** -- side-by-side investigation of 2+ enterprises.
5. **Investigation templates as code** -- YAML-defined investigation protocols that can be versioned and shared.

---

## 10. Codex Finding Traceability

| Finding | Severity | Resolution | WP |
|---------|----------|------------|-----|
| H1: Add `mids` and `focus_areas` to `InvestigationInput` and graph state | High | Added to `InvestigationInput`, `InvestigationAgentState`, system prompt | WP4, WP5 |
| H2: Dedicated WP for Tier 2 signal engine with golden fixtures | High | WP2 created with 6 detectors, golden fixtures, AC22-AC28 | WP2, WP10 |
| H3: Post-tool state extractor node in graph | High | `post_tool_extractor` node added between tools and agent, `extract_tool_results()` abstract method | WP1, WP4 |
| H4: Investigation-specific tool registry with timeouts | High | `INVESTIGATION_TOOL_REGISTRY` with per-tool `ToolMetadata`, `get_tool_registry()` abstract method | WP1, WP3 |
| H5: Enrich base class with callbacks/streaming/cancellation/Langfuse/prompts | High | `ainvoke()` accepts callbacks, cancellation_token, langfuse_handler. Propagated through graph | WP1 |
| H6: `dispatch_sub_investigation` contract with parent/child state, merge rules, budgets | High | `SubInvestigationContract`, `SubInvestigationResult`, `dispatch_sub_investigation()`, `on_completion()` | WP1 |
| M1: Consolidate schemas -- reuse `tiered_investigation_schemas.py` | Medium | All tool result models in `tiered_investigation_schemas.py`, no `tool_models.py` | WP3 |
| M2: Normalize tool I/O -- typed params, Pydantic returns | Medium | Tools take typed Pydantic params, return typed models, framework serializes | WP3 |
| M3: Graphs per-request (not cached) for admin LLM overrides | Medium | `_build_graph()` called fresh each `ainvoke()`, no `self._compiled_graph` | WP1 |
| M4: Golden fixtures for Tier 2 regression testing | Medium | 6 fixture files, `test_signal_engine.py` regression test script | WP2, WP10 |

---

## 11. Future Agents (Template Consumers)

This spec establishes the pattern. Future agents that will use `SpecializedAgentGraph`:

| Agent | Tools | Model | Use Case |
|-------|-------|-------|----------|
| **Sales Intelligence** | prospect_search, competitor_lookup, deal_history, market_data, generate_brief | REASONING | Prospect research for enterprise sales |
| **Compliance Audit** | regulation_lookup, violation_search, audit_history, evidence_collect, generate_audit | INVESTIGATION | PCI-DSS, regulatory investigation |
| **Performance Optimizer** | system_metrics, query_analysis, bottleneck_detect, recommendation_generate | FAST | System tuning recommendations |
| **Competitive Analysis** | market_search, pricing_compare, feature_matrix, generate_analysis | REASONING | Market intelligence |

Each follows the same pattern:
1. Subclass `SpecializedAgentGraph`
2. Implement 6 methods: `get_tools()`, `get_tool_registry()`, `get_system_prompt()`, `get_state_class()`, `build_initial_state()`, `extract_tool_results()`
3. Optionally override `on_completion()` for persistence
4. Register tools in the appropriate tool registry
5. Add invocation point in `core/models.py`
6. Connect to the calling agent via a bridge tool
7. All investigations contribute to the shared knowledge base via the Intelligence Platform layers
