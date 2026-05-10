# scout-reports

SQLite persistence for scout skill outputs produced during investigation workflows.

## Purpose

Scout agents run in parallel during investigation, each producing a JSON report for a specific skill (e.g. `repo-scout`, `code-scout`). Reports are keyed by `(projectId, workItemId, investigationRunId, scoutSkill)` so they survive worktree cleanup and can be assembled by the aggregation node without re-running scouts.

The `investigationRunId` isolates reports from different investigation cycles for the same work item — stale reports from a prior failed investigation never bleed into the current one.

## API

```ts
import { persistScoutReport, listScoutReportsForInvestigation } from 'core/scout-reports/repository.js';

// Upsert: safe to call multiple times for the same key (intra-run retry)
persistScoutReport(projectId, workItemId, investigationRunId, scoutSkill, reportJson);

// Retrieve all scouts for a given investigation cycle
const reports = listScoutReportsForInvestigation(projectId, workItemId, investigationRunId);
```

## Schema

Table `scout_reports` — unique index on `(project_id, work_item_id, investigation_run_id, scout_skill)`.
