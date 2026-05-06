# WS Architecture Polish — Full Clean Cut (v5)

## Objective

Complete the chat v2 migration in two phases. Phase 1 fixes all regressions, unifies admin tables, migrates types, extracts REST endpoints, and archives old streaming code. Phase 2 migrates the remaining complex consumers (agent-dashboard, interview, recalibration) and archives the last legacy hooks.

**End state after Phase 1:** All chat regressions fixed, admin on unified tables, old streaming paths archived, REST endpoints preserved. Interview/recalibration still on old hooks (functional, not broken).

**End state after Phase 2:** One WS endpoint, one hook, one reducer, zero legacy paths.

---

# PHASE 1: Regressions + Partial Archival

## Phase 1 Acceptance Criteria

| AC | Description | Verify | Expected | Auto |
|----|-------------|--------|----------|------|
| AC1 | Thinking text appears exactly once | Send data query, observe thinking section | Thinking collapsible once, main text once | Semi |
| AC2 | Tool errors display in ToolStatusRail | Trigger a tool error | Error message visible in tool chip | Semi |
| AC3 | ToolStatusRail completed banner shows | Send "show me revenue", wait for completion | "Completed" banner with tool summary | Semi |
| AC4 | Langfuse traces appear for WS chat | Send message → check Langfuse API | Trace with session_id, user_id, tool spans | Yes |
| AC5 | Chat title updates during conversation | Send query, observe tab/header title | Title changes from default to inferred | Semi |
| AC6 | Suggestions appear after agent response | Send query, wait for response | Suggestion pills visible below response | Semi |
| AC7 | pageType sent in WS payload | Send from Ask page, check backend log | `page_type` in context loader | Yes (log) |
| AC8 | Admin chat history shows messages from new WS path | Send admin message via WS → check admin session list | Message appears | Semi |
| AC9 | Welcome/suggestion REST endpoints still work | Authenticated curl to `/api/v1/agent/welcome-suggestions` | Returns suggestions JSON | Yes |
| AC10 | Old streaming files archived | `ls backend/archived/chat-v1/` | ws_chat.py, ws_admin.py, streaming.py present | Yes |
| AC11 | Zero `admin_chat_*` SQL refs in admin_agent.py | `grep -n "admin_chat_" backend/app/api/v1/admin_agent.py` | Zero results | Yes |
| AC12 | Type imports migrated from old hooks | `grep -rn "from.*useChatStream" frontend/app/ --include="*.ts" --include="*.tsx" \| grep -v archived \| grep -v node_modules` | Only interview/recalibration/agent-dashboard remain (Phase 2 scope) | Yes |

## Architecture

### Current State
```
Ask Page → ChatProvider → useChat → wsHandler → ws_chat_v2.py → streaming_v2.py
Agent Dashboard → useAgentSession → useChatStream → useWebSocketChat → ws_chat.py → streaming.py
Interview → useWebSocketChat → ws_interview.py → streaming.py
Admin → ChatProvider → useChat → ws_chat_v2.py (writes unified tables, but admin_agent.py reads old tables)
SSE fallback → agent.py → streaming.py (REST endpoints still called)
```

### Phase 1 Target State
```
Ask Page → ChatProvider → useChat → wsHandler → ws_chat_v2.py → streaming_v2.py (FIXED)
Agent Dashboard → useAgentSession → useChatStream → useWebSocketChat → ws_chat.py (KEEP for Phase 2)
Interview → useWebSocketChat → ws_interview.py (KEEP for Phase 2)
Admin → ChatProvider → useChat → ws_chat_v2.py → admin_agent.py reads unified tables (FIXED)
REST endpoints → agent_rest.py (EXTRACTED from agent.py)
Old streaming paths → archived/chat-v1/ (ws_chat.py KEPT for agent-dashboard)
```

### Key Design Decisions

1. **Title/suggestions in `ws_chat_v2.py` endpoint layer** — `streaming_v2.py` is intentionally side-effect free. Title/suggestions emitted AFTER stream loop, BEFORE done event.

2. **Extract REST endpoints from `agent.py`** — 5 non-streaming REST endpoints actively called by frontend. Extract to `agent_rest.py`, then archive `agent.py`.

3. **Admin reads unified tables** — Alembic migration `20260223_0206` already moved admin data to `chat_sessions` with `agent_type='admin'`. Update `admin_agent.py` SQL to read unified tables.

4. **`organizationId` NOT in WS payload** — Derived server-side via `ws_shared.py:431-437`. Only `pageType` sent from client (UI hint, not security boundary).

5. **Suggestions emitted BEFORE done** (Codex round 5 correction) — Legacy sent done first to unblock user. However, the frontend reducer handles suggestions during streaming. Emit suggestions before done so they appear with the response, not after a flash.

6. **Interview/recalibration/agent-dashboard deferred to Phase 2** — These have deeply custom WS protocols that need their own investigation cycle. Keeping old hooks functional is safe.

## Phase 1 Work Packages

### WP1: Thinking text deduplication (Frontend + Backend)

**Files:**
- `frontend/app/lib/chat/chatReducer.ts` (modify)
- `frontend/app/lib/chat/types.ts` (modify — add `reclassifiedContent` to StreamState)
- `backend/app/api/v1/ws_chat_v2.py` (modify — fix `done` event `full_response`)

**Root cause:** Three-layer duplication:
1. Backend sends pre-tool text on `main` channel → `stream.content`
2. Backend reclassifies same text on `thinking` channel at tool start (`streaming_v2.py:404`) → also `stream.thinking`
3. `done` event `full_response` includes pre-tool text, `thinking_content` also has it

**Frontend fix (chatReducer.ts):**
- Add `reclassifiedContent: string` to `StreamState` (default `''`)
- In `tool` case: if `stream.tools.length === 0` (first tool) and `stream.content.trim()`, move content → thinking, set `reclassifiedContent`, clear content
- In `token` thinking handler: if `reclassifiedContent` matches incoming text, skip and clear

**Backend fix (ws_chat_v2.py):**
- Use `ctx.display_response_text` (strips pre-tool text) for `done` event `full_response` and persistence
- Use `ctx.full_thinking` or `accumulator.full_thinking` for `thinking_content`

**Builder model:** Opus

---

### WP2: Tool error/result plumbing (Frontend)

**Files:**
- `frontend/app/lib/chat/types.ts` (modify — add `errorMessage` to ToolPart)
- `frontend/app/lib/chat/chatReducer.ts` (modify — capture `error_message`)
- `frontend/app/lib/chat/legacyAdapter.ts` (modify — map to `result` for ToolCallLike)

**Changes:**
- Add `errorMessage?: string` to `ToolPart`
- Reducer: when `event.phase === 'error'`, set `errorMessage: event.error_message`
- Adapter: set `result: t.errorMessage` when status is error

**Builder model:** Sonnet

---

### WP3: CompletionSummary generation (Frontend)

**Files:**
- `frontend/app/lib/chat/chatReducer.ts` (modify — build in done handler)
- `frontend/app/lib/chat/legacyAdapter.ts` (modify — map to legacy props)
- `frontend/app/lib/chat/types.ts` (modify — add to Message)

**Approach:** Build `CompletionSummary` in `handleDoneEvent()` from accumulated tools using existing `groupParallelTools`/`phaseForTool` from `toolGrouping.ts`. Store on Message metadata. Map through `messageToLegacy()`.

**Builder model:** Sonnet

---

### WP4: Langfuse instrumentation (Backend)

**Files:**
- `backend/app/api/v1/ws_chat_v2.py` (modify)

**Verified API (from `framework/observability.py`):**
```python
from app.agents.framework.observability import (
    LangfuseMetadata,           # Pydantic model (line 89)
    create_langfuse_handler,    # -> Optional[LangfuseHandlerResult] (line 326)
    flush_langfuse_async,       # async, timeout param (line 1151)
    get_trace_id,               # -> Optional[str] (line 1085)
    infer_trace_name,           # -> str (line 994)
)
# Signature: create_langfuse_handler(user_id, session_id, trace_name, tags, extra_metadata)
# LangfuseHandlerResult has .handler attribute for callbacks (line 452)
```

**Implementation:**
1. After accumulator: `infer_trace_name()`, create `LangfuseMetadata`, `create_langfuse_handler()`
2. Add to config: `config["callbacks"] = [langfuse_result.handler]`
3. After stream: `accumulator.trace_id = get_trace_id(langfuse_result)`
4. Finally: `await flush_langfuse_async(timeout=2.0)`

**Builder model:** Opus

---

### WP5: Title + suggestions emission (Backend — endpoint layer)

**Files:**
- `backend/app/api/v1/ws_chat_v2.py` (modify)

**Location:** In `_handle_chat_message()`, AFTER the `process_stream()` loop, BEFORE `send_terminal(DoneEvent(...))`.

**Changes:**
- Title: `await send_event(StatusEvent(kind="title", data={"title": infer_trace_name(payload.message)}))` — reuse existing function
- Suggestions: generate domain-appropriate follow-ups based on `ctx.last_domain` and response content. Reference old logic at `ws_chat.py:762`.
- Builder must read `ws_chat.py:700-830` for the full old title/suggestion flow

**Builder model:** Opus

---

### WP6: pageType in WS payload (Frontend + Backend)

**Files:**
- `frontend/app/lib/chat/useChat.ts` (modify)
- `backend/app/api/v1/ws_chat_v2.py` (modify — ChatMessagePayload + context loader)

**Security:** `organizationId` derived server-side (`ws_shared.py:431-437`). NOT in payload.

**Changes:**
- Add `page_type: Optional[str] = Field(default=None, alias="pageType")` to `ChatMessagePayload`
- Frontend sends `pageType` from options in WS message
- Backend: `payload.page_type or "dashboard"` instead of hardcoded

**Builder model:** Sonnet

---

### WP7: Admin unified table reads (Backend)

**Files:**
- `backend/app/api/v1/admin_agent.py` (modify — 13 SQL refs to update)

**Context:** Alembic migration `20260223_0206` already moved admin data to `chat_sessions` with `agent_type='admin'`. Migration applied (DB at head). But `admin_agent.py` still queries old `admin_chat_sessions`/`admin_chat_messages`.

**Changes:**
- All `admin_chat_sessions` → `chat_sessions WHERE agent_type = 'admin'`
- All `admin_chat_messages` → `chat_messages` (joined via session_id)
- `admin_id` → `user_id` in unified table
- Verify all 5 REST endpoints return correct data

**Builder model:** Opus

---

### WP8: Type export migration (Frontend)

**Files:**
- 15+ consumer files (modify imports)
- `frontend/app/lib/streaming/types.ts` (verify)

**Migrate imports for files NOT in Phase 2 scope:**
- All imports from `useChatStream` in: `ChatMessageStream.tsx`, `StreamingMessageBubble.tsx`, `FloatingChatPopup.tsx`, `UnifiedChatInterface.tsx`, `SuggestionPills.tsx`, `ChatInputBar.tsx`, `ChatMessage.tsx`, `CanvasSlidePanel.tsx`, `AnalysisReportCard.tsx`, `AIProcessingIndicator.tsx`, `legacyAdapter.ts`
- `ConnectionStatus` from `useAgentSession` in: `ConnectionStatusIndicator.tsx`, `s4-admin/dashboard/page.tsx`
- Target: `@/app/lib/streaming/types` or `@/app/lib/chat/types`

**Keep (Phase 2):** Imports in `agent-dashboard/page.tsx`, `ProfileInterviewContainer.tsx`, `useRecalibration.ts`, `useSyncedForm.ts`

**Builder model:** Sonnet

---

### WP9: Extract REST endpoints + archive backend (Backend)

**Files:**
- New: `backend/app/api/v1/agent_rest.py` (create)
- `backend/app/api/v1/__init__.py` (modify)
- `backend/app/main.py` (modify)

**Extract from `agent.py`:**
- `GET /agent/health` (line 1845)
- `POST /agent/feedback` (line 1881)
- `POST /agent/refine-suggestion` (line 1916)
- `GET /agent/welcome-suggestions` (line 1934)
- `POST /agent/welcome-click` (line 1985)

**Archive to `backend/archived/chat-v1/`:**
- `agent.py` (SSE streaming — after REST extraction)
- `ws_admin.py` (replaced by ws_chat_v2 with agent_type=admin)
- `streaming.py` (replaced by streaming_v2.py)
- `direct_insight.py` (only imported by old paths)
- `greeting.py` (only imported by old paths — verify `recalibration.py` imports different greeting)

**KEEP (Phase 2):** `ws_chat.py`, `ws_interview.py` (still used by agent-dashboard, interview)

**Remove from `__init__.py`:** `agent`, `ws_admin`
**Remove from `main.py`:** Corresponding router includes
**Add:** `agent_rest` import + router include

**Builder model:** Sonnet

---

## Phase 1 Execution Order

```
Phase A (regressions):
  WP2 (tool errors — frontend only) ────┐
  WP3 (CompletionSummary — frontend) ───┤── Parallel (no file overlap)
  WP7 (admin unified — backend only) ───┘

  WP1+WP4+WP5+WP6 (all touch ws_chat_v2.py) ── Single Opus builder, sequential:
    → WP1 (thinking dedup: chatReducer + ws_chat_v2 done event)
    → WP4 (Langfuse: ws_chat_v2 handler setup)
    → WP5 (title/suggestions: ws_chat_v2 post-stream)
    → WP6 (pageType: ws_chat_v2 payload + useChat.ts)

Phase B (type migration — after Phase A):
  WP8 (type exports) ── Depends on Phase A (types may change)

Phase C (archival — after Phase A+B):
  WP9 (extract REST + archive backend) ── Depends on all consumers working
```

## Phase 1 Risk Register

| Risk | Severity | Probability | Mitigation | Detection |
|------|----------|-------------|------------|-----------|
| WP1 dedup guard too aggressive | High | Medium | Exact match + clear after first use | Thinking-model queries |
| WP7 admin unified table column mismatch | Medium | Low | Compare old vs new column names before UPDATE | Query test after migration |
| WP9 REST extraction misses import | Medium | Low | Builder reads full agent.py, traces every import | `python -c "import app.main"` |
| WP5 suggestion quality differs from old path | Low | Medium | Compare old ws_chat.py:762 logic | Functional test |

---

# PHASE 2: Consumer Migration + Final Archival (Deferred)

## Phase 2 Investigation Findings (from 5 Codex rounds)

These findings are the starting point for Phase 2 planning. They represent ~10 hours of Codex investigation across rounds 1-5.

### WP-P2-1: Agent-Dashboard Migration

**Files:** `frontend/app/agent-dashboard/page.tsx`, `frontend/app/hooks/useSyncedForm.ts`, `frontend/app/hooks/useAgentSession.ts`

**Codex findings:**
- `page.tsx:95,551,1222` — depends on Temporal/session capabilities not in ChatProvider
- `useSyncedForm.ts:6,13` — uses `session.activeForm` and `sessionId` from useAgentSession (NOT just sendMessage)
- Dashboard state (widget configs, layout) comes from separate hooks, but chat transport is deeply interleaved with session management

**Strategy:** Split `useAgentSession` into chat transport (→ ChatProvider) and dashboard session state (→ new dedicated hook or keep existing non-chat parts). Must map every field.

### WP-P2-2: Interview Migration

**Files:** `frontend/app/components/profile-interview/ProfileInterviewContainer.tsx`, `frontend/app/profile-interview/page.tsx`

**Codex findings:**
- `ProfileInterviewContainer.tsx:139,190,216,307,360` — sends `extractionId/action/editedValue/rejectionReason` via custom WS messages
- Expects `memory_feedback_ack` and `ws_memory_extraction` flows back
- `ws_interview_complete` is a distinct event (line 178)
- `page.tsx:44` has NO `<ChatProvider>` — app-wide provider is `assistant`
- Backend `stream_events.py:136` `WSStatusKind` doesn't include `memory_feedback_ack`
- Frontend `types.ts:124` `WSStatusKind` type needs extension
- Need `sendRaw()` on useChat for custom WS messages (not exposed today: `types.ts:208`, `ChatProvider.tsx:49`)

**Protocol extensions needed:**
- `MemoryFeedbackPayload`: type, request_id, extraction_id, action, edited_value?, rejection_reason?
- `FinishEarlyPayload`: type, request_id
- `StatusEvent` kinds: `memory_feedback_ack`, `ws_memory_extraction`, `ws_interview_complete`
- `sendRaw()` method on useChat/ChatProvider

### WP-P2-3: Recalibration Migration

**Files:** `frontend/app/hooks/useRecalibration.ts`

**Codex findings:**
- `useRecalibration.ts:671-684` — sends per-message `recalibrationId` extras
- `ws_chat_v2.py:86` uses `extra="forbid"` — will reject unknown fields
- Need to add `recalibration_id` field to `ChatMessagePayload`

### WP-P2-4: Final Archival

**Files to archive after Phase 2:**
- `backend/app/api/v1/ws_chat.py` (after agent-dashboard migrated)
- `backend/app/api/v1/ws_interview.py` (after interview migrated)
- `frontend/app/hooks/useChatStream.ts` (after all type imports migrated)
- `frontend/app/hooks/useAgentSession.ts` (after agent-dashboard migrated)
- `frontend/app/hooks/useWebSocketChat.ts` (after interview/recalibration migrated)
- `frontend/app/hooks/chatSuggestions.ts` (if orphaned)
- `frontend/app/lib/streaming/streamingReducer.ts` (if orphaned)
- `frontend/app/lib/streaming/eventHandlers.ts` (if orphaned)
- `frontend/app/lib/streaming/parseSSEStream.ts` (if orphaned)

### Phase 2 Acceptance Criteria (Draft)

| AC | Description |
|----|-------------|
| P2-AC1 | Zero imports from useChatStream, useAgentSession, useWebSocketChat in non-archived files |
| P2-AC2 | Interview flow: profile questions → memory extraction → feedback → complete |
| P2-AC3 | Recalibration flow: start → questions → complete |
| P2-AC4 | Agent-dashboard: chat + widget state + session management all functional |
| P2-AC5 | `npm run build` clean, `npx tsc --noEmit` clean |
| P2-AC6 | All old hooks + ws_chat.py + ws_interview.py archived |
