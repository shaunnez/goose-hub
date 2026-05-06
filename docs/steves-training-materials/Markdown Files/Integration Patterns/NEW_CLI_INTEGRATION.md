# New CLI Integration — Copy & Fill

Use this when there is no Python SDK and you have to wrap a command-line tool
(`gh`, `aws`, `kubectl`, `psql`, `terraform`, vendor-specific CLIs, etc.).

If a typed SDK exists, use `NEW_SDK_INTEGRATION.md` instead. CLIs are a
fallback, not a default — they cost a subprocess per call.

> Read `INTEGRATION_PATTERN.md` first.

---

## When the CLI is the right answer

- Vendor publishes a CLI but **no Python client** (or the client is unmaintained).
- Tool already has a stable JSON output mode (`--format json`, `--output json`).
- Operations are **read-mostly**. Write commands need an extra layer of
  capability gating — see "Write commands" at the bottom.
- Cold start cost (process spawn) is acceptable: < 200ms, or you can batch.

If any of those is false, push back and ask for an HTTP API.

---

## Day-one shape

```
backend/app/
├── schemas/
│   └── {service}_schemas.py
├── services/
│   └── {service}_cli.py              # subprocess wrapper · argv builders · parsers
├── tools/groups/
│   └── {service}.py
└── agents/admin_assistant/tools/
    └── {service}_tools.py

backend/tests/services/{service}/
    └── snapshots/                    # captured stdout JSON for replay
```

---

## 1. Schemas — same pattern as the SDK template

Tiered Pydantic models. Headline / Card / Detail. See
`NEW_SDK_INTEGRATION.md` § 1.

CLIs return JSON shaped however the vendor felt that day. The schemas live in
*our* code, not theirs — convert at the boundary.

---

## 2. CLI service — `backend/app/services/{service}_cli.py`

```python
"""{Service} CLI wrapper.

Wraps `{service}` subprocesses with:
- argv-list invocation (NEVER shell=True — see SECURITY below)
- typed request/response Pydantic models
- stdout JSON parsing → tiered schemas
- Redis cache on the deterministic argv tuple
- snapshot-friendly: every call records (argv, stdout) for replay tests

Pattern: this is the equivalent of the SDK service file, but the "client"
is `subprocess.run` and the "wire format" is stdout JSON.
"""
import asyncio
import hashlib
import json
import logging
import shutil
import subprocess
from dataclasses import dataclass
from typing import Optional, Sequence

from app.core.config import settings
from app.schemas.{service}_schemas import (
    {Resource}Headline, {Resource}Detail, {Resource}SearchResponse,
)

logger = logging.getLogger(__name__)


# ---- Typed errors --------------------------------------------------------

class {Service}CliError(Exception): ...
class {Service}NotInstalledError({Service}CliError): ...
class {Service}TimeoutError({Service}CliError): ...
class {Service}ExitCodeError({Service}CliError):
    def __init__(self, code: int, stderr: str):
        super().__init__(f"{service} exited {code}: {stderr[:500]}")
        self.code = code
        self.stderr = stderr
class {Service}ParseError({Service}CliError): ...


# ---- Constants -----------------------------------------------------------

_BIN_NAME = "{service}"
_DEFAULT_TIMEOUT = 30          # seconds
_MAX_OUTPUT_BYTES = 4 * 1024 * 1024   # 4 MiB hard cap
_CACHE_TTL = 300


@dataclass(frozen=True)
class CliInvocation:
    """An argv tuple + the input it was built from. Cache key + replay key."""
    argv: tuple[str, ...]
    intent: str   # e.g. "search:text", "detail:id"

    @property
    def cache_key(self) -> str:
        digest = hashlib.md5(repr(self.argv).encode()).hexdigest()[:12]
        return f"{service}-cli:{self.intent}:{digest}"


# ---- Service -------------------------------------------------------------

class {Service}CliService:
    def __init__(self, redis_client=None) -> None:
        self._redis = redis_client
        self._bin: Optional[str] = None

    # -- Binary resolution ---------------------------------------------

    def _resolve_bin(self) -> str:
        """Locate the CLI once. Fail loud if missing."""
        if self._bin is None:
            override = getattr(settings, "{SERVICE}_CLI_PATH", None)
            candidate = override or shutil.which(_BIN_NAME)
            if not candidate:
                raise {Service}NotInstalledError(
                    f"`{_BIN_NAME}` not found on PATH. "
                    f"Set {{SERVICE}}_CLI_PATH or install the CLI."
                )
            self._bin = candidate
        return self._bin

    # -- argv builders --------------------------------------------------
    #
    # NEVER concatenate strings into a shell command.
    # NEVER use shell=True.
    # Every dynamic value is a separate argv element.

    def _argv_search_text(self, query: str, limit: int) -> CliInvocation:
        # Date bound here, same as Jira's -365d default.
        argv = (
            self._resolve_bin(),
            "search",
            "--text", query,
            "--since", "-365d",
            "--limit", str(min(max(limit, 1), 50)),
            "--output", "json",
        )
        return CliInvocation(argv=argv, intent="search:text")

    def _argv_get_detail(self, resource_id: str) -> CliInvocation:
        argv = (
            self._resolve_bin(),
            "get",
            "--id", resource_id,
            "--output", "json",
        )
        return CliInvocation(argv=argv, intent="detail:id")

    # -- Subprocess core ------------------------------------------------

    async def _run(self, inv: CliInvocation, timeout: int = _DEFAULT_TIMEOUT) -> bytes:
        # Cache hit?
        cached = await self._cache_get(inv.cache_key)
        if cached is not None:
            return cached

        try:
            result = await asyncio.to_thread(
                subprocess.run,
                inv.argv,
                check=False,
                capture_output=True,
                timeout=timeout,
                # IMPORTANT: shell=False (the default). Argv list, no string.
            )
        except subprocess.TimeoutExpired as e:
            raise {Service}TimeoutError(f"{inv.argv[0]} {inv.argv[1]} timed out after {timeout}s") from e

        if result.returncode != 0:
            raise {Service}ExitCodeError(result.returncode, result.stderr.decode("utf-8", "replace"))

        out = result.stdout
        if len(out) > _MAX_OUTPUT_BYTES:
            raise {Service}ParseError(f"output exceeded {_MAX_OUTPUT_BYTES} bytes; refuse to parse")

        await self._cache_set(inv.cache_key, out)
        return out

    @staticmethod
    def _parse_json(out: bytes):
        try:
            return json.loads(out.decode("utf-8"))
        except json.JSONDecodeError as e:
            preview = out[:200].decode("utf-8", "replace")
            raise {Service}ParseError(f"non-json stdout (first 200b): {preview!r}") from e

    # -- Cache ----------------------------------------------------------

    async def _cache_get(self, key: str) -> Optional[bytes]:
        if not self._redis:
            return None
        try:
            v = await self._redis.get(key)
            return v.encode() if isinstance(v, str) else v
        except Exception as e:
            logger.warning(f"cache get failed: {e}")
            return None

    async def _cache_set(self, key: str, value: bytes) -> None:
        if not self._redis:
            return
        try:
            await self._redis.setex(key, _CACHE_TTL, value)
        except Exception as e:
            logger.warning(f"cache set failed: {e}")

    # -- Public API -----------------------------------------------------

    async def search(self, query: str, limit: int = 20) -> {Resource}SearchResponse:
        inv = self._argv_search_text(query, limit)
        raw = await self._run(inv)
        payload = self._parse_json(raw)

        items = payload.get("items") or payload.get("results") or []
        results = [self._to_headline(it) for it in items]
        return {Resource}SearchResponse(
            query=query,
            resolved_level="L3",   # CLI text search is L3 by definition
            results=results,
            total_count=int(payload.get("total", len(results))),
            has_more=bool(payload.get("has_more", len(results) > limit)),
        )

    async def get_detail(self, resource_id: str) -> Optional[{Resource}Detail]:
        inv = self._argv_get_detail(resource_id)
        try:
            raw = await self._run(inv)
        except {Service}ExitCodeError as e:
            # Many CLIs use exit 1 for "not found" — adjust per vendor.
            if e.code == 1 and "not found" in e.stderr.lower():
                return None
            raise
        return self._to_detail(self._parse_json(raw))

    # -- JSON → Pydantic boundary --------------------------------------

    def _to_headline(self, raw: dict) -> {Resource}Headline:
        return {Resource}Headline(
            id=str(raw.get("id") or raw.get("key") or raw.get("name")),
            title=(raw.get("title") or raw.get("summary") or "")[:500],
            status=str(raw.get("status") or "Unknown"),
            match_field=raw.get("_match_field"),
        )

    def _to_detail(self, raw: dict) -> {Resource}Detail:
        body = raw.get("description") or raw.get("body") or ""
        preview = body[:500] if body else None
        return {Resource}Detail(
            id=str(raw.get("id") or raw.get("key")),
            title=(raw.get("title") or raw.get("summary") or "")[:500],
            status=str(raw.get("status") or "Unknown"),
            owner=raw.get("owner"),
            created=raw.get("created"),
            updated=raw.get("updated"),
            description_preview=preview,
            timeline=[],
        )


# ---- Singleton -----------------------------------------------------------

_instance: Optional[{Service}CliService] = None

def get_{service}_cli(redis_client=None) -> {Service}CliService:
    global _instance
    if redis_client:
        return {Service}CliService(redis_client=redis_client)
    if _instance is None:
        _instance = {Service}CliService()
    return _instance
```

---

## 3. Security — non-negotiable

| Rule | Why |
|---|---|
| **Always use argv lists.** Never `shell=True`. Never `" ".join(parts)` into `subprocess.run`. | Command injection. We have already paid this bill (see `[WP1] P0 Security` in git log). |
| **Resolve the binary once.** `shutil.which` + optional `*_CLI_PATH` override. | Stops PATH-hijack tricks; explicit deployment knob. |
| **Cap stdout.** 4 MiB ceiling. | A runaway CLI can fill memory faster than the agent can parse. |
| **Cap timeout.** 30s default. | Subprocesses don't honour LangGraph's clock. |
| **Validate input shape before argv.** | If the user sent `--rm -rf`, treat it as data, not a flag. |
| **Capability gate write commands.** See bottom. | A CLI can do *anything*; the agent should not. |

If you find yourself reaching for `shell=True` because of a pipeline, write a
**second** invocation in the wrapper instead, or use `subprocess` plumbing
(`stdout=PIPE`, then a Python step). Pipelines in argv strings are how
injections happen.

---

## 4. Tool / group / manifest

Same shape as `NEW_SDK_INTEGRATION.md` § 3-5 — only the import target
changes (`get_{service}_cli` instead of `get_{service}_service`).

The `@tool` body looks identical to the agent. **That is the point.** The
agent shouldn't know whether the integration is an SDK or a CLI — only that
it returns typed results.

---

## 5. Snapshot tests — the CLI superpower

Because every CLI call is `(argv, stdout)`, you can record once and replay
forever. Pattern:

```python
# backend/tests/services/{service}/test_search.py
from pathlib import Path
import pytest
from app.services.{service}_cli import {Service}CliService, CliInvocation

SNAP = Path(__file__).parent / "snapshots"

@pytest.fixture
def svc(monkeypatch):
    s = {Service}CliService()

    async def fake_run(inv: CliInvocation, timeout=30):
        snap = SNAP / f"{inv.intent}_{inv.argv[-1]}.json"
        return snap.read_bytes()

    monkeypatch.setattr(s, "_run", fake_run)
    return s

@pytest.mark.asyncio
async def test_search_text_parses_to_headline(svc):
    response = await svc.search("Nandos")
    assert response.results
    assert response.results[0].title
    assert response.resolved_level == "L3"
```

Capture snapshots once with a real CLI run; commit the JSON to
`backend/tests/services/{service}/snapshots/`. From then on, tests are
hermetic and run in milliseconds.

---

## 6. Write commands (mutating CLIs)

Read commands fit the pattern above. Write commands need three extra layers:

1. **Capability gate at the tool layer.** `require_capability("admin:{service}:write")`.
2. **Dry-run flag in the wrapper.** Default to `--dry-run` unless the caller
   passes `confirm=True`. The Pydantic request model carries the flag.
3. **No write tools in the default manifest.** Mutating tools belong in their
   own group, opted into by name.

Example:

```python
@tool
async def {service}_apply_change(
    target: str,
    payload: {Service}ApplyRequest,
    confirm: bool = False,
) -> dict:
    if not require_capability("admin:{service}:write"):
        return ToolResult.capability_required("admin:{service}:write").dump()
    if not confirm:
        # Dry run — surface the planned argv for review
        return ToolResult.ok(
            data={"planned_argv": payload.to_argv(target), "dry_run": True},
            display_text="Dry run only. Re-call with confirm=true to apply.",
        ).dump()
    ...
```

If the agent forgets to set `confirm=True`, nothing happens. That's the
desired default.

---

## Checklist before you ship

- [ ] `subprocess.run` with `shell=False` (the default). Audit: `grep -n shell=True`.
- [ ] Binary resolved via `shutil.which` + optional env override.
- [ ] Every dynamic value is its own argv element.
- [ ] Output capped at 4 MiB; timeout capped at 30s.
- [ ] JSON parse error raises typed exception, not silent `None`.
- [ ] Snapshot fixtures committed; CI doesn't shell out.
- [ ] Write commands gated by capability + `confirm=True`.
- [ ] Manifest references the read group; write group is separate.
- [ ] Cache key is `(intent, argv-hash)` — not the user's prompt.

A CLI integration that passes this list looks identical to the agent as an
SDK integration that passes `NEW_SDK_INTEGRATION.md`. That's the goal: the
agent never knows which one it is talking to.
