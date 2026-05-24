# ADR 0048: repo_intel.query MCP tool

- Status: Accepted
- Date: 2026-05-23

## Context

Factory already computes repository intelligence outside agent runs: symbol-index lookups, related-surface manifests, recent git touches, scout-report persistence, and agent artifacts. Agents could not request that context directly; they fell back to `search_text` and rediscovered surfaces the harness already knew.

## Decision

Expose a single read-only Factory MCP tool, `mcp__factory-tools__repo_intel.query`, for structured repository-intelligence requests. The tool accepts an intent-discriminated query:

- `find-symbol`
- `find-callers`
- `find-tests-for`
- `related-files`
- `recent-changes`
- `prior-investigation`
- `fetch-artifact`

Each intent delegates to an existing helper. The tool layer validates every path-bearing input with the same MCP path policy as `read_file` and `search_text`. Results are cached per `FACTORY_RUN_ID` with the same run-cache semantics as the read/search tools. Tool-call audit includes `repo_intel_intent` for cost telemetry.

QA/review holdout callers may use the tool, but prior-investigation and artifact payloads are filtered before return to strip decision-summary and implementation-reasoning fields.

## Consequences

- Agents request known context before grep, reducing broad duplicate search.
- Symbol-index, scout-report, and artifact access stay behind one audited MCP boundary.
- Future AST/route-map work can add new intents without expanding shell access or teaching agents new storage locations.
- `repo_intel.query` is advisory and read-only; `search_text` remains the fallback for `not-found` and stale-index cases.
