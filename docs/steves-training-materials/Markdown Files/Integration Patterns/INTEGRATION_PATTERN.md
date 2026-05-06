# Integration Pattern — SDK/CLI over MCP

This is the doctrine. Read it first. Every new tool integration in SkyTab
Intelligence follows the rules here, or it doesn't ship.

The companion templates in this folder (`NEW_SDK_INTEGRATION.md`,
`NEW_CLI_INTEGRATION.md`) are scaffolds you can copy. This file explains *why*
they look the way they do.

---

## TL;DR

> Build the **tool**, not the **telephone**.

- Use a vendor SDK if one exists.
- Wrap a CLI if one doesn't.
- Reach for MCP only when the server is genuinely external, untrusted, and
  open-world. None of our internal services are.

We pay tokens once at design time so the agent doesn't pay them every turn.

---

## Why not MCP for internal services

MCP is a protocol for an open-world agent to discover and use an unknown
server. That's not the situation we are in.

| What MCP optimises for | What we already have |
|---|---|
| Schema discovery on every connect | A typed Python module, checked at deploy |
| Server-defined response shape | A Pydantic model whose field whitelist *we* set |
| Generic content envelopes (text blocks, lists) | A single tool envelope (`ToolResult`) the runtime expects |
| Auth handshake per session | Singleton service, env-driven config, lazy client |
| `list_tools` / `tool_call` round-trips | A manifest the compiler reads at boot |

The cost of MCP is paid in **tokens** (verbose envelopes, schema chatter,
re-asking) and **latency** (extra hops, no in-process caching). For services
we own, both are pure waste.

MCP is fine for genuinely external, third-party agent surfaces — when you
don't control the schema and don't deploy alongside it. That is not Foundry,
not Jira, not Salesforce, not our analytics warehouse.

---

## The ReAct loop, properly bounded

Every agent in this codebase runs a **Think → Act → Observe** loop. The
integration's job is to make each pass cheap enough to converge in **≤3
turns**.

```
┌─────────┐    ┌─────────┐    ┌──────────┐
│  THINK  │ →  │   ACT   │ →  │ OBSERVE  │
│ pick L0 │    │ typed   │    │ widen?   │
│ (cheap) │    │ result  │    │  total_  │
└─────────┘    └─────────┘    │  count?  │
     ↑__________________________│ has_more?│
                               └──────────┘
```

Three guarantees the integration must give the agent so the loop terminates:

1. **A typed result.** The agent should never have to *parse prose* to know
   whether the call succeeded.
2. **A signal to stop.** `total_count`, `has_more`, `status`, or `match_field`
   in the response — anything that says "you got the answer, don't widen."
3. **A typed error.** `ConnectionError` is fatal; `NotFound` is informative;
   `QueryError` is retryable. The agent reads the *type*, not the message.

If the agent keeps widening, the integration is the bug — not the prompt.

---

## Progressive query widening

Every search-shaped call has **levels**. The integration auto-detects the
input shape and starts at the **cheapest** level that could match.

| Level | Shape | Example | Cost |
|---|---|---|---|
| **L0** | Exact key | MID `0021773366`, issue key `LH-42092`, case `#80012345` | one indexed lookup |
| **L1** | Exact field | email, phone, salesforce_id | one indexed lookup |
| **L2** | Prefix / contains | `containsAnyTerm` on `dbaName` | one tokenised search |
| **L3** | Free text | Jira `text ~`, bounded `-365d` | full-text + cap |
| **L4** | Cross-domain fan-out | merchant + jira + salesforce + analytics | planner-only |

Two rules:

- **The integration picks the level.** Auto-detect from the input shape (regex,
  `isdigit()`, `@ in s`). The agent never reasons about which level to use.
- **The agent never widens past what the response justifies.** If L0 returns
  a hit, the loop is done. If L2 returns 50 results with `has_more=True`, the
  agent is supposed to refine — not call again with the same query.

L4 is reserved for an explicit **planner** node. Free-running agents are not
allowed to fan out across services.

---

## Progressive disclosure

Same idea, applied to **payload size** instead of query breadth. Every
response comes back in tiers; later tiers cost more and require an explicit
trigger.

| Tier | Content | Trigger | Cost |
|---|---|---|---|
| **Headline** | key, status, dba_name, total_count | always returned | ~80 tok |
| **Card** | + subject, priority, owner, dates | rendered to user | ~250 tok |
| **Detail** | + 500-char description preview, timeline | user clicks / asks why | ~600 tok |
| **Investigation** | + AI categorisation, related cases, hierarchy | explicit `investigate_*` tool | ~2k tok |
| **Raw** | Full SDK record dump | developer-only, capability-gated | off-budget |

Implementation rules:

- **One model per tier.** Don't shove the full record into a single Pydantic
  schema and hope the agent ignores fields. It won't.
- **Description preview = 500 chars.** Hard cap. If the agent needs more, it
  asks for the detail tier.
- **Frontend mirrors the tiers.** Chip → card → drawer → full report. Data
  shape and UI shape rhyme on purpose.

The model never asks for "everything." There is no everything. There is only
the next tier.

---

## Agent topology — the shape of the bill

Topology decides which tools the model has to read in its system prompt every
turn. That's the dominant fixed cost of a conversation. Pick the smallest
topology you can.

```
FLAT                HUB & SPOKE             MANIFEST MIXTURE  ← default
┌───────┐           ┌───────┐                 ┌───────┐
│ agent │           │ router│                 │ compil│
│  ALL  │           └─┬───┬─┘                 │  er   │
│ tools │             │   │                   └───┬───┘
└───────┘           ┌─┴─┐ ┌─┐                     │
                   │spc│ │spc│                ┌──┴───┴──┐
                   └───┘ └───┘                │ smallest│
                                              │  graph  │
                                              └─────────┘
```

| Topology | Latency | Tokens | Debug |
|---|---:|---:|---:|
| Flat                | ⬤⬤⬤⬤⬤ | ⬤⬤⬤⬤⬤ | ⬤◯◯◯◯ |
| Hub & spoke         | ⬤⬤⬤◯◯ | ⬤⬤◯◯◯ | ⬤⬤⬤⬤◯ |
| **Manifest mixture**| ⬤⬤◯◯◯ | ⬤◯◯◯◯ | ⬤⬤⬤⬤⬤ |

The platform compiler builds the smallest tool graph that satisfies the
manifest's `tools:` declaration. Specialists never see siblings' tools.

> Every tool a specialist doesn't know about is a tool the LLM doesn't have to
> read in its system prompt.

---

## The seven rules

A new integration breaks any of these → it doesn't ship.

1. **Typed in, typed out.** Pydantic at every boundary. No `Dict[str, Any]`
   crossing service lines.
2. **The integration owns the level.** Auto-detect L0/L1/L2 from input shape.
   The agent does not pick.
3. **Field whitelist required.** No `select=*`. No "all fields." Name what you
   need; trim what you return.
4. **Cache near the call.** Redis-keyed, short TTL (300–1800s typical).
   Cache the *typed* response, not the raw payload.
5. **Errors are typed too.** `ConnectionError` vs `QueryError` vs `NotFound`.
   Never paragraphs. Never `None`-and-pray.
6. **Async via `asyncio.to_thread` for sync SDKs.** Never block the event
   loop. Never spawn a daemon for a single call.
7. **Manifest declares tools.** No keyword routing in chat handlers. No
   bespoke agents per integration.

---

## Worked examples in this codebase

- **Foundry** — `backend/app/services/foundry/` — mixin-per-domain layout,
  `select=[]` discipline, multi-probe hierarchy resolution.
- **Jira** — `backend/app/services/jira_service.py` +
  `backend/app/agents/admin_assistant/tools/jira_tools.py` — regex auto-detect
  before any network call, `_SEARCH_FIELDS` whitelist, 500-char description
  cap, 365-day default bound.

Read both before you build a new one.

---

## Anti-patterns we have already paid for

| Anti-pattern | Cost we paid | Fix |
|---|---|---|
| "Just give the agent a `query()` tool" | ReAct loop widened on every turn | Type the query upfront; expose `search_merchants`, `search_jira` |
| Returning the SDK object directly | Agent re-parsed nested JSON each turn, including private fields | Pydantic at the boundary; `_convert_issue` + `MerchantSearchResult` |
| Letting the model write JQL | `text ~ "*"` and full-history scans | `search_by_text` is bounded; raw `jql` is admin-capability gated |
| Per-call auth handshake | Cold-start tax on every tool call | Lazy-singleton client; env config; Redis cache for repeat reads |
| MCP for an internal service | Re-discovering schemas we already own | SDK/CLI wrapper instead |

---

## Closing

The cheapest tool call is the one you didn't have to widen.

Build the integration so the agent never has to.
