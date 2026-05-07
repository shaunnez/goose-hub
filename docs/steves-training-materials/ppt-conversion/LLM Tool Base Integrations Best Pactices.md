<!-- Slide number: 1 -->

SKYTAB INTELLIGENCE  ·  AGENT PLATFORM
Tools, Not Telephones.
Why we build agent integrations on SDKs and CLIs —and keep MCP off the hot path.
A token-economics, topology, and progressive-disclosure playbook.

Foundry  ·  Jira  ·  ReAct  ·  Topology  ·  Templates
01 / 17

### Notes:

<!-- Slide number: 2 -->

01 · THE THESIS

The cheapest tool call is the one you didn't have to widen.

MCP
Vendor SDK
CLI

Generic protocol over a generic tool surface.
Typed methods, typed responses, your code.
When there is no SDK, wrap the CLI.
·  Server picks the shape of every reply.
·  Token cost scales with the server's verbosity, not your need.
·  Re-discovers schema each session.
·  Encourages 'just ask' loops that fan out and stall.
·  You choose the fields, the page size, the cache key.
·  Errors arrive as exceptions, not paragraphs.
·  Cache layer sits inside the service, not the agent.
·  Pydantic in, Pydantic out — no re-parsing.
·  Argv lists, deterministic exit codes.
·  Streams stdout — agent reads, doesn't fish.
·  One subprocess per intent. No daemon bloat.
·  Easy to dry-run, snapshot-test, and replay.
Rule:  the integration owns the contract.  The agent owns the question.  Neither owns both.
02 / 17

### Notes:

<!-- Slide number: 3 -->

02 · WHY NOT MCP

MCP is great at discovery. We've already discovered.
MCP optimises for an open-world agent meeting an unknown server.Our agents already know what to ask, who to ask, and how the answer should look.

MCP   Schema discovery on every connect
OURS  We import a typed Python module. The compiler checks shapes at deploy.

MCP   Server-defined response shape
OURS  Mixin returns a Pydantic model — we set the field whitelist, not the vendor.

MCP   Streaming text blocks per tool call
OURS  Direct method returns one validated object — single tool envelope, single token cost.

MCP   Auth handshakes per session
OURS  Singleton service, lazy client, basic auth in env. One handshake per process.

MCP   Tool fan-out via 'list_tools'
OURS  Tools are declared in manifests; the catalog is the index, not a network call.
03 / 17

### Notes:

<!-- Slide number: 4 -->

03 · TOKEN ECONOMICS

The cost of a question is mostly the cost of the answer's shape.
Same intent — "what's going on with merchant 0021773366" — three integration shapes, three bills.

Where the tokens go

MCP, generic 'query' tool, fan-out
~14,200 tok
Tool surface negotiation
·  list_tools, schema, auth
Verbose result envelopes
·  text blocks, content arrays
Reflection / re-asking
·  ReAct loop widening too fast
Untyped error paragraphs
·  models retry from prose

MCP, narrowed by tool name
~8,400 tok

Vendor SDK, typed mixin (ours)
~2,700 tok

CLI, jq-shaped pipeline
~2,100 tok
Estimates from internal Langfuse traces · gpt-4o tokenizer · same intent across three implementations.
04 / 17

### Notes:

<!-- Slide number: 5 -->

04 · THE REACT LOOP

Think → Act → Observe — but observe narrowly.

THINK
ACT
OBSERVE

Agent forms a hypothesis,picks ONE tool,commits to ONE shape of question.
Tool runs against the SDK.Returns a typed Pydantic object.No prose, no envelopes.
Agent reads the smallestuseful slice — never the full payload.Asks: do I need to widen?

↻  Loop only when the typed result tells you to.  Never loop because the response was vague.
Stop conditions are part of the contract — every Pydantic response carries enough
  signal (status, total_count, has_more) for the agent to decide without re-asking.
Errors short-circuit the loop. ToolResult.connection_error halts widening, doesn't seed it.
Loop budget is set by the manifest, not the model. ≤3 turns per intent is the default.
05 / 17

### Notes:

<!-- Slide number: 6 -->

05 · PROGRESSIVE QUERY WIDENING

Start cheap. Widen on evidence. Never on vibes.

L0  exact key

MID, issue key, case #

L1  exact field

email, phone, sf_id

L2  prefix / contains

containsAnyTerm on dba_name

L3  text search

Jira `text ~`, bounded -365d

L4  cross-domain

fan-out to 2+ services
Each step has a guard: if L(n) returns a hit, do not widen to L(n+1).  The agent reads total_count, not vibes.
L4 always passes through a planner — never a free-running agent.  Cross-service fan-out is a budget decision.
06 / 17

### Notes:

<!-- Slide number: 7 -->

06 · FOUNDRY · CASE STUDY

search_merchants() — auto-detect the cheapest level first.
One method, four resolved query types.  The integration picks the level — the agent never has to guess.

Why it's cheap
# backend/app/services/foundry/search.py
async def search_merchants(self, query, search_type="auto", limit=20):
    if search_type == "auto":
        if query.strip().isdigit():           resolved = "mid"      # L0
        elif "@" in query:                     resolved = "email"    # L1
        elif len(re.sub(r"\D","",query))>=10: resolved = "phone"    # L1
        else:                                  resolved = "name"     # L2

    where = {
        "mid":   {"type": "eq",                "field": "merchantId", "value": q},
        "email": {"type": "eq",                "field": "dbaEmail",   "value": q},
        "phone": {"type": "eq",                "field": "phone",      "value": digits},
        "name":  {"type": "containsAnyTerm",   "field": "dbaName",    "value": q},
    }[resolved]

    # ↳ select=[]  →  vendor returns indexed columns only.  No body bloat.
    result = client.ontologies.OntologyObject.search(
        ontology=self._ontology_id,
        object_type="Merchant",
        where=where,
        select=[],
        page_size=limit,
    )
    # ↳ Cache the typed Pydantic response, not the SDK object graph.
·  Auto-detect collapses 4 calls into 1.
·  containsAnyTerm only fires when L0/L1 fail.
·  select=[] keeps the vendor honest about payload size.
·  300s cache TTL — same MID twice in a flow is free.
·  Pydantic at the boundary; agent sees a list of typed
    MerchantSearchResult, never the SDK record dict.
·  match_field travels back so the agent can show its work.
Result: one tool call, one shape of answer, the agent decides whether to widen — based on total_count, not heuristics.
07 / 17

### Notes:

<!-- Slide number: 8 -->

07 · FOUNDRY · CASE STUDY

get_account_hierarchy() — three cheap probes, not one omniscient call.
Same intent, but split so each step's failure is local — and skippable.

Resolve identifier

1
MID lookup OR Salesforce account lookup.Returns one record or None.If None: stop here, return null hierarchy.

Climb to parent

2
SalesforceAccount eq id → parent.Falls back to MerchantFullInformation only on miss.Never both.

Enumerate children

3
MerchantEnterpriseGroupingDataset by mid.Filtered to siblings.Capped at 50 page_size.
Each probe has its own try/except — one Foundry hiccup degrades a single field, not the whole answer.
1800s cache TTL on the assembled tree.  Topology probes don't run on every conversation turn.
08 / 17

### Notes:

<!-- Slide number: 9 -->

08 · JIRA · CASE STUDY

search_jira() — regex first, JQL last.
We do two regexes before we touch the network.  One issue-key call beats one full-text JQL by an order of magnitude.

Each branch is a budget
# backend/app/agents/admin_assistant/tools/jira_tools.py
_ISSUE_KEY_PATTERN = re.compile(r"^[A-Z][A-Z0-9]+-\d+$", re.IGNORECASE)
_MID_PATTERN       = re.compile(r"^\d{8,12}$")

@tool
async def search_jira(query: str, search_type="text") -> dict:
    if _ISSUE_KEY_PATTERN.match(query):           # L0 — direct fetch
        issue = await service.get_issue(query.upper())
        return ToolResult.ok(...)
    if _MID_PATTERN.match(query):                 # L1 — text~MID, bounded
        return await service.search_by_text(query)
    if search_type == "merchant":                 # L2 — name OR mid
        return await service.search_by_merchant(query)
    if search_type == "jql":                      # L3 — escape hatch
        return await service.search(query)
    return await service.search_by_text(query)    # default: bounded text
L0  GET /issue/KEY
    1 round-trip · ~600 tok
L1  text~MID, ≤365d
    1 JQL · ~1.2k tok
L2  name OR mid
    1 JQL · ~1.8k tok
L3  raw JQL (admin only)
    bounded by capability
If the input shape tells you the level, the agent never has to.  No reasoning tokens spent picking a tool.
09 / 17

### Notes:

<!-- Slide number: 10 -->

09 · JIRA · PAYLOAD DISCIPLINE

The cheapest field is the one you didn't ask for.

Four guardrails per call
# backend/app/services/jira_service.py
_SEARCH_FIELDS = (
    "key,summary,status,priority,assignee,reporter,"
    "created,updated,project,labels,issuetype,description"
)
_DESCRIPTION_PREVIEW_LENGTH = 500
_DEFAULT_DATE_BOUND_DAYS    = 365

async def search_by_text(self, text: str, max_results: int = 20):
    safe = text.replace('"', '\\"')
    jql = (
        f'text ~ "{safe}" '
        f"AND created >= -{_DEFAULT_DATE_BOUND_DAYS}d "
        f"ORDER BY created DESC"
    )
    return await self.search(jql, max_results)   # cached, capped, typed
Field whitelist
·  ~12 fields, not the 200+ Jira can return.
Description preview cap
·  500 chars max — descriptions don't blow the context.
Date bound
·  -365d default — full history is opt-in via JQL.
max_results clamp
·  min(max(n,1),50) — agents can't ask for the firehose.
Same constraint pattern lives in Foundry's `select=[]`, `page_size=`, and 2000-char description trim.
When you build the integration, you set the maximum cost per call.  The agent doesn't get a vote.
10 / 17

### Notes:

<!-- Slide number: 11 -->

10 · PROGRESSIVE DISCLOSURE

Reveal in layers. The agent pulls the next layer only on demand.

Tier
Content
Trigger to widen
Cost

Headline
key, status, dba_name, total_count
always returned
~80 tok

Card
+ subject, priority, owner, dates
agent renders to user
~250 tok

Detail
+ description preview (500c), timeline
user clicks / asks why
~600 tok

Investigation
+ AI categorisation, related cases, hierarchy
explicit tool: investigate
~2k tok

Raw
full SDK record dump
developer-only flag
off-budget
Headline travels in every response.  Detail rides on a separate tool call.  Raw is gated by capability.
Frontend artifacts mirror this — chip → card → drawer → full report.  The data shape and the UI shape rhyme on purpose.
The model never asks 'tell me everything'.  There is no everything.  There is only the next tier.
11 / 17

### Notes:

<!-- Slide number: 12 -->

11 · AGENT TOPOLOGY

The shape of the agent decides the shape of the bill.

Flat
Hub & spoke
Manifest mixture

One big agent.  Sees every tool.Reasons over everything.React loop fans out by default.
Router → specialist agents.Each spoke owns its tool surface.Session state stays at the hub.
Manifest declares which tools.Compiler builds the smallest graph.Specialists never see siblings' tools.
Latency:   ⬤⬤⬤⬤⬤Tokens:    ⬤⬤⬤⬤⬤Debug:     ⬤◯◯◯◯
Latency:   ⬤⬤⬤◯◯Tokens:    ⬤⬤◯◯◯Debug:     ⬤⬤⬤⬤◯
Latency:   ⬤⬤◯◯◯Tokens:    ⬤◯◯◯◯Debug:     ⬤⬤⬤⬤⬤
Every tool a specialist doesn't know about is a tool the LLM doesn't have to read in its system prompt.
Manifest mixture is our default — see backend/app/agents/platform/manifests/.
Topology is a token decision before it is an architecture decision.
12 / 17

### Notes:

<!-- Slide number: 13 -->

12 · TOPOLOGY × TOOLING

Where the latency actually goes.
End-to-end response time for a single 'what's wrong with merchant X' question.

Flat + MCP
~5.8s
system prompt
tool fan-out
react widening
model latency

Hub + SDK
~3.1s
system prompt
router hop
react
model

Manifest + SDK
~1.7s
react
model
Most savings come from the system prompt and react columns — i.e., the tool surface itself, not the network.
Numbers are illustrative — your traces will differ.  The shape of the wedge is what stays consistent.
13 / 17

### Notes:

<!-- Slide number: 14 -->

13 · ANTI-PATTERNS WE ALREADY PAID FOR

Five tickets we don't want to write again.

'Just give the agent a query() tool'

→ React loop widened to /search every turn.  Killed by typing the query upfront and wrapping it as search_merchants/search_jira.

Returning the SDK object directly

→ Agent re-parsed nested JSON each turn, including private fields.  Fixed by Pydantic-at-the-boundary.

Letting the model write JQL

→ Models reach for `text ~ \"*\"`.  Fixed by exposing search_by_text and gating raw `jql` behind an admin capability.

Per-call auth handshake

→ Cold-start tax on every tool call.  Fixed by lazy-singleton clients, env-driven config, and Redis cache for repeat reads.

MCP for an internal service

→ We already own the schema.  Re-discovering it over a wire is theatre, and the wire costs tokens.
14 / 17

### Notes:

<!-- Slide number: 15 -->

14 · THE SEVEN RULES

If a new integration breaks one of these, send it back.

1.  Typed in, typed out.  Pydantic at every boundary.  No dicts crossing service lines.

2.  The integration owns the level.  Auto-detect L0/L1/L2 from input shape, not from the agent.

3.  Field whitelist required.  No SELECT *.  No 'all fields'.  Name what you need and trim what you return.

4.  Cache near the call.  Redis-keyed, short TTL.  Cache the typed response, not the raw payload.

5.  Errors are typed too.  ConnectionError vs QueryError vs NotFound.  Never paragraphs.  Never None-and-pray.

6.  Async via asyncio.to_thread for sync SDKs.  Never block the event loop.  Never spawn a daemon for a single call.

7.  Manifest declares tools.  No keyword routing in chat handlers.  No bespoke agents.  Composable or reject.
These are non-negotiable for runtime tools.  Discovery and prototyping have their own playground —
a tool that ships behind a manifest is a tool that earned its tokens.
15 / 17

### Notes:

<!-- Slide number: 16 -->

15 · WHERE TO START

Three markdown templates, three days to ship.

INTEGRATION_PATTERN.md
NEW_SDK_INTEGRATION.md
NEW_CLI_INTEGRATION.md

The doctrine.Why SDK/CLI over MCP.ReAct guarantees.Progressive disclosure tiers.
Fill-in-the-blank service file.Mixin, schema, tool wrapper.Cache, error types, manifest.
Subprocess wrapper, argv builders.stdout JSON parsing.Dry-run + snapshot tests.
Read first.  10-minute read.  Settle the philosophy.
Copy → rename → swap.  Foundry-shaped.  Production-ready scaffold.
Use when no SDK exists.  jq pipelines welcome.
Location — documentation/integration-templates/   ·   Pair with manifest in backend/app/agents/platform/manifests/
16 / 17

### Notes:

<!-- Slide number: 17 -->

TL;DR
Build the tool, not the telephone.

Type your inputs.  Whitelist your fields.  Cache your boundary.Auto-detect the level so the agent never widens on guesswork.Let the manifest pick which tools the model even sees.Disclose progressively — headline, card, detail, raw.
MCP is a fine handshake for unknown servers.  Inside SkyTab Intelligence, we already know each other.
17 / 17

### Notes:
