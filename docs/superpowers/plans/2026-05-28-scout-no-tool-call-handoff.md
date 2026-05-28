# Scout No-Tool-Call Failure Handoff

Date: 2026-05-28

## Problem

Issue `#1177` (`POST /api/inbox returns 500 when body is null`) triggered investigation scouts where most scouts completed without making any Factory read/search/file calls, then failed with:

```text
scout returned no findings and made no successful Factory read/search/file tool calls
```

This is not just a UI/timeline rendering issue. The event stream and tool stats show the affected scouts had no successful evidence calls and no failed/blocked Factory evidence calls either.

## Evidence

Linked timeline:

- `http://localhost:5173/projects/goose-hub-self/items/1177/timeline`

DB-backed runs inspected:

- `fac20a5b-3e99-44a3-9b73-bb44755f184f`
- `5cdfa1f7-98d7-4669-b582-fdcbf1f3c1f8`

Observed pattern:

- `bug-enhance` produced no grounded hints: `candidateFileCount=0`, `candidateRouteCount=0`.
- `agent.investigation-seed-built` had `candidateFileCount=0`, `candidateSymbolCount=0`.
- `scout-code-path` made Factory tool calls and completed successfully.
- `scout-dependency`, `scout-pattern`, `scout-schema`, and `scout-test-inventory` completed with no Factory evidence tool calls and were reclassified as `swarm.scout-failed`.
- In the failed runs, `scout-code-path` used `gpt-5.4`; the other scouts used `gpt-5.4-mini`.
- Current `project_skill_settings` later changed several scouts to sonnet/codex around `04:56`, after the failed runs.

Useful DB queries:

```sh
sqlite3 -header -column ~/.factory/data/factory.db \
  "select run_id, model_id, input_tokens, output_tokens, cached_input_tokens, reasoning_output_tokens, cost_usd, created_at from agent_run_costs where run_id like 'fac20a5b%' or run_id like '5cdfa1f7%' order by created_at;"

sqlite3 -header -column ~/.factory/data/factory.db \
  "select run_id, read_count, grep_count, bytes_read, unique_paths_read from agent_run_tool_stats where run_id like 'fac20a5b%' or run_id like '5cdfa1f7%';"

sqlite3 -header -column ~/.factory/data/factory.db \
  "select id, kind, run_id, created_at, substr(payload,1,500) payload from events where work_item_id='github:shaunnez/goose-hub#1177' and run_id like 'fac20a5b%' order by id;"
```

## Current Runtime Semantics

The no-evidence failure guard is intentional and should not be weakened blindly.

Key files:

- `core/agent-runtime/scout-runner.ts`
  - `SCOUT_NO_EVIDENCE_REASON`
  - `FACTORY_EVIDENCE_TOOL_NAMES`
  - `hasSuccessfulFactoryEvidenceCall()`
  - final failure branch when `findings.length === 0` and there were no successful evidence calls
- `core/tool-layer/mcp/audit.ts`
  - Factory MCP tools emit `agent.tool-call` from the server side.
- `core/tool-layer/mcp/tools/read.ts`
  - `read_file`, `list_files`, and `search_text` emit `agent.tool-call`.
- `core/tool-layer/mcp/tools/repo-intel.ts`
  - `repo_intel.query` emits `agent.tool-call`, including many misses/failures.
- `core/agent-runtime/codex-cli.ts`
  - Codex stdout parsing only directly notices native shell `command_execution`.
  - Factory MCP calls are normally logged by the Factory MCP server, not by parsing Codex stdout.
  - MCP resource failures can show up as `agent.runtime-advisory`.

Logging caveat:

- If the model invokes a Factory MCP tool and the Factory server receives it, an `agent.tool-call` should exist.
- If Codex fails before the Factory MCP server receives the call, the run may only show stderr/runtime advisory.
- For the inspected failed scouts, there were no scout-specific runtime advisories, so the strongest read is that the mini scouts returned schema-valid empty JSON without invoking tools.

## Prompt/Planner Findings

### Why these scouts were selected

`slices/investigate/investigation-planner.ts` currently selects:

- `scout-code-path` and `scout-test-inventory` unconditionally for swarm mode.
- `scout-schema` when text contains broad terms like `api`.
- `scout-dependency` when text contains `workspace`.
- `scout-pattern` when no path or symbol-like signal is found.

The auto-generated issue body included:

```text
Location No tool-verified file path was found in the current workspace for api/inbox.
```

That phrase contributes to over-selection:

- `api` selects schema.
- `current workspace` selects dependency.
- no concrete path/symbol selects pattern.

### Why code-path behaved better

`skills/scout-code-path/prompt.md` has the clearest no-seed instruction:

```text
Without hints, run at most 2 targeted searches for symbols named in <scoutFocus> or <workItem>.
```

The other scout prompts either need a concrete target or allow early uncertainty/skips too easily:

- `scout-dependency`: if no clear module is named, return uncertainty rather than expanding search.
- `scout-pattern`: fallback focus can be generic: `Identify existing patterns the fix should follow`.
- `scout-test-inventory`: needs a file/module/feature area but got an empty seed.
- `scout-schema`: should search API contracts, but can exit thin when evidence is ambiguous.

The model-tier difference likely made this worse: `gpt-5.4-mini` appears more willing to satisfy the output schema without doing the requested tool-first evidence pass.

## Desired Changes

Implement this as a small reliability slice. Do not remove the no-evidence guard; make scouts comply with it and make failures easier to diagnose.

### 1. Ground `bug-enhance` for server API routes

Goal: `POST /api/inbox` should produce seed candidate files before scouts run.

Likely files:

- `skills/bug-enhance/prompt.md`
- `core/agent-runtime/bug-enhance-runner.ts`
- `core/tool-layer/mcp/tools/repo-intel.ts`
- `core/tool-layer/mcp/tools/repo-intel.test.ts`
- `slices/investigate/slice.test.ts`

Expected behavior:

- For `server-api` issues with `POST /api/inbox`, `bug-enhance` should call `repo_intel.query({ intent: "find-route", pathPattern: "/api/inbox" })` or an equivalent normalized path.
- If the route index misses `/api/inbox` because server routes are registered as `/inbox`, either route-intel should normalize the `/api` proxy prefix or `bug-enhance` should try both `/api/inbox` and `/inbox`.
- Persist `groundedHints` when a route candidate is found so `buildInvestigationSeed()` produces non-empty `candidateFiles`.

Regression test target:

- A direct `bug-enhance` runner/test fixture or investigate workflow fixture for `POST /api/inbox returns 500 when body is null` should assert non-empty grounded candidate files, ideally including:
  - `apps/server/src/domains/inbox/router.ts`
  - possibly `apps/server/src/domains/inbox/service.ts`

### 2. Tighten investigation planner heuristics

Goal: avoid selecting broad scouts from boilerplate or auto-generated text.

Likely file:

- `slices/investigate/investigation-planner.ts`
- `slices/investigate/investigation-planner.test.ts`

Changes:

- Do not let boilerplate phrases like `current workspace` trigger `scout-dependency`.
- Treat `workspace` as dependency signal only when paired with actual package/import/cross-boundary language, not in `"No tool-verified file path was found in the current workspace"`.
- Consider stripping or downweighting the auto-added `Location No tool-verified file path...` sentence before scout selection.
- Keep `api` as schema signal only when it reflects an endpoint/request/response contract. `POST /api/inbox` should still select schema, but not dependency by accident.

Regression test:

- Input title/body from issue `#1177` should select a minimal useful scout set after grounding is unavailable:
  - required: `scout-code-path`, `scout-test-inventory`
  - maybe: `scout-schema`
  - not from boilerplate alone: `scout-dependency`
  - not generic unless a useful pattern term/seed exists: `scout-pattern`

### 3. Enforce a selected-scout evidence contract

This is the most important part.

Goal: a selected scout with empty seed must not return `status: "ok"` and empty findings without either:

- making at least one targeted Factory evidence call, or
- returning explicit `status: "skipped"` with a domain-not-applicable reason.

Likely files:

- `skills/scout-code-path/prompt.md`
- `skills/scout-dependency/prompt.md`
- `skills/scout-pattern/prompt.md`
- `skills/scout-schema/prompt.md`
- `skills/scout-test-inventory/prompt.md`
- `skills/scout-tool-boundary.test.ts`
- `core/agent-runtime/scout-runner.ts`
- `core/agent-runtime/swarm.test.ts`

Prompt changes:

- Add a common hard rule to every Wave-1 scout prompt:
  - If `investigationSeed` is empty and this scout is selected, make at least one targeted `repo_intel.query`, `search_text`, `list_files`, or `read_file` call before returning `status: "ok"` or `UNCERTAINTY`.
  - If the scout domain truly does not apply, return `status: "skipped"` with a decision summary explaining why, without pretending to have investigated.
  - `status: "ok"` with `findings: []` is allowed only when backed by a successful Factory evidence call or by supplied `<seedEvidence>`.

Runtime changes:

- Preserve the no-evidence failure guard.
- Improve the failure event payload so the next diagnosis can distinguish:
  - model returned `status: "ok"` with empty findings,
  - model returned `status: "skipped"` but the skip reason was unsupported-tool drift,
  - model returned decision summaries but made no evidence calls,
  - retry was skipped because no seed evidence existed.
- Include diagnostic fields in `swarm.scout-failed`, such as:
  - `outputStatus`
  - `findingsCount`
  - `decisionSummariesCount`
  - `hasFactoryEvidenceAttempt`
  - `hasSuccessfulFactoryEvidenceCall`
  - `seedCandidateFileCount`
  - `modelId` if cheaply available from context or run events

Regression tests:

- A scout result with `{ status: "ok", findings: [], decisionSummaries: [...] }` and no evidence events emits `swarm.scout-failed` with the enriched diagnostic payload.
- A scout result with `{ status: "skipped", findings: [], decisionSummaries: [...] }` and a true domain-not-applicable summary emits `swarm.scout-skipped`.
- A scout result with empty findings plus a successful `search_text` or `repo_intel.query` miss may complete as evidence-backed empty only if the scout output status is semantically valid for that scout.
- Existing retry behavior with `<seedEvidence>` remains intact.

### 4. Improve tool-call observability for Codex/MCP gaps

Goal: make it obvious whether there were no calls, invisible calls, or pre-server MCP failures.

Likely files:

- `core/agent-runtime/codex-cli.ts`
- `core/agent-runtime/codex-parser.ts`
- `core/agent-runtime/codex-cli-runtime.test.ts`
- `core/tool-layer/pre-tool-use-hook.ts`
- `core/tool-layer/mcp/audit.ts`

Potential changes:

- Add `agent.mcp-tool-attempt` or enriched `agent.runtime-advisory` when Codex stderr indicates MCP tool/list/read failures before the Factory tool server receives a normal call.
- Keep `agent.tool-call` reserved for real Factory tool invocations/denials where the tool name and input are known.
- If Codex NDJSON includes MCP tool-call events in newer versions, extend `pickCodexToolCall()` to parse them. Today it only recognizes `command_execution`.
- Add a run-completion diagnostic counter for parsed Codex tool-call events vs Factory MCP `agent.tool-call` events, if this can be done without expensive replay.

Do not rely on this observability change as the behavioral fix. The behavioral fix is still the selected-scout evidence contract.

## Suggested Implementation Order

1. Write tests around planner selection for the `#1177` body.
2. Write tests around `bug-enhance` grounding for `POST /api/inbox`.
3. Write `scout-runner` tests for enriched no-evidence failure diagnostics.
4. Patch shared prompt language across all Wave-1 scout prompts.
5. Patch planner heuristics.
6. Patch route/API grounding.
7. Add Codex/MCP observability only after the behavioral path is covered.

## Verification

Minimum targeted verification:

```sh
pnpm test slices/investigate/investigation-planner.test.ts
pnpm test slices/investigate/slice.test.ts
pnpm test core/agent-runtime/swarm.test.ts
pnpm test core/agent-runtime/codex-cli-runtime.test.ts
pnpm test core/tool-layer/mcp/tools/repo-intel.test.ts
pnpm test skills/scout-tool-boundary.test.ts
pnpm typecheck
```

Manual/live verification:

- Re-run investigation for issue `#1177`.
- Confirm `bug-enhance` produces a non-empty investigation seed or emits a clear grounding miss with route evidence.
- Confirm selected scouts either:
  - make at least one Factory evidence call, or
  - emit `swarm.scout-skipped` with a domain-not-applicable reason.
- Confirm no scout fails with the old opaque no-evidence message without enriched diagnostics.

## Non-Goals

- Do not remove or weaken the no-evidence guard.
- Do not make every scout sonnet-only as the sole fix. Model tier may mask the behavior, but the contract should hold on mini models too.
- Do not broaden scouts into expensive repo-wide searches. The fallback should be one or two targeted evidence calls, not unlimited exploration.
- Do not treat `resources/list failed` advisory noise as the root cause unless the affected scout also has no other possible tool path.
