# Troubleshoot Agent — Langfuse-First Debugging

Diagnose agent issues by analyzing Langfuse traces BEFORE touching any code.

**Arguments:** `$ARGUMENTS` - Description of the agent issue (e.g., "revenue queries returning wrong data", "tool failures on labor queries")

---

## STEP 1: Load Langfuse Credentials

Read the project `.env` file to get Langfuse API keys:

```bash
grep LANGFUSE_ .env
```

Extract `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL`.

---

## STEP 2: Fetch Recent Traces

Query the Langfuse API for recent traces. If `$ARGUMENTS` mentions a specific domain, filter by trace name using the mapping below:

| User mentions | Trace name filter |
|---|---|
| revenue, sales | `revenue-query` |
| labor, staffing, schedule | `labor-query` |
| product, menu, items | `product-query` |
| forecast, prediction | `demand-forecast` |
| server, waiter | `server-query` |
| operations, voids, comps | `operations-query` |
| payments, tips | `payments-query` |
| tax | `tax-query` |
| guest, customer | `guest-query` |
| analysis, investigation | `*-analysis` |
| chart, visualization | `visualization-request` |
| dashboard, widget | `dashboard-update` |
| greeting, hello | `chat-greeting` |
| memory | `memory-extraction` |

```bash
# Fetch recent traces (add &name=<trace-name> if filtering)
curl -s "https://cloud.langfuse.com/api/public/traces?limit=20" \
  -u '<PUBLIC_KEY>:<SECRET_KEY>' | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
for t in data:
    meta = t.get('metadata', {}) or {}
    tools = meta.get('tools_used', [])
    print(f\"{t['id'][:12]}  {t.get('timestamp','')[:19]}  {t.get('name','?'):30s}  tools={tools}  tokens={meta.get('total_tokens','?')}\")
"
```

---

## STEP 3: Drill Into Suspect Trace

Pick the most relevant trace and fetch full details including spans:

```bash
curl -s "https://cloud.langfuse.com/api/public/traces/<TRACE_ID>" \
  -u '<PUBLIC_KEY>:<SECRET_KEY>' | python3 -c "
import sys, json
t = json.load(sys.stdin)
meta = t.get('metadata', {}) or {}
print('=== TRACE SUMMARY ===')
print(f\"Name: {t.get('name')}\")
print(f\"Session: {t.get('sessionId')}\")
print(f\"Model: {meta.get('model')}\")
print(f\"Tokens: input={meta.get('input_tokens')} output={meta.get('output_tokens')} total={meta.get('total_tokens')}\")
print(f\"Latency: {meta.get('latency_seconds')}s\")
print(f\"TTFT: {meta.get('time_to_first_token_ms')}ms\")
print(f\"Tools used: {meta.get('tools_used')}\")
print(f\"Tool calls: {meta.get('tool_calls')}\")
print(f\"LLM calls: {meta.get('llm_calls')}\")
print()
print('=== INPUT ===')
inp = t.get('input', {})
if isinstance(inp, dict):
    msgs = inp.get('messages', [])
    for m in msgs[-3:]:
        role = m.get('role','?')
        content = str(m.get('content',''))[:500]
        print(f'[{role}] {content}')
print()
print('=== OUTPUT ===')
out = t.get('output', {})
if isinstance(out, dict):
    content = str(out.get('content', out.get('text', str(out))))[:1000]
    print(content)
"
```

Also fetch observations (spans) for tool-level detail:

```bash
curl -s "https://cloud.langfuse.com/api/public/observations?traceId=<TRACE_ID>&limit=50" \
  -u '<PUBLIC_KEY>:<SECRET_KEY>' | python3 -c "
import sys, json
obs = json.load(sys.stdin)['data']
for o in obs:
    meta = o.get('metadata', {}) or {}
    status = '✓' if meta.get('success', True) else '✗'
    err = meta.get('error_message', '')
    print(f\"{status} {o.get('name','?'):40s}  {meta.get('execution_time_ms','')}ms  {err}\")
"
```

---

## STEP 4: Analyze & Diagnose

Based on trace evidence, identify:

1. **Tool failures** — Which tools failed? What error types? (`validation`, `query_failed`, `database`)
2. **Token bloat** — Unexpectedly high token counts suggest prompt issues or agent looping
3. **Latency spikes** — Which span took the longest?
4. **Model mismatch** — Is the right model being used for this query type?
5. **Agent looping** — `llm_calls > 3` suggests the agent is stuck in a retry loop
6. **Missing tools** — Expected tool not in `tools_used`?

---

## STEP 5: Propose Fix with Evidence

ONLY NOW propose code changes. Every proposed change MUST cite:
- The specific trace ID that demonstrates the issue
- The span/observation that shows the failure
- The metric that is anomalous

Format your proposal as:
```
TRACE EVIDENCE: <trace_id> — <what it shows>
ROOT CAUSE: <diagnosis>
PROPOSED FIX: <specific code change with file path>
```

If the traces look normal and don't explain the reported issue, say so explicitly. Do NOT guess at code changes without trace evidence.
