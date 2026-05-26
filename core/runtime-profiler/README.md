# core/runtime-profiler

Builds per-skill runtime cost, reliability, and tool-use profiles from local run telemetry.

## Files

| File | Exports |
|---|---|
| `types.ts` | Runtime profiler row, metric, recommendation, skill-profile, and report types. |
| `profile-runs.ts` | `profileRuntimeProject(input)` for DB-backed reports and `profileRuntimeRows(input)` for pure row-based profiling. |
| `recommendations.ts` | `recommendRuntimeProfile(input)` for heuristic recommendations from computed metrics. |

## Behaviour

- Reports are grouped by skill and sorted by p95 cost, with optional skill filtering.
- Metrics include token/cost percentiles, timeout rate, budget-exceeded rate, schema-retry rate, read volume, tool counts, repeated shell commands, and common tool sequences.
- Recommendations flag timeout pressure, budget pressure, schema retry patterns, heavy shell usage, repeated command patterns, stable low-cost candidates, and QA/e2e boundary drift.
- `profileRuntimeRows` is pure and testable; `profileRuntimeProject` reads `agent_run_costs` and event rows from SQLite for a project/time window.

## Use

Use profiler output to inform skill budget and runtime tuning. Treat recommendations as prompts for review, not automatic config changes.
