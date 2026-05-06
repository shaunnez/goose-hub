# New SDK Integration — Copy & Fill

Use this when the system you're integrating ships a typed Python SDK
(or any client library you can `pip install`).

If there's no SDK, see `NEW_CLI_INTEGRATION.md`.

> Read `INTEGRATION_PATTERN.md` first. This file is the scaffold. That file is
> why the scaffold looks like this.

---

## Day-one shape

```
backend/app/
├── schemas/
│   └── {service}_schemas.py          # Pydantic — request + tiered responses
├── services/
│   └── {service}_service.py          # SDK wrapper · cache · errors · async
├── tools/groups/
│   └── {service}.py                  # Tool group registration in the catalog
└── agents/admin_assistant/tools/
    └── {service}_tools.py            # @tool functions wired to the service

backend/app/agents/platform/manifests/
    └── {agent_using_it}.yaml         # tools: [{service}]
```

Five files. No more, no less.

---

## 1. Schemas — `backend/app/schemas/{service}_schemas.py`

Define **one model per tier** of progressive disclosure.

```python
"""Pydantic schemas for {Service}.

Tiers — see INTEGRATION_PATTERN.md § Progressive disclosure.
"""
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


# ---- Headline (always returned) ------------------------------------------

class {Resource}Headline(BaseModel):
    """Smallest useful response. ~80 tok per item."""
    id: str
    title: str
    status: str
    match_field: Optional[str] = Field(
        default=None,
        description="Which input field matched — agent uses this to confirm L0/L1 hit.",
    )


# ---- Card (renderable) ---------------------------------------------------

class {Resource}Card({Resource}Headline):
    priority: Optional[str] = None
    owner: Optional[str] = None
    created: Optional[datetime] = None
    updated: Optional[datetime] = None


# ---- Detail (on-demand) --------------------------------------------------

class {Resource}Detail({Resource}Card):
    description_preview: Optional[str] = Field(
        default=None,
        max_length=500,
        description="First 500 chars only. Full body requires the raw tier.",
    )
    timeline: List["{Resource}TimelineEntry"] = Field(default_factory=list)


class {Resource}TimelineEntry(BaseModel):
    timestamp: datetime
    actor: Optional[str] = None
    event: str


# ---- Search response (paged) ---------------------------------------------

class {Resource}SearchResponse(BaseModel):
    query: str
    resolved_level: Literal["L0", "L1", "L2", "L3"]
    results: List[{Resource}Headline]   # always headline tier
    total_count: int
    has_more: bool

    @property
    def is_terminal(self) -> bool:
        """Agents check this to decide whether to widen."""
        return self.total_count == 1 or self.resolved_level in {"L0", "L1"}
```

Rules:

- **One Pydantic class per tier.** Don't union them. Tier escalation is a
  *call*, not a flag.
- `description_preview` is **always** capped at 500 chars.
- `match_field` is the agent's L0/L1 confirmation signal.
- `total_count` and `has_more` are non-optional. The agent must be able to
  read them without a guard.

---

## 2. Service — `backend/app/services/{service}_service.py`

```python
"""{Service} — SDK wrapper with cache, typed errors, and progressive widening.

Pattern: lazy singleton client + asyncio.to_thread for sync SDKs.
See INTEGRATION_PATTERN.md.
"""
import asyncio
import hashlib
import logging
import re
from typing import Optional

from app.core.config import settings
from app.schemas.{service}_schemas import (
    {Resource}Headline, {Resource}Detail, {Resource}SearchResponse,
)

logger = logging.getLogger(__name__)


# ---- Typed errors --------------------------------------------------------

class {Service}ServiceError(Exception): ...
class {Service}ConnectionError({Service}ServiceError): ...
class {Service}QueryError({Service}ServiceError): ...
class {Resource}NotFoundError({Service}ServiceError): ...


# ---- Constants -----------------------------------------------------------

# Field whitelist — keep payloads small. Add a field only when you have a
# concrete consumer for it.
_SEARCH_FIELDS = ("id", "title", "status", "owner", "created", "updated")
_DESCRIPTION_PREVIEW_LENGTH = 500
_DEFAULT_DATE_BOUND_DAYS = 365
_CACHE_TTL_SEARCH = 300        # 5 min
_CACHE_TTL_DETAIL = 600        # 10 min
_CACHE_TTL_HIERARCHY = 1800    # 30 min

# Auto-detection patterns — extend per service shape
_ID_PATTERN = re.compile(r"^[A-Z]{2,}-\d+$")
_NUMERIC_PATTERN = re.compile(r"^\d{6,16}$")


# ---- Service -------------------------------------------------------------

class {Service}Service:
    def __init__(self, redis_client=None) -> None:
        self._redis = redis_client
        self._client = None

    # -- Client ---------------------------------------------------------

    def _get_client(self):
        """Lazy singleton — auth once per process."""
        if self._client is None:
            if not (settings.{SERVICE}_URL and settings.{SERVICE}_TOKEN):
                raise {Service}ConnectionError(
                    "{SERVICE}_URL and {SERVICE}_TOKEN must be configured."
                )
            try:
                from {service_sdk} import Client
                self._client = Client(
                    base_url=settings.{SERVICE}_URL,
                    token=settings.{SERVICE}_TOKEN,
                )
            except ImportError:
                raise {Service}ConnectionError(
                    "{service_sdk} not installed. Run: pip install {service_sdk}"
                )
        return self._client

    # -- Cache ----------------------------------------------------------

    async def _cache_get(self, key: str) -> Optional[str]:
        if not self._redis:
            return None
        try:
            return await self._redis.get(key)
        except Exception as e:
            logger.warning(f"redis get failed: {e}")
            return None

    async def _cache_set(self, key: str, value: str, ttl: int) -> None:
        if not self._redis:
            return
        try:
            await self._redis.setex(key, ttl, value)
        except Exception as e:
            logger.warning(f"redis set failed: {e}")

    @staticmethod
    def _cache_key(prefix: str, raw: str) -> str:
        digest = hashlib.md5(raw.lower().strip().encode()).hexdigest()[:12]
        return f"{service}:{prefix}:{digest}"

    # -- Auto-detection -------------------------------------------------

    @staticmethod
    def _resolve_level(query: str) -> tuple[str, str]:
        """Pick the cheapest level that could match.

        Returns (level, search_kind). Order matters — L0 wins.
        """
        q = query.strip()
        if _ID_PATTERN.match(q):       return "L0", "id"
        if _NUMERIC_PATTERN.match(q):  return "L1", "numeric_id"
        if "@" in q:                   return "L1", "email"
        return "L2", "text"

    # -- Public API -----------------------------------------------------

    async def search(self, query: str, limit: int = 20) -> {Resource}SearchResponse:
        limit = min(max(limit, 1), 50)
        level, kind = self._resolve_level(query)
        cache_key = self._cache_key(f"search:{level}", query)

        cached = await self._cache_get(cache_key)
        if cached:
            return {Resource}SearchResponse.model_validate_json(cached)

        try:
            response = await asyncio.to_thread(self._search_sync, query, kind, level, limit)
        except {Service}ConnectionError:
            raise
        except Exception as e:
            logger.error(f"{service} search failed: {e}")
            raise {Service}QueryError(str(e)) from e

        await self._cache_set(cache_key, response.model_dump_json(), _CACHE_TTL_SEARCH)
        return response

    async def get_detail(self, resource_id: str) -> Optional[{Resource}Detail]:
        cache_key = self._cache_key("detail", resource_id)
        cached = await self._cache_get(cache_key)
        if cached:
            return {Resource}Detail.model_validate_json(cached)

        try:
            detail = await asyncio.to_thread(self._get_detail_sync, resource_id)
        except {Resource}NotFoundError:
            return None
        except Exception as e:
            raise {Service}QueryError(f"detail fetch failed for {resource_id}: {e}") from e

        if detail:
            await self._cache_set(cache_key, detail.model_dump_json(), _CACHE_TTL_DETAIL)
        return detail

    # -- Sync workers (run in thread) -----------------------------------

    def _search_sync(self, query, kind, level, limit) -> {Resource}SearchResponse:
        client = self._get_client()
        # Build the narrowest filter the level allows.
        if kind == "id":
            sdk_results = client.fetch(id=query.upper(), fields=_SEARCH_FIELDS)
        elif kind == "numeric_id":
            sdk_results = client.search(filter={"numeric_id": query}, fields=_SEARCH_FIELDS, limit=limit)
        elif kind == "email":
            sdk_results = client.search(filter={"email": query}, fields=_SEARCH_FIELDS, limit=limit)
        else:
            sdk_results = client.search(
                text=query,
                created_within_days=_DEFAULT_DATE_BOUND_DAYS,
                fields=_SEARCH_FIELDS,
                limit=limit,
            )

        results = [self._to_headline(r) for r in sdk_results.items]
        return {Resource}SearchResponse(
            query=query,
            resolved_level=level,
            results=results,
            total_count=getattr(sdk_results, "total", len(results)),
            has_more=getattr(sdk_results, "total", len(results)) > limit,
        )

    def _get_detail_sync(self, resource_id) -> Optional[{Resource}Detail]:
        client = self._get_client()
        try:
            sdk_obj = client.fetch_full(resource_id)
        except Exception as e:
            if getattr(e, "status_code", None) == 404:
                raise {Resource}NotFoundError(resource_id) from e
            raise

        return self._to_detail(sdk_obj)

    # -- SDK → Pydantic boundary ---------------------------------------

    def _to_headline(self, r) -> {Resource}Headline:
        return {Resource}Headline(
            id=str(r.id),
            title=(r.title or "")[:500],
            status=r.status or "Unknown",
            match_field=getattr(r, "_match_field", None),
        )

    def _to_detail(self, r) -> {Resource}Detail:
        raw_desc = getattr(r, "description", "") or ""
        preview = raw_desc[:_DESCRIPTION_PREVIEW_LENGTH] if raw_desc else None
        return {Resource}Detail(
            id=str(r.id),
            title=(r.title or "")[:500],
            status=r.status or "Unknown",
            owner=getattr(r.owner, "display_name", None) if getattr(r, "owner", None) else None,
            created=getattr(r, "created", None),
            updated=getattr(r, "updated", None),
            description_preview=preview,
            timeline=[],   # populate from r.events if cheap; otherwise leave empty
        )


# ---- Singleton -----------------------------------------------------------

_instance: Optional[{Service}Service] = None

def get_{service}_service(redis_client=None) -> {Service}Service:
    global _instance
    if redis_client:
        return {Service}Service(redis_client=redis_client)
    if _instance is None:
        _instance = {Service}Service()
    return _instance
```

Discipline checklist:

- ✅ Lazy `_get_client` — never create the SDK client at import.
- ✅ `_SEARCH_FIELDS` declared as a constant. Adding a field is a code change.
- ✅ `_resolve_level` returns the level so the response can carry it.
- ✅ Cache the **Pydantic** response, not the SDK object.
- ✅ `asyncio.to_thread` for sync SDKs. Never `await` a blocking client.
- ✅ Typed errors. `NotFound` is a value (`None`), not an exception, at the
  *public* API boundary.

---

## 3. Tool — `backend/app/agents/admin_assistant/tools/{service}_tools.py`

```python
"""{Service} tools — agent-facing wrappers."""
import logging
import re
from typing import Literal

from langchain_core.tools import tool

from app.agents.admin_assistant.context import require_capability
from app.agents.assistant.tools.tool_response import ToolResult
from app.services.{service}_service import (
    {Service}ConnectionError,
    {Service}QueryError,
    get_{service}_service,
)

logger = logging.getLogger(__name__)

_ID_PATTERN = re.compile(r"^[A-Z]{2,}-\d+$")


@tool
async def search_{service}(
    query: str,
    search_type: Literal["auto", "text", "id"] = "auto",
) -> dict:
    """Search {Service} for resources.

    Use this to look up {Service} records when investigating a merchant issue
    or building a report.

    Args:
        query: Resource ID (e.g. ABC-123), or free-text.
        search_type: 'auto' (default), 'text', or 'id'.

    Returns:
        ToolResult dict with `data: {Resource}SearchResponse`.
    """
    if not require_capability("admin"):
        return ToolResult.capability_required("admin").dump()
    if not query or not query.strip():
        return ToolResult.validation_error("query", "query is required.").dump()

    cleaned = query.strip()
    service = get_{service}_service()

    # L0 fast path — exact ID, single fetch
    if (search_type in ("auto", "id")) and _ID_PATTERN.match(cleaned):
        detail = await service.get_detail(cleaned.upper())
        if detail is None:
            return ToolResult.fail(
                error="not_found",
                error_type="not_found",
                message=f"No {service} resource found for {cleaned.upper()}.",
                suggestion="Verify the ID and try again.",
            ).dump()
        return ToolResult.ok(
            data={"results": [detail.model_dump(mode="json")], "resolved_level": "L0"},
            display_text=f"Found {detail.id}: {detail.title} ({detail.status}).",
        ).dump()

    # L1+ — typed search
    try:
        response = await service.search(cleaned)
    except {Service}ConnectionError as e:
        return ToolResult.connection_error(e, "{Service}").dump()
    except {Service}QueryError as e:
        return ToolResult.query_error(e, f"search for '{cleaned}'").dump()

    if response.total_count > len(response.results):
        display = (
            f"Found {response.total_count} {service} results matching '{cleaned}' "
            f"(showing first {len(response.results)}). Refine if needed."
        )
    else:
        display = f"Found {len(response.results)} {service} result(s) for '{cleaned}'."

    return ToolResult.ok(
        data=response.model_dump(mode="json"),
        display_text=display,
    ).dump()
```

Discipline:

- L0 short-circuits **before** any network round-trip beyond the single fetch.
- The agent receives `resolved_level` so it can decide whether to widen.
- `ToolResult.connection_error` is fatal — the loop must not retry.

---

## 4. Tool group — `backend/app/tools/groups/{service}.py`

```python
"""Register the {service} tool group with the platform catalog."""
import logging

from app.agents.framework.tool_registry import (
    ParallelSafety, SessionStrategy, ToolMetadata, ToolScope, ToolTier,
)
from app.agents.platform.tool_catalog import ToolGroup, tool_catalog

logger = logging.getLogger(__name__)

_METADATA = ToolMetadata(
    name="search_{service}",
    display_name="{Service} Search",
    parallel_safety=ParallelSafety.SAFE,
    session_strategy=SessionStrategy.NONE,
    timeout_seconds=60,
    retryable=True,
    max_retries=2,
    description="Search {Service} resources by ID or text.",
    scope=ToolScope.ADMIN,
    tier=ToolTier.ADMIN,
    intent_tags=["admin", "{service}", "search"],
    activity_description_template="Querying {Service} for {query}",
)


def register() -> None:
    from app.agents.admin_assistant.tools.{service}_tools import search_{service}

    if tool_catalog.get_tool_entry("search_{service}") is None:
        tool_catalog.register_tool(search_{service}, _METADATA)

    tool_catalog.register_group(ToolGroup(
        name="{service}",
        display_name="{Service} Integration",
        description="{Service} resource search.",
        tool_names=["search_{service}"],
    ))
    logger.info("Registered tool group: {service}")
```

---

## 5. Manifest — `backend/app/agents/platform/manifests/{your_agent}.yaml`

```yaml
name: your_agent
tools:
  - {service}    # the group, not the tool — compiler expands it
```

That's it. The compiler sees `{service}`, looks up the group in the catalog,
and adds `search_{service}` to your agent's tool surface. No keyword routing.
No bespoke handler.

---

## Tests to write

| Test | What it proves |
|---|---|
| `test_resolve_level_id_pattern` | L0 fires on exact ID input |
| `test_resolve_level_email` | L1 fires on `@` input |
| `test_resolve_level_text_fallback` | L2 catches everything else |
| `test_search_caches_typed_response` | second call hits cache, not SDK |
| `test_search_handles_connection_error` | typed error, not paragraph |
| `test_get_detail_returns_none_on_404` | not-found is a value, not an exception |
| `test_description_preview_is_capped` | 500-char ceiling enforced |
| `test_tool_returns_resolved_level` | agent can read which level matched |

Aim for one fixture per SDK response shape, not per call site.

---

## Checklist before you ship

- [ ] No `Dict[str, Any]` anywhere in the service file
- [ ] `select` / `fields` parameter set on every SDK call
- [ ] `asyncio.to_thread` wraps every sync SDK call
- [ ] `_resolve_level` exists and is unit-tested
- [ ] `description_preview` capped at 500 chars
- [ ] Three error types defined and raised at the right spots
- [ ] `ToolResult` envelopes used in the `@tool` wrapper
- [ ] Manifest references the group, not the raw tool
- [ ] Smoke test in Langfuse — confirm token cost matches budget for the tier

If any line above is unchecked, send the PR back. The integration owns the
contract; we don't get to claim it later.
