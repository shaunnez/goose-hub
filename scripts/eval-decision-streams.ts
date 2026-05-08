/**
 * M19.06 eval harness: compares per-run decision counts and content quality
 * between runs with experimental.recordDecisionTool = true (flag-on) and
 * flag-off runs that rely on the existing two-stream model.
 *
 * Usage:
 *   pnpm tsx scripts/eval-decision-streams.ts [--json] [--run-id <id>]
 *
 * Output (default): human-readable comparison table.
 * Output (--json):  JSON array of EvalResult objects written to stdout.
 *
 * The script reads from the operational SQLite database. Set DB_PATH env var
 * to override the default (~/.factory/data/factory.db).
 */

import { eq, sql } from 'drizzle-orm';
import { db } from '../core/db/db.js';
import { agentDecisions, events } from '../core/db/schema.js';

interface EvalResult {
  runId: string;
  /** Decisions recorded via the record-decision tool (flag-on). */
  toolDecisionCount: number;
  /** Decisions extracted from the canonical schema field (flag-off / fallback). */
  schemaDecisionCount: number;
  /** Decision kinds that appear in tool stream but not schema stream. */
  toolOnly: string[];
  /** Decision kinds that appear in schema stream but not tool stream. */
  schemaOnly: string[];
  /** Ratio of tool decisions to schema decisions (1.0 = identical count). */
  coverageRatio: number;
}

function fetchToolDecisions(runId?: string): Map<string, number> {
  const query = runId
    ? db
        .select({ runId: agentDecisions.runId, count: sql<number>`count(*)` })
        .from(agentDecisions)
        .where(eq(agentDecisions.runId, runId))
        .groupBy(agentDecisions.runId)
    : db
        .select({ runId: agentDecisions.runId, count: sql<number>`count(*)` })
        .from(agentDecisions)
        .groupBy(agentDecisions.runId);

  const rows = query.all();
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.runId, row.count);
  }
  return map;
}

function fetchSchemaDecisions(runId?: string): Map<string, number> {
  const filter = runId
    ? eq(events.runId, runId)
    : eq(events.kind, 'agent.decision-summary');

  const rows = db
    .select({ runId: events.runId, payload: events.payload })
    .from(events)
    .where(runId ? eq(events.runId, runId) : eq(events.kind, 'agent.decision-summary'))
    .all();

  void filter;

  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.runId == null) continue;
    try {
      const payload = JSON.parse(row.payload) as { decisionSummaries?: unknown[] };
      const count = Array.isArray(payload.decisionSummaries) ? payload.decisionSummaries.length : 0;
      map.set(row.runId, (map.get(row.runId) ?? 0) + count);
    } catch {
      // malformed payload — skip
    }
  }
  return map;
}

function fetchKindsByRun(runId: string): { toolKinds: Set<string>; schemaKinds: Set<string> } {
  const toolRows = db
    .select({ kind: agentDecisions.kind })
    .from(agentDecisions)
    .where(eq(agentDecisions.runId, runId))
    .all();

  const toolKinds = new Set(toolRows.map((r) => r.kind));

  const eventRows = db
    .select({ payload: events.payload })
    .from(events)
    .where(eq(events.runId, runId))
    .all();

  const schemaKinds = new Set<string>();
  for (const row of eventRows) {
    try {
      const payload = JSON.parse(row.payload) as { decisionSummaries?: Array<{ kind: string }> };
      if (Array.isArray(payload.decisionSummaries)) {
        for (const ds of payload.decisionSummaries) {
          if (typeof ds.kind === 'string') schemaKinds.add(ds.kind);
        }
      }
    } catch {
      // skip
    }
  }

  return { toolKinds, schemaKinds };
}

function buildResults(targetRunId?: string): EvalResult[] {
  const toolCounts = fetchToolDecisions(targetRunId);
  const schemaCounts = fetchSchemaDecisions(targetRunId);

  const allRunIds = new Set([...toolCounts.keys(), ...schemaCounts.keys()]);
  if (targetRunId) {
    allRunIds.add(targetRunId);
  }

  const results: EvalResult[] = [];

  for (const runId of allRunIds) {
    const toolDecisionCount = toolCounts.get(runId) ?? 0;
    const schemaDecisionCount = schemaCounts.get(runId) ?? 0;

    const { toolKinds, schemaKinds } = fetchKindsByRun(runId);

    const toolOnly = [...toolKinds].filter((k) => !schemaKinds.has(k));
    const schemaOnly = [...schemaKinds].filter((k) => !toolKinds.has(k));
    const coverageRatio =
      schemaDecisionCount === 0
        ? toolDecisionCount > 0
          ? 2.0
          : 1.0
        : toolDecisionCount / schemaDecisionCount;

    results.push({ runId, toolDecisionCount, schemaDecisionCount, toolOnly, schemaOnly, coverageRatio });
  }

  return results.sort((a, b) => a.runId.localeCompare(b.runId));
}

function printTable(results: EvalResult[]): void {
  if (results.length === 0) {
    process.stdout.write('No runs found. Run with --run-id <id> or ensure DB has data.\n');
    return;
  }

  const header = ['run_id', 'tool#', 'schema#', 'ratio', 'tool_only', 'schema_only'];
  const rows = results.map((r) => [
    r.runId.slice(0, 8),
    String(r.toolDecisionCount),
    String(r.schemaDecisionCount),
    r.coverageRatio.toFixed(2),
    r.toolOnly.join(',') || '—',
    r.schemaOnly.join(',') || '—',
  ]);

  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)),
  );

  const fmt = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ');

  process.stdout.write(`${fmt(header)}\n`);
  process.stdout.write(`${widths.map((w) => '-'.repeat(w)).join('  ')}\n`);
  for (const row of rows) {
    process.stdout.write(`${fmt(row)}\n`);
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const runIdIdx = args.indexOf('--run-id');
const targetRunId = runIdIdx !== -1 ? args[runIdIdx + 1] : undefined;

const results = buildResults(targetRunId);

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} else {
  printTable(results);
}
